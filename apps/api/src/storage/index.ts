// File storage behind one interface. Development keeps files on disk; production uses any
// S3-compatible store (AWS S3, Cloudflare R2, MinIO) and hands browsers short-lived signed URLs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../config';

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** A short-lived URL the browser can fetch directly, or null to stream through the API. */
  signedUrl(key: string, opts: { ttlSeconds: number; filename: string; contentType: string; inline: boolean }): Promise<string | null>;
}

const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error(`unsafe storage key: ${key}`);
  return key;
};

export class LocalStorage implements StorageDriver {
  readonly name = 'local';
  constructor(private readonly root: string) {}
  private file(key: string) {
    return path.join(path.resolve(this.root), ...safeKey(key).split('/'));
  }
  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body);
  }
  async get(key: string) {
    return fs.readFile(this.file(key));
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
  async signedUrl() {
    return null; // streamed by the API after its own access check
  }
}

export class S3Storage implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;
  constructor(private readonly opts: NonNullable<ReturnType<typeof getConfig>['storage']['s3']>) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: safeKey(key) }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: safeKey(key) }));
  }
  async signedUrl(key: string, o: { ttlSeconds: number; filename: string; contentType: string; inline: boolean }) {
    const disposition = `${o.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(o.filename)}`;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: safeKey(key), ResponseContentDisposition: disposition, ResponseContentType: o.contentType }),
      { expiresIn: o.ttlSeconds }
    );
  }
}

let driver: StorageDriver | undefined;
export function storage(): StorageDriver {
  if (!driver) {
    const c = getConfig().storage;
    driver = c.driver === 's3' && c.s3 ? new S3Storage(c.s3) : new LocalStorage(c.localDir);
  }
  return driver;
}
/** Tests: swap the driver. */
export function setStorage(d: StorageDriver | undefined) {
  driver = d;
}
