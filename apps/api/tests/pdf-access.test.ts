// Bug #6: report cards and fee vouchers are only for people linked to that student.
//   report card: school admin, the student, a linked parent, teachers of the student's class
//   fee voucher: school admin, the student, a linked parent (not teachers)
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
});

const REPORT_CARD_S1 = {
  adminA: 200,
  s1: 200,
  p1: 200,
  t1: 200, // teaches class A1
  s2: 403, // classmate
  t2: 403, // teaches a different class
  adminB: 404, // other school: the student does not exist for them
  sb: 404,
  tb: 404,
  super: 403,
};

const FEE_VOUCHER_F1 = {
  adminA: 200,
  s1: 200,
  p1: 200,
  t1: 403,
  s2: 403,
  t2: 403,
  adminB: 404,
  sb: 404,
  super: 403,
};

describe('report card PDF', () => {
  for (const [who, status] of Object.entries(REPORT_CARD_S1)) {
    it(`${who} → ${status}`, async () => {
      const res = await as(f.tokens[who]).get(`/api/pdf/report-card/${f.students.S1.id}`);
      expect(res.status).toBe(status);
      if (status === 200) expect(res.headers['content-type']).toContain('application/pdf');
    });
  }

  it('a parent cannot get a report card for a child that is not theirs', async () => {
    const res = await as(f.tokens.p1).get(`/api/pdf/report-card/${f.students.S2.id}`);
    expect(res.status).toBe(403);
  });
});

describe('fee voucher PDF', () => {
  for (const [who, status] of Object.entries(FEE_VOUCHER_F1)) {
    it(`${who} → ${status}`, async () => {
      const res = await as(f.tokens[who]).get(`/api/pdf/fee-voucher/${f.fees.F1.id}`);
      expect(res.status).toBe(status);
      if (status === 200) expect(res.headers['content-type']).toContain('application/pdf');
    });
  }

  it("a student cannot get another student's voucher", async () => {
    const res = await as(f.tokens.s1).get(`/api/pdf/fee-voucher/${f.fees.F3.id}`);
    expect(res.status).toBe(403);
  });
});
