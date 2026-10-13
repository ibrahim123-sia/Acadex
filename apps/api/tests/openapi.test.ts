// The API description must cover every route the server actually has.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, buildOpenApi } from '../src/openapi';
import { app, request } from './helpers/http';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const MOUNTS: Record<string, string> = {
  'auth.ts': '/api/auth',
  'platform.ts': '/api/platform',
  'school.ts': '/api/school',
  'roles.ts': '/api/school',
  'me.ts': '/api/me',
  'parent.ts': '/api/parent',
  'pdf.ts': '/api/pdf',
};

function declaredRoutes(): string[] {
  const out: string[] = [];
  for (const [file, prefix] of Object.entries(MOUNTS)) {
    const code = fs.readFileSync(path.join(src, 'routes', file), 'utf8');
    for (const m of code.matchAll(/router\.(get|post|patch|delete)\('([^']+)'/g)) out.push(`${m[1]} ${prefix}${m[2]}`);
  }
  const appCode = fs.readFileSync(path.join(src, 'app.ts'), 'utf8');
  for (const m of appCode.matchAll(/app\.(get|post)\('(\/api\/[^']+)'/g)) if (!m[2]!.includes('openapi') && !m[2]!.includes('docs')) out.push(`${m[1]} ${m[2]}`);
  return out.sort();
}

describe('OpenAPI', () => {
  it('documents every route, and nothing that does not exist', () => {
    const documented = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(documented).toEqual(declaredRoutes());
  });

  it('is served as valid OpenAPI 3.1 JSON with request schemas', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const login = res.body.paths['/api/auth/login'].post;
    expect(login.requestBody.content['application/json'].schema.properties).toHaveProperty('email');
    expect(res.body.paths['/api/platform/schools/{id}'].patch.description).toContain('platform.schools.manage');
    expect(Object.keys(buildOpenApi().paths).length).toBeGreaterThan(50);
  });

  it('has a docs page', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/api/openapi.json');
  });
});
