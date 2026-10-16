// Regression: course materials, submissions, feedback files and packages must be storable
// (the database check once allowed only photos, documents, imports and logos).
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let f: Awaited<ReturnType<typeof fixture.resetDb>>;
beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('file purposes', () => {
  it('a teacher uploads course material and a student uploads work', async () => {
    const course = await as(f.tokens.t1).upload('post', '/api/files?purpose=course', { buffer: PDF, name: 'notes.pdf' });
    expect(course.status, JSON.stringify(course.body)).toBe(201);
    const work = await as(f.tokens.s1).upload('post', '/api/files?purpose=submission', { buffer: PDF, name: 'essay.pdf' });
    expect(work.status, JSON.stringify(work.body)).toBe(201);
    const fb = await as(f.tokens.t1).upload('post', '/api/files?purpose=feedback', { buffer: PDF, name: 'marked.pdf' });
    expect(fb.status).toBe(201);
  });
});
