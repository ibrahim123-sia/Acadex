// SCORM 1.2 / 2004 packages. The files are stored as they are and served under a short-lived
// launch token. Package pages run sandboxed (an opaque origin: no access to Acadex, its
// cookies or the person's session); a small runtime injected into each page answers the SCORM
// API calls from the saved state and reports changes to the Acadex player with postMessage,
// and the player saves them with the person's own session.
import crypto from 'node:crypto';
import { getConfig } from '../../config';
import { storage } from '../../storage';
import { badRequest } from '../errors';
import { escapeHtml } from '../html';
import { list, mimeOf, readZip, txt, xml } from './packages';

export interface ScormManifest {
  version: '1.2' | '2004';
  title: string;
  launch: string;
  files: Record<string, { key: string; type: string }>;
}

export async function storeScormPackage(institutionId: number, prefix: string, buf: Buffer): Promise<ScormManifest> {
  const zip = readZip(buf);
  const manifestFile = [...zip.keys()].find((k) => k.toLowerCase() === 'imsmanifest.xml');
  if (!manifestFile) throw badRequest('Not a SCORM package (imsmanifest.xml is missing)');
  const doc = xml(zip.get(manifestFile)) as { manifest?: Record<string, unknown> };
  const m = doc.manifest ?? {};
  const schema = txt((m.metadata as Record<string, unknown>)?.schemaversion);
  const version: '1.2' | '2004' = /2004|CAM 1\.3/i.test(schema) ? '2004' : '1.2';
  const orgs = (m.organizations ?? {}) as Record<string, unknown>;
  const org = list<Record<string, unknown>>(orgs.organization)[0] ?? {};
  const title = txt(org.title) || 'SCORM package';
  const resources = list<Record<string, unknown>>((m.resources as Record<string, unknown>)?.resource);
  const firstItemRef = (function find(items: unknown): string | null {
    for (const it of list<Record<string, unknown>>(items)) {
      if (it['@identifierref']) return String(it['@identifierref']);
      const deep = find(it.item);
      if (deep) return deep;
    }
    return null;
  })(org.item);
  const sco = resources.find((r) => r['@identifier'] === firstItemRef) ?? resources.find((r) => /sco/i.test(String(r['@scormtype'] ?? r['@scormType'] ?? ''))) ?? resources[0];
  const href = sco?.['@href'] ? String(sco['@href']) : null;
  if (!href) throw badRequest('The package does not say which page to open');
  const files: ScormManifest['files'] = {};
  for (const [path, data] of zip) {
    const key = `${prefix}/${crypto.createHash('sha1').update(path).digest('hex')}`;
    files[path] = { key, type: mimeOf(path) };
    await storage().put(key, Buffer.from(data), files[path]!.type);
  }
  const launch = href.split('?')[0]!;
  if (!files[launch]) throw badRequest(`The launch page ${launch} is not in the package`);
  const manifest: ScormManifest = { version, title, launch: href, files };
  await storage().put(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest)), 'application/json');
  void institutionId;
  return manifest;
}

const cache = new Map<string, ScormManifest>();
export async function loadManifest(prefix: string): Promise<ScormManifest> {
  const hit = cache.get(prefix);
  if (hit) return hit;
  const m = JSON.parse((await storage().get(`${prefix}/manifest.json`)).toString('utf8')) as ScormManifest;
  if (cache.size > 200) cache.clear();
  cache.set(prefix, m);
  return m;
}

// ---------------------------------------------------------------- launch tokens

export interface LaunchClaims {
  /** package, content item, student (null = staff preview), user, expiry (s) */
  p: number;
  i: number | null;
  s: number | null;
  u: number;
  exp: number;
}

const sign = (body: string) => crypto.createHmac('sha256', getConfig().jwtSecret).update(`scorm:${body}`).digest('base64url');

export function launchToken(c: Omit<LaunchClaims, 'exp'>, ttlSeconds = 6 * 3600): string {
  const body = Buffer.from(JSON.stringify({ ...c, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyLaunch(token: string): LaunchClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LaunchClaims;
    return c.exp > Date.now() / 1000 ? c : null;
  } catch {
    return null;
  }
}

/** The runtime injected into every HTML page of a package. */
export function runtimeScript(version: '1.2' | '2004', cmi: Record<string, string>, nonce: string): string {
  const state = JSON.stringify(cmi).replace(/</g, '\\u003c');
  return `<script nonce="${escapeHtml(nonce)}">(function(){var d=${state};var v=${JSON.stringify(version)};var err="0";
function post(fin){try{window.top.postMessage({acadexScorm:1,cmi:d,finish:!!fin},"*")}catch(e){}}
function g(k){err="0";if(k in d)return String(d[k]);if(/_count$/.test(k))return "0";if(k==="cmi.core._children"||k==="cmi._children")return "";err="0";return ""}
function s(k,val){err="0";d[k]=String(val);return "true"}
var api12={LMSInitialize:function(){return "true"},LMSFinish:function(){post(1);return "true"},LMSGetValue:g,LMSSetValue:s,LMSCommit:function(){post(0);return "true"},LMSGetLastError:function(){return err},LMSGetErrorString:function(){return ""},LMSGetDiagnostic:function(){return ""}};
var api04={Initialize:function(){return "true"},Terminate:function(){post(1);return "true"},GetValue:g,SetValue:s,Commit:function(){post(0);return "true"},GetLastError:function(){return err},GetErrorString:function(){return ""},GetDiagnostic:function(){return ""}};
window.API=api12;window.API_1484_11=api04;window.addEventListener("beforeunload",function(){post(0)});})();</script>`;
}

/** What a SCORM data model says about completion and score. */
export function scormOutcome(version: '1.2' | '2004', cmi: Record<string, string>) {
  if (version === '1.2') {
    const status = cmi['cmi.core.lesson_status'] ?? 'incomplete';
    const raw = Number(cmi['cmi.core.score.raw']);
    const max = Number(cmi['cmi.core.score.max'] || 100);
    return { status, completed: ['completed', 'passed'].includes(status), score: Number.isFinite(raw) && max > 0 ? Math.round((raw / max) * 10000) / 100 : null };
  }
  const completion = cmi['cmi.completion_status'] ?? 'incomplete';
  const success = cmi['cmi.success_status'] ?? 'unknown';
  const scaled = Number(cmi['cmi.score.scaled']);
  return {
    status: success !== 'unknown' ? success : completion,
    completed: completion === 'completed' || success === 'passed',
    score: Number.isFinite(scaled) ? Math.round(scaled * 10000) / 100 : null,
  };
}
