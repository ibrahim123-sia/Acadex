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
  delete: (url: string) => withAuth(request(app).delete(url), token),
});
