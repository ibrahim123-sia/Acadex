import request from 'supertest';
import { createApp } from '../../src/app';
import * as fixture from './fixture';

export { fixture, request };

export const app = createApp();

const withAuth = (req: request.Test, token?: string | null) => {
  req.set('X-Acadex-Client', 'web');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

/** Requests as the holder of `token` (or anonymously with null). */
export const as = (token?: string | null) => ({
  get: (url: string) => withAuth(request(app).get(url), token),
  post: (url: string, body?: unknown) => withAuth(request(app).post(url), token).send(body as object),
  patch: (url: string, body?: unknown) => withAuth(request(app).patch(url), token).send(body as object),
  put: (url: string, body?: unknown) => withAuth(request(app).put(url), token).send(body as object),
  delete: (url: string, body?: unknown) => withAuth(request(app).delete(url), token).send(body as object),
  /** multipart upload: one file in the "file" field plus text fields */
  upload: (method: 'post' | 'put', url: string, file: { buffer: Buffer; name: string }, fields: Record<string, string> = {}) => {
    let r = withAuth(request(app)[method](url), token).attach('file', file.buffer, file.name);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  },
});
