// Uploads: checked by content (not by the name or the browser's claim), size-limited per
// purpose, images re-encoded (which also strips EXIF / GPS metadata), virus-scanned, counted
// against the institution's storage quota, then stored and recorded in `files`.
import crypto from 'node:crypto';
import type { Response } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { institutionSettings } from '@acadex/shared';
import type { Queryable } from '../db/pool';
import { db } from '../db/context';
import { HttpError, badRequest } from '../lib/errors';
import { storage } from './index';
import { virusScanner } from './scan';

const defaultDb: Queryable = db;
const MB = 1024 * 1024;

const IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OFFICE = [
  XLSX,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/x-cfb',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
];
const MEDIA = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
const ZIP = ['application/zip', 'application/x-zip-compressed'];

export const PURPOSES = {
  photo: { maxBytes: 5 * MB, types: IMAGE, resize: 600 },
  logo: { maxBytes: 2 * MB, types: IMAGE, resize: 512 },
  document: { maxBytes: 10 * MB, types: ['application/pdf', ...IMAGE], resize: 2000 },
  import: { maxBytes: 5 * MB, types: ['text/csv', XLSX] },
  /** course materials */
  course: { maxBytes: 200 * MB, types: ['application/pdf', ...IMAGE, 'image/gif', ...OFFICE, ...MEDIA, ...ZIP], resize: 2400 },
  /** students' work */
  submission: { maxBytes: 100 * MB, types: ['application/pdf', ...IMAGE, ...OFFICE, ...MEDIA, ...ZIP], resize: 2400 },
  /** teachers' feedback (marked-up files, audio and video comments) */
  feedback: { maxBytes: 100 * MB, types: ['application/pdf', ...IMAGE, ...OFFICE, ...MEDIA], resize: 2400 },
  /** SCORM, Common Cartridge, Moodle and QTI packages */
  package: { maxBytes: 300 * MB, types: [...ZIP] },
} as const satisfies Record<string, { maxBytes: number; types: readonly string[]; resize?: number }>;
export type FilePurpose = keyof typeof PURPOSES;

/** Default quota per plan, in MB (an institution setting can override it). */
const PLAN_QUOTA_MB: Record<string, number> = { free: 500, pro: 10 * 1024, enterprise: 100 * 1024 };

export interface StoredFile {
  id: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  purpose: FilePurpose;
  storage_key: string;
}

const tooLarge = (max: number) => new HttpError(413, `The file is too large (maximum ${Math.round(max / MB)} MB)`, undefined, 'FILE_TOO_LARGE');
const unsupported = (allowed: readonly string[]) =>
  new HttpError(415, `This kind of file is not accepted here (allowed: ${allowed.map((t) => (t === XLSX ? 'xlsx' : t.split('/')[1])).join(', ')})`, undefined, 'FILE_TYPE');

/** What the bytes actually are. CSV has no signature: plain UTF-8 text with a .csv name. */
async function sniff(body: Buffer, name: string): Promise<string | null> {
  const t = await fileTypeFromBuffer(body);
  if (t) return t.mime;
  if (/\.csv$/i.test(name) && !body.includes(0) && Buffer.from(body.toString('utf8'), 'utf8').equals(body)) return 'text/csv';
  return null;
}

export async function quotaFor(institutionId: number, db: Queryable = defaultDb) {
  const { rows } = await db.query<{ plan: string; settings: unknown; used: string }>(
    `SELECT i.plan, i.settings, (SELECT COALESCE(sum(size_bytes), 0) FROM files f WHERE f.institution_id = i.id AND f.deleted_at IS NULL) AS used
       FROM institutions i WHERE i.id = $1`,
    [institutionId]
  );
  const r = rows[0];
  const settings = institutionSettings.safeParse(r?.settings ?? {});
  const quotaMb = (settings.success && settings.data.storage_quota_mb) || PLAN_QUOTA_MB[r?.plan ?? 'free'] || 500;
  return { usedBytes: Number(r?.used ?? 0), quotaBytes: quotaMb * MB };
}

export async function storeUpload(
  input: { institutionId: number; userId: number | null; purpose: FilePurpose; body: Buffer; originalName: string },
  db: Queryable = defaultDb
): Promise<StoredFile> {
  const rule = PURPOSES[input.purpose];
  if (input.body.length === 0) throw badRequest('The file is empty');
  if (input.body.length > rule.maxBytes) throw tooLarge(rule.maxBytes);
  const type = await sniff(input.body, input.originalName);
  if (!type || !(rule.types as readonly string[]).includes(type)) throw unsupported(rule.types);

  let body = input.body;
  let contentType = type;
  if (IMAGE.includes(type) && 'resize' in rule) {
    try {
      body = await sharp(input.body, { limitInputPixels: 40_000_000 })
        .rotate() // honour the camera orientation before the metadata is dropped
        .resize({ width: rule.resize, height: rule.resize, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      contentType = 'image/webp';
    } catch {
      throw badRequest('The image could not be read');
    }
  }

  const scan = await virusScanner().scan(body);
  if (scan.status === 'infected') throw new HttpError(422, 'The file was rejected by the virus scanner', undefined, 'FILE_INFECTED');

  const { usedBytes, quotaBytes } = await quotaFor(input.institutionId, db);
  if (usedBytes + body.length > quotaBytes) {
    throw new HttpError(413, `Your institution's storage is full (${Math.round(quotaBytes / MB)} MB). Delete old files or upgrade the plan.`, undefined, 'QUOTA_EXCEEDED');
  }

  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'text/csv': 'csv', [XLSX]: 'xlsx' }[contentType] ?? 'bin';
  const now = new Date();
  const key = `${input.institutionId}/${input.purpose}/${now.getUTCFullYear()}/${crypto.randomUUID()}.${ext}`;
  await storage().put(key, body, contentType);
  const name = input.originalName.replace(/[\\/\0]/g, '_').slice(0, 200) || `file.${ext}`;
  const { rows } = await db.query<StoredFile>(
    `INSERT INTO files (institution_id, storage_key, original_name, content_type, size_bytes, sha256, purpose, scan_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, original_name, content_type, size_bytes, purpose, storage_key`,
    [input.institutionId, key, name, contentType, body.length, crypto.createHash('sha256').update(body).digest('hex'), input.purpose, scan.status, input.userId]
  );
  return rows[0]!;
}

/** Send a file to the browser: a signed URL redirect when the driver has one, else the bytes. */
export async function sendFile(res: Response, file: StoredFile, { inline = true } = {}) {
  const url = await storage().signedUrl(file.storage_key, { ttlSeconds: 300, filename: file.original_name, contentType: file.content_type, inline });
  if (url) return void res.redirect(302, url);
  const body = await storage().get(file.storage_key);
  res.set({
    'Content-Type': file.content_type,
    'Content-Length': String(body.length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  res.end(body);
}
