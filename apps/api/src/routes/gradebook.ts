// The gradebook of a course: every student × every assessment, weighted categories with drop
// lowest, the course grade on the student's grading scheme, teacher overrides, locking, and
// CSV / Excel export. Students and guardians see released grades only. Mounted under /api.
import { Router } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import { categoryBody, finalOverrideBody, gradeFor, id } from '@acadex/shared';
import { db } from '../db/context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { schemeForStudent } from '../lib/grading';
import { assertCourseEditor, assertCourseMember, rosterSql } from '../lib/lms/access';
import { coursePercent, earned, gradebookData } from '../lib/lms/gradebook';
import { currentUser, institutionId, requireAny, userCan } from '../middleware/auth';
import { assertGradebookOpen } from './assessments';

const router = Router();

async function buildGradebook(offeringId: number, institution: number, opts: { studentIds?: number[]; releasedOnly?: boolean } = {}) {
  const data = await gradebookData(offeringId, opts);
  const { rows: students } = await db.query<{ id: number; name: string; roll_no: string | null }>(
    `SELECT st.id, st.first_name || ' ' || st.last_name AS name, st.roll_no FROM students st
      WHERE st.id IN (${rosterSql('$1')}) AND ($2::int[] IS NULL OR st.id = ANY($2::int[])) ORDER BY st.roll_no NULLS LAST, st.first_name`,
    [offeringId, opts.studentIds ?? null]
  );
  const scheme = students[0] ? await schemeForStudent(students[0].id, institution) : null;
  const rows = students.map((s) => {
    const cells = data.byStudent.get(s.id) ?? new Map();
    const computed = coursePercent(data.columns, data.categories, cells);
    const override = data.override.get(s.id) ?? null;
    const percent = override?.percent ?? computed;
    return {
      student_id: s.id,
      name: s.name,
      roll_no: s.roll_no,
      grades: Object.fromEntries(
        data.columns.map((c) => {
          const g = cells.get(c.id);
          return [c.id, g ? { points: g.points, earned: earned(g), excused: g.excused, missing: g.missing, late_penalty_percent: g.late_penalty_percent, status: g.status } : null];
        })
      ),
      computed_percent: computed,
      override,
      percent,
      grade: percent == null || !scheme ? null : gradeFor(scheme, percent),
    };
  });
  return { columns: data.columns, categories: data.categories, scheme, rows };
}

router.get('/courses/:id/gradebook', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseMember(req, offeringId);
  if (a.role === 'staff') {
    return void res.json({ course: a.course, can_edit: a.canEdit, locked_at: a.course.gradebook_locked_at, ...(await buildGradebook(offeringId, institutionId(req))) });
  }
  // students and guardians: their own row, released grades only
  const sid = Number(req.query.student_id) || a.studentIds[0]!;
  if (!a.studentIds.includes(sid)) throw forbidden();
  const gb = await buildGradebook(offeringId, institutionId(req), { studentIds: [sid], releasedOnly: true });
  res.json({ course: a.course, columns: gb.columns, categories: gb.categories, scheme: gb.scheme, row: gb.rows[0] ?? null });
});

router.get('/courses/:id/gradebook/export', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseMember(req, offeringId);
  if (a.role !== 'staff') throw forbidden();
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const gb = await buildGradebook(offeringId, institutionId(req));
  const header = ['Roll no', 'Student', ...gb.columns.map((c) => `${c.title} (/${c.points})`), 'Course %', 'Grade', 'Override reason'];
  const table = gb.rows.map((r) => [
    r.roll_no ?? '',
    r.name,
    ...gb.columns.map((c) => {
      const g = r.grades[c.id];
      if (!g) return '';
      if (g.excused) return 'EX';
      if (g.missing && g.points == null) return 'MISSING';
      return g.earned ?? '';
    }),
    r.percent ?? '',
    r.grade?.label ?? '',
    r.override?.reason ?? '',
  ]);
  const name = `gradebook-${a.course.code}-${a.course.section_name ?? offeringId}`.replace(/[^A-Za-z0-9_-]+/g, '-');
  if (format === 'csv') {
    const cell = (v: unknown) => {
      const s = String(v ?? '');
      // quote, and defuse spreadsheet formulas
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
    return void res.send(String.fromCharCode(0xfeff) + [header, ...table].map((r) => r.map(cell).join(',')).join('\r\n'));
  }
  const data = [header.map((h) => ({ value: h, fontWeight: 'bold' as const })), ...table.map((r) => r.map((v) => ({ value: typeof v === 'number' ? v : String(v), type: typeof v === 'number' ? Number : String })))];
  const buf = await writeXlsxFile(data as never, { buffer: true } as never);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` });
  res.send(buf);
});

// ---------------------------------------------------------------- categories

router.get('/courses/:id/grade-categories', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseMember(req, offeringId);
  const { rows } = await db.query(`SELECT id, name, weight, drop_lowest, position FROM grade_categories WHERE offering_id = $1 ORDER BY position, id`, [offeringId]);
  res.json(rows);
});

router.post('/courses/:id/grade-categories', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseEditor(req, offeringId);
  assertGradebookOpen(a);
  const b = categoryBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO grade_categories (institution_id, offering_id, name, weight, drop_lowest, position)
     VALUES ($1,$2,$3,$4,$5, (SELECT COALESCE(max(position) + 1, 0) FROM grade_categories WHERE offering_id = $2))
     ON CONFLICT ON CONSTRAINT grade_categories_offering_id_name_key DO NOTHING RETURNING *`,
    [institutionId(req), offeringId, b.name, b.weight, b.drop_lowest]
  );
  if (!rows[0]) throw conflict('This course already has a category with that name', 'DUPLICATE');
  res.status(201).json(rows[0]);
});

async function categoryCourse(categoryId: number, s: number) {
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM grade_categories WHERE id = $1 AND institution_id = $2`, [categoryId, s]);
  if (!rows[0]) throw notFound();
  return rows[0].offering_id;
}

router.patch('/grade-categories/:id', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const catId = id.parse(req.params.id);
  const a = await assertCourseEditor(req, await categoryCourse(catId, institutionId(req)));
  assertGradebookOpen(a);
  const b = categoryBody.parse(req.body);
  const { rows } = await db.query(`UPDATE grade_categories SET name = $2, weight = $3, drop_lowest = $4 WHERE id = $1 RETURNING *`, [catId, b.name, b.weight, b.drop_lowest]);
  res.json(rows[0]);
});

router.delete('/grade-categories/:id', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const catId = id.parse(req.params.id);
  const a = await assertCourseEditor(req, await categoryCourse(catId, institutionId(req)));
  assertGradebookOpen(a);
  await db.query(`DELETE FROM grade_categories WHERE id = $1`, [catId]);
  res.status(204).end();
});

// ---------------------------------------------------------------- overrides & locking

router.put('/courses/:id/final-overrides', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseEditor(req, offeringId);
  assertGradebookOpen(a);
  const b = finalOverrideBody.parse(req.body);
  const { rows } = await db.query(`SELECT 1 FROM (${rosterSql('$1')}) r WHERE r.id = $2`, [offeringId, b.student_id]);
  if (!rows[0]) throw badRequest('This student is not in the course');
  if (b.percent == null) {
    await db.query(`DELETE FROM final_grade_overrides WHERE offering_id = $1 AND student_id = $2`, [offeringId, b.student_id]);
    return void res.status(204).end();
  }
  if (!b.reason) throw badRequest('Say why the course grade is set by hand', { reason: 'required' });
  const { rows: out } = await db.query(
    `INSERT INTO final_grade_overrides (institution_id, offering_id, student_id, percent, reason, set_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ON CONSTRAINT final_grade_overrides_offering_id_student_id_key DO UPDATE SET percent = EXCLUDED.percent, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = now()
     RETURNING *`,
    [institutionId(req), offeringId, b.student_id, b.percent, b.reason, currentUser(req).id]
  );
  res.json(out[0]);
});

/** Lock after results are published: nothing in the gradebook can change. */
router.post('/courses/:id/gradebook/lock', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { rows } = await db.query(`UPDATE course_offerings SET gradebook_locked_at = COALESCE(gradebook_locked_at, now()) WHERE id = $1 RETURNING gradebook_locked_at`, [offeringId]);
  res.json(rows[0]);
});

/** Unlocking a published gradebook is an administrator's decision. */
router.post('/courses/:id/gradebook/unlock', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  if (!userCan(req, 'courses.manage_any')) throw forbidden('Only an administrator can unlock a gradebook');
  await db.query(`UPDATE course_offerings SET gradebook_locked_at = NULL WHERE id = $1`, [offeringId]);
  res.json({ gradebook_locked_at: null });
});

export default router;
