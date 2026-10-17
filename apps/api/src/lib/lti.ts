// LTI 1.3 — Acadex as the platform launching external learning tools.
//   1. A course member opens the tool: Acadex records a one-time launch (state + nonce) and
//      redirects to the tool's OIDC login URL (third-party initiated login).
//   2. The tool sends the browser back to /api/lti/authorize; Acadex checks the login hint,
//      client id and redirect URI, and posts a signed id_token (RS256) to the tool's launch
//      URL with the LTI claims (resource link, context, roles; name / email only if allowed).
//   3. Tools verify the token with Acadex's public keys at /api/lti/jwks.
// The signing key is created once and kept sealed in platform_settings.
import crypto from 'node:crypto';

type JsonWebKey = crypto.webcrypto.JsonWebKey;
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { getConfig } from '../config';
import { db, runAsSystem } from '../db/context';

interface KeyRecord {
  kid: string;
  private_sealed: string;
  public_jwk: JsonWebKey;
}

let cached: { kid: string; privateKey: crypto.KeyObject; jwk: JsonWebKey } | null = null;

export async function signingKey() {
  if (cached) return cached;
  return runAsSystem(async () => {
    const { rows } = await db.query<{ value: KeyRecord }>(`SELECT value FROM platform_settings WHERE key = 'lti_key'`);
    let rec = rows[0]?.value;
    if (!rec) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      rec = {
        kid: crypto.randomBytes(8).toString('hex'),
        private_sealed: encryptSecret(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
        public_jwk: publicKey.export({ format: 'jwk' }),
      };
      await db.query(`INSERT INTO platform_settings (key, value) VALUES ('lti_key', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(rec)]);
      const { rows: again } = await db.query<{ value: KeyRecord }>(`SELECT value FROM platform_settings WHERE key = 'lti_key'`);
      rec = again[0]!.value;
    }
    cached = { kid: rec.kid, privateKey: crypto.createPrivateKey(decryptSecret(rec.private_sealed)), jwk: rec.public_jwk };
    return cached;
  });
}

export async function jwks() {
  const k = await signingKey();
  return { keys: [{ ...k.jwk, kid: k.kid, alg: 'RS256', use: 'sig' }] };
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

export async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const k = await signingKey();
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: k.kid }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), k.privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

/** Verifies an RS256 JWT with a JWK (tests; deep-linking responses). */
export function verifyJwt(token: string, jwk: JsonWebKey): Record<string, unknown> | null {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  return ok ? (JSON.parse(Buffer.from(b, 'base64url').toString()) as Record<string, unknown>) : null;
}

export const issuer = () => getConfig().appUrl.replace(/\/+$/, '');

export interface LaunchContext {
  tool: { id: number; client_id: string; launch_url: string; deployment_id: string; send_pii: boolean; name: string };
  user: { id: number; name: string; email: string; role: string };
  course: { id: number; code: string; name: string } | null;
  nonce: string;
}

export const LTI = 'https://purl.imsglobal.org/spec/lti/claim/';

export function launchClaims(c: LaunchContext): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const instructor = c.user.role === 'teacher' || c.user.role === 'institution_admin';
  return {
    iss: issuer(),
    aud: c.tool.client_id,
    sub: String(c.user.id),
    nonce: c.nonce,
    iat: now,
    exp: now + 300,
    azp: c.tool.client_id,
    ...(c.tool.send_pii ? { name: c.user.name, email: c.user.email } : {}),
    [`${LTI}message_type`]: 'LtiResourceLinkRequest',
    [`${LTI}version`]: '1.3.0',
    [`${LTI}deployment_id`]: c.tool.deployment_id,
    [`${LTI}target_link_uri`]: c.tool.launch_url,
    [`${LTI}resource_link`]: { id: `tool-${c.tool.id}-course-${c.course?.id ?? 0}`, title: c.tool.name },
    [`${LTI}roles`]: [instructor ? 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor' : 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
    ...(c.course ? { [`${LTI}context`]: { id: String(c.course.id), label: c.course.code, title: c.course.name, type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'] } } : {}),
    [`${LTI}launch_presentation`]: { document_target: 'window', return_url: `${issuer()}/teach` },
  };
}

/** The auto-submitting form that posts the id_token to the tool (its script runs under a CSP nonce). */
export function formPost(action: string, fields: Record<string, string>, nonce: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Opening…</title></head><body><form method="post" action="${esc(action)}">${inputs}<noscript><button type="submit">Continue</button></noscript></form><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`;
}
