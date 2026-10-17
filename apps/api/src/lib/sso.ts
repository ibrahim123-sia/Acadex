// Sign in with Google or Microsoft (OpenID Connect, authorization code + PKCE). Only people
// who already have an Acadex account can sign in this way — matched by their verified email —
// and only when their institution's plan includes single sign-on. Two-factor accounts still
// enter their code afterwards.
import crypto from 'node:crypto';
import { getConfig } from '../config';

export type SsoProvider = 'google' | 'microsoft';

interface ProviderDef {
  authorize: string;
  token: string;
  userinfo: string;
  scope: string;
}

export function providers(): Partial<Record<SsoProvider, { clientId: string; clientSecret: string; def: ProviderDef }>> {
  const c = getConfig().sso;
  const out: Partial<Record<SsoProvider, { clientId: string; clientSecret: string; def: ProviderDef }>> = {};
  if (c.google.clientId && c.google.clientSecret) {
    out.google = {
      clientId: c.google.clientId,
      clientSecret: c.google.clientSecret,
      def: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', userinfo: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile' },
    };
  }
  if (c.microsoft.clientId && c.microsoft.clientSecret) {
    const t = encodeURIComponent(c.microsoft.tenant);
    out.microsoft = {
      clientId: c.microsoft.clientId,
      clientSecret: c.microsoft.clientSecret,
      def: { authorize: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, userinfo: 'https://graph.microsoft.com/oidc/userinfo', scope: 'openid email profile' },
    };
  }
  return out;
}

export const callbackUrl = (p: SsoProvider) => `${getConfig().apiPublicUrl}/auth/sso/${p}/callback`;

/** The state kept in a short-lived signed cookie between start and callback. */
export interface SsoState {
  p: SsoProvider;
  s: string;
  v: string;
  exp: number;
}
const mac = (data: string) => crypto.createHmac('sha256', getConfig().jwtSecret).update(`sso:${data}`).digest('base64url');
export function sealState(st: SsoState): string {
  const data = Buffer.from(JSON.stringify(st)).toString('base64url');
  return `${data}.${mac(data)}`;
}
export function openState(raw: string | undefined): SsoState | null {
  if (!raw) return null;
  const [data, sig] = raw.split('.');
  if (!data || !sig || mac(data) !== sig) return null;
  const st = JSON.parse(Buffer.from(data, 'base64url').toString()) as SsoState;
  return st.exp > Date.now() ? st : null;
}

export function startUrl(p: SsoProvider): { url: string; state: SsoState } {
  const prov = providers()[p];
  if (!prov) throw new Error('provider not configured');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state: SsoState = { p, s: crypto.randomBytes(16).toString('base64url'), v: verifier, exp: Date.now() + 10 * 60_000 };
  const q = new URLSearchParams({
    client_id: prov.clientId,
    redirect_uri: callbackUrl(p),
    response_type: 'code',
    scope: prov.def.scope,
    state: state.s,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${prov.def.authorize}?${q}`, state };
}

/** Network calls (tests replace them). */
export const ssoTransport: { fetch: typeof fetch } = { fetch: (...a) => fetch(...a) };

/** Exchanges the code and returns the verified email (or null). */
export async function emailFromCode(p: SsoProvider, code: string, verifier: string): Promise<string | null> {
  const prov = providers()[p];
  if (!prov) return null;
  const res = await ssoTransport.fetch(prov.def.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(p), client_id: prov.clientId, client_secret: prov.clientSecret, code_verifier: verifier }),
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as { access_token?: string };
  if (!tok.access_token) return null;
  const ui = await ssoTransport.fetch(prov.def.userinfo, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!ui.ok) return null;
  const info = (await ui.json()) as { email?: string; email_verified?: boolean; preferred_username?: string };
  // Google says whether the address is verified; Microsoft work / school accounts are managed by the organisation
  if (p === 'google' && info.email_verified !== true) return null;
  const email = (info.email ?? (p === 'microsoft' ? info.preferred_username : undefined))?.toLowerCase().trim();
  return email && email.includes('@') ? email : null;
}
