// A PATCH changes only the fields it sends: defaults of the create schema must never reset the
// others (Zod fills defaults into partial objects unless they are stripped).
import { describe, it, expect, beforeAll } from 'vitest';
import { assessmentPatch, updateCampusBody, contentItemPatch } from '@acadex/shared';
import { as, fixture } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('PATCH keeps what it does not mention', () => {
  it('the schemas add no defaults', () => {
    expect(updateCampusBody.parse({ name: 'North' })).toEqual({ name: 'North' });
    expect(assessmentPatch.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(contentItemPatch.parse({ title: 'x' })).toEqual({ title: 'x' });
  });

  it('renaming a campus keeps its address', async () => {
    const A = as(f.tokens.adminA);
    const c = await A.post('/api/institution/campuses', { name: 'North', code: 'NTH', address: '1 Mall Road', phone: '042-1' });
    expect((await A.patch(`/api/institution/campuses/${c.body.id}`, { name: 'North Campus' })).status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT name, address, phone FROM campuses WHERE id = $1`, [c.body.id]);
    expect(rows[0]).toEqual({ name: 'North Campus', address: '1 Mall Road', phone: '042-1' });
  });

  it('moving an assessment to a category keeps it published', async () => {
    const t1 = as(f.tokens.t1);
    const cat = await t1.post(`/api/courses/${f.subjects.A1math.id}/grade-categories`, { name: 'Homework', weight: 50 });
    expect((await t1.patch(`/api/assessments/${f.assignments.ASG1.id}`, { category_id: cat.body.id })).status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT status, kind, points, category_id FROM assessments WHERE id = $1`, [f.assignments.ASG1.id]);
    expect(rows[0]).toEqual({ status: 'published', kind: 'assignment', points: '100.00', category_id: cat.body.id });
  });
});
