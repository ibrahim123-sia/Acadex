// Secure exam mode for quizzes and online exams: an access code given out in the room, a
// campus-network (IP) allowlist, fullscreen and focus tracking with an optional automatic
// hand-in, and one question at a time with no going back. Webcam proctoring is not built in;
// a proctoring service can be attached through the hook below.
import crypto from 'node:crypto';
import net from 'node:net';
import { getConfig } from '../../config';
import { forbidden } from '../errors';

export interface SecureSettings {
  enabled: boolean;
  access_code_hash?: string | null;
  ip_allowlist: string[];
  require_fullscreen: boolean;
  lock_navigation: boolean;
  block_copy_paste: boolean;
  max_violations: number | null;
  /** reserved for a proctoring service: { provider, settings } */
  proctoring?: null;
}

/** Keyed with the server's secret, so a leaked hash of a short code can't be brute-forced offline. */
export const hashAccessCode = (assessmentId: number, code: string) =>
  crypto.createHmac('sha256', getConfig().mfaEncryptionKey).update(`exam-code:${assessmentId}:${code.trim().toUpperCase()}`).digest('hex');

/** The settings as staff see them (never the hash). */
export function staffSecure(s: SecureSettings | null | undefined) {
  if (!s) return null;
  const { access_code_hash, ...rest } = s;
  return { ...rest, has_access_code: !!access_code_hash };
}

/** What students (and the exam page) may know about the settings. */
export function publicSecure(s: SecureSettings | null | undefined) {
  if (!s?.enabled) return null;
  return {
    requires_code: !!s.access_code_hash,
    network_restricted: s.ip_allowlist.length > 0,
    require_fullscreen: s.require_fullscreen,
    lock_navigation: s.lock_navigation,
    block_copy_paste: s.block_copy_paste,
    max_violations: s.max_violations,
  };
}

/** Parse "a.b.c.d/nn" or an address; throws on nonsense (for validation). */
export function parseCidr(entry: string): { address: string; prefix: number; type: 'ipv4' | 'ipv6' } {
  const [address, bits] = entry.trim().split('/');
  const type = net.isIPv4(address ?? '') ? 'ipv4' : net.isIPv6(address ?? '') ? 'ipv6' : null;
  if (!type) throw new Error(`Not an IP address: ${entry}`);
  const max = type === 'ipv4' ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`Bad network size: ${entry}`);
  return { address: address!, prefix, type };
}

export function ipAllowed(ip: string | undefined, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  if (!ip) return false;
  const addr = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  const list = new net.BlockList();
  for (const e of allowlist) {
    const c = parseCidr(e);
    list.addSubnet(c.address, c.prefix, c.type);
  }
  return list.check(addr, net.isIPv4(addr) ? 'ipv4' : 'ipv6');
}

/** Checks before an attempt starts (or resumes). */
export function assertMayStart(assessmentId: number, s: SecureSettings | null | undefined, ip: string | undefined, code: string | undefined) {
  if (!s?.enabled) return;
  if (!ipAllowed(ip, s.ip_allowlist)) throw forbidden('This exam can only be taken on the campus network', 'NETWORK');
  if (s.access_code_hash) {
    if (!code) throw forbidden('Enter the access code your invigilator gives you', 'ACCESS_CODE');
    const given = hashAccessCode(assessmentId, code);
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(s.access_code_hash))) throw forbidden('That access code is not right', 'ACCESS_CODE');
  }
}

/** Leaving the exam: these events count towards max_violations. */
export const VIOLATIONS = ['blur', 'visibility_hidden', 'fullscreen_exit'];

// ---------------------------------------------------------------- proctoring hook

export interface ProctoringHook {
  name: string;
  /** called when an attempt starts; may return a URL the exam page opens alongside */
  onStart(attempt: { id: number; student_id: number; assessment_id: number }): Promise<{ launch_url?: string } | void>;
  /** called for every integrity event the exam page reports */
  onEvent?(attempt: { id: number }, kind: string, data?: unknown): Promise<void>;
}

const noProctoring: ProctoringHook = { name: 'none', async onStart() {} };
let hook: ProctoringHook = noProctoring;

/** A deployment (or a plugin) registers a proctoring service here. */
export function setProctoringHook(h: ProctoringHook | null) {
  hook = h ?? noProctoring;
}
export const proctoring = () => hook;
