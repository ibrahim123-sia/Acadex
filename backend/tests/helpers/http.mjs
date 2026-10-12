import { createRequire } from 'node:module';
import request from 'supertest';

const require = createRequire(import.meta.url);
// Load the CommonJS app natively (not through Vite) so the pg pool is shared with the fixture.
const { createApp } = require('../../app.js');
export const fixture = require('./fixture.cjs');

export const app = createApp();

const withAuth = (req, token) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
export const as = (token) => ({
  get: (url) => withAuth(request(app).get(url), token),
  post: (url, body) => withAuth(request(app).post(url), token).send(body),
  patch: (url, body) => withAuth(request(app).patch(url), token).send(body),
});
export { request };
