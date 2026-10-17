// Outcome-based education under /api/outcomes: program outcomes (PLOs) and course outcomes
// (CLOs), the CLO → PLO mapping matrix, aligning assessments / questions / rubric criteria /
// paper exams to CLOs, attainment per student, class and program, accreditation reports
// (Excel / PDF), and each student's mastery view and skills transcript.
import { Router, type Request } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { id, optionalId, outcomeAlignmentBody, outcomeBody, outcomeMappingBody, patchSchema } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertCanViewStudent, assertInInstitution } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { sendTable } from '../lib/export';
import { institutionSettings } from '../lib/institution';
import { courseAccess, rosterSql } from '../lib/lms/access';
import { cloScores, offeringAttainment, programAttainment, summarize } from '../lib/outcomes';
import { isUniqueViolation } from '../lib/structure';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';

const router = Router();
const read = requireAny('outcomes.manage', 'structure.read', 'teaching.access', 'academics.read');

const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });

/** Teachers who can edit a class of this course may set its CLOs. */
async function assertCourseOutcomeEditor(req: Request, courseId: number) {
  if (userCan(req, 'outcomes.manage')) return;
  const u = currentUser(req);
  if (u.role !== 'teacher') throw forbidden();
  const { rows } = await db.query<{ id: number }>(`SELECT o.id FROM course_offerings o JOIN section_staff ss ON ss.offering_id = o.id WHERE o.course_id = $1 AND ss.teacher_id = $2`, [courseId, u.ref_id]);
  for (const r of rows) if ((await courseAccess(u, r.id)).canEdit) return;
  throw forbidden('Only teachers of this course or the academic office can change its outcomes');
}

async function assertOfferingEditor(req: Request, offeringId: number) {
  if (userCan(req, 'outcomes.manage')) return;
  const a = await courseAccess(currentUser(req), offeringId);
  if (a.role !== 'staff' || !a.canEdit) throw forbidden();
}

// ---------------------------------------------------------------- outcomes

router.get('/outcomes', read, async (req, res) => {
  const q = z.object({ program_id: optionalId, course_id: optionalId, offering_id: optionalId }).parse(req.query);
  const { rows } = await db.query(
    `SELECT lo.*, c.name AS course, p.name AS program,
            (SELECT count(*)::int FROM outcome_alignments a WHERE a.clo_id = lo.id) AS alignments,
            (SELECT COALESCE(json_agg(json_build_object('plo_id', m.plo_id, 'strength', m.strength)), '[]') FROM outcome_mappings m WHERE m.clo_id = lo.id) AS maps_to
       FROM learning_outcomes lo LEFT JOIN courses c ON c.id = lo.course_id LEFT JOIN programs p ON p.id = lo.program_id
      WHERE lo.institution_id = $1 AND ($2::int IS NULL OR lo.program_id = $2) AND ($3::int IS NULL OR lo.course_id = $3)
        AND ($4::int IS NULL OR lo.course_id = (SELECT course_id FROM course_offerings WHERE id = $4))
      ORDER BY lo.level DESC, c.name NULLS FIRST, lo.position, lo.code`,
    [institutionId(req), q.program_id, q.course_id, q.offering_id]
  );
  res.json(rows);
});

router.post('/outcomes', async (req, res) => {
  const b = outcomeBody.parse(req.body);
  const s = institutionId(req);
  if (b.level === 'program') {
    if (!userCan(req, 'outcomes.manage')) throw forbidden();
    await assertInInstitution('programs', b.program_id!, s);
  } else {
    await assertInInstitution('courses', b.course_id!, s);
    await assertCourseOutcomeEditor(req, b.course_id!);
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO learning_outcomes (institution_id, level, program_id, course_id, code, description, bloom_level, pass_percent, target_percent, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, (SELECT count(*) FROM learning_outcomes WHERE institution_id = $1 AND program_id IS NOT DISTINCT FROM $3 AND course_id IS NOT DISTINCT FROM $4)) RETURNING *`,
      [s, b.level, b.program_id, b.course_id, b.code, b.description, b.bloom_level ?? null, b.pass_percent, b.target_percent]
    );
    await auditAs(req, 'create', 'Outcome', `${b.code}: ${b.description.slice(0, 80)}`);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`${b.code} already exists here`, 'DUPLICATE');
    throw e;
  }
});

async function loadOutcome(req: Request, outcomeId: number) {
  const { rows } = await db.query(`SELECT * FROM learning_outcomes WHERE id = $1 AND institution_id = $2`, [outcomeId, institutionId(req)]);
  if (!rows[0]) throw notFound('Outcome not found');
  if (rows[0].level === 'program') {
    if (!userCan(req, 'outcomes.manage')) throw forbidden();
  } else await assertCourseOutcomeEditor(req, rows[0].course_id);
  return rows[0];
}

router.patch('/outcomes/:id', async (req, res) => {
  const o = await loadOutcome(req, id.parse(req.params.id));
  const b = patchSchema({ code: z.string().trim().min(1).max(20), description: z.string().trim().min(1).max(1000), bloom_level: z.string().nullable(), pass_percent: z.coerce.number().min(0).max(100), target_percent: z.coerce.number().min(0).max(100), position: z.coerce.number().int().min(0) }).parse(req.body);
  if (b.bloom_level && !['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'].includes(b.bloom_level)) throw badRequest('Unknown Bloom level');
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to change');
  const params: unknown[] = [o.id];
  const sets = entries.map(([k, v]) => (params.push(v), `${k} = $${params.length}`));
  const { rows } = await db.query(`UPDATE learning_outcomes SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  res.json(rows[0]);
});

router.delete('/outcomes/:id', async (req, res) => {
  const o = await loadOutcome(req, id.parse(req.params.id));
  await db.query(`DELETE FROM learning_outcomes WHERE id = $1`, [o.id]);
  await auditAs(req, 'delete', 'Outcome', o.code);
  res.status(204).end();
});

// ---------------------------------------------------------------- mapping matrix

/** PLOs of a program and the CLOs of every course taught in it, with the mapping. */
router.get('/outcomes/matrix', read, async (req, res) => {
  const programId = id.parse(req.query.program_id);
  await assertInInstitution('programs', programId, institutionId(req));
  const { rows: plos } = await db.query(`SELECT id, code, description FROM learning_outcomes WHERE program_id = $1 AND level = 'program' ORDER BY position, code`, [programId]);
  const { rows: clos } = await db.query(
    `SELECT lo.id, lo.code, lo.description, lo.course_id, c.name AS course, c.code AS course_code FROM learning_outcomes lo JOIN courses c ON c.id = lo.course_id
      WHERE lo.level = 'course' AND lo.course_id IN (SELECT o.course_id FROM course_offerings o JOIN sections sec ON sec.id = o.section_id JOIN program_levels pl ON pl.id = sec.program_level_id WHERE pl.program_id = $1)
      ORDER BY c.name, lo.position, lo.code`,
    [programId]
  );
  const { rows: maps } = await db.query(`SELECT m.clo_id, m.plo_id, m.strength FROM outcome_mappings m JOIN learning_outcomes p ON p.id = m.plo_id WHERE p.program_id = $1`, [programId]);
  res.json({ plos, clos, mappings: maps });
});

router.put('/outcomes/matrix', requirePermission('outcomes.manage'), async (req, res) => {
  const programId = id.parse(req.query.program_id);
  const s = institutionId(req);
  await assertInInstitution('programs', programId, s);
  const b = outcomeMappingBody.parse(req.body);
  const { rows: plos } = await db.query<{ id: number }>(`SELECT id FROM learning_outcomes WHERE program_id = $1 AND level = 'program'`, [programId]);
  const cloIds = [...new Set(b.mappings.map((m) => m.clo_id))];
  const { rows: clos } = await db.query<{ id: number }>(`SELECT id FROM learning_outcomes WHERE id = ANY($1::int[]) AND level = 'course' AND institution_id = $2`, [cloIds, s]);
  if (b.mappings.some((m) => !plos.some((p) => p.id === m.plo_id))) throw badRequest('A mapping names a PLO of another program');
  if (clos.length !== cloIds.length) throw badRequest('A mapping names an unknown CLO');
  await withTransaction(async () => {
    await db.query(`DELETE FROM outcome_mappings WHERE plo_id = ANY($1::int[])`, [plos.map((p) => p.id)]);
    for (const m of b.mappings) await db.query(`INSERT INTO outcome_mappings (institution_id, clo_id, plo_id, strength) VALUES ($1,$2,$3,$4)`, [s, m.clo_id, m.plo_id, m.strength]);
  });
  await auditAs(req, 'map_outcomes', 'Program', `${programId}: ${b.mappings.length} links`);
  res.json({ mappings: b.mappings.length });
});

// ---------------------------------------------------------------- alignment

/** The course (and, when it belongs to one, the class) that an aligned item belongs to. */
async function targetCourse(type: string, targetId: number, inst: number): Promise<{ course_id: number; offering_id: number | null }> {
  const sql: Record<string, string> = {
    assessment: `SELECT o.course_id, o.id AS offering_id FROM assessments x JOIN course_offerings o ON o.id = x.offering_id WHERE x.id = $1 AND x.institution_id = $2`,
    exam_session: `SELECT o.course_id, o.id AS offering_id FROM exam_sessions s JOIN course_offerings o ON o.id = s.offering_id WHERE s.id = $1 AND s.institution_id = $2`,
    question: `SELECT b.course_id, NULL::int AS offering_id FROM questions q JOIN question_banks b ON b.id = q.bank_id WHERE q.id = $1 AND q.institution_id = $2`,
    criterion: `SELECT o.course_id, o.id AS offering_id FROM rubric_criteria c JOIN rubrics r ON r.id = c.rubric_id JOIN course_offerings o ON o.id = r.offering_id WHERE c.id = $1 AND c.institution_id = $2`,
  };
  const { rows } = await db.query(sql[type]!, [targetId, inst]);
  if (!rows[0] || rows[0].course_id == null) throw badRequest('That item is not part of a course');
  return rows[0];
}

/** Set which CLOs an item measures (replaces its previous alignment). */
router.put('/outcomes/alignments', async (req, res) => {
  const b = outcomeAlignmentBody.parse(req.body);
  const s = institutionId(req);
  const t = await targetCourse(b.target_type, b.target_id, s);
  if (t.offering_id) await assertOfferingEditor(req, t.offering_id);
  else await assertCourseOutcomeEditor(req, t.course_id);
  const { rows: clos } = await db.query<{ id: number }>(`SELECT id FROM learning_outcomes WHERE id = ANY($1::int[]) AND course_id = $2 AND level = 'course'`, [b.clo_ids, t.course_id]);
  if (clos.length !== new Set(b.clo_ids).size) throw badRequest("Only this course's own CLOs can be aligned");
  await withTransaction(async () => {
    await db.query(`DELETE FROM outcome_alignments WHERE target_type = $1 AND target_id = $2 AND institution_id = $3`, [b.target_type, b.target_id, s]);
    // an item measuring several CLOs counts fully for each
    for (const c of b.clo_ids) await db.query(`INSERT INTO outcome_alignments (institution_id, clo_id, target_type, target_id) VALUES ($1,$2,$3,$4)`, [s, c, b.target_type, b.target_id]);
  });
  res.json({ aligned: b.clo_ids.length });
});

router.get('/outcomes/alignments', read, async (req, res) => {
  const offeringId = id.parse(req.query.offering_id);
  await assertInInstitution('course_offerings', offeringId, institutionId(req));
  const { rows } = await db.query(
    `SELECT a.id, a.clo_id, lo.code, a.target_type, a.target_id, a.weight,
            COALESCE(x.title, q.prompt_html, c.title, es.name) AS label
       FROM outcome_alignments a JOIN learning_outcomes lo ON lo.id = a.clo_id JOIN course_offerings o ON o.course_id = lo.course_id AND o.id = $1
       LEFT JOIN assessments x ON a.target_type = 'assessment' AND x.id = a.target_id
       LEFT JOIN questions q ON a.target_type = 'question' AND q.id = a.target_id
       LEFT JOIN rubric_criteria c ON a.target_type = 'criterion' AND c.id = a.target_id
       LEFT JOIN exam_sessions s ON a.target_type = 'exam_session' AND s.id = a.target_id LEFT JOIN exam_series es ON es.id = s.series_id
      ORDER BY lo.position, lo.code, a.target_type`,
    [offeringId]
  );
  res.json(rows.map((r) => ({ ...r, label: String(r.label ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) })));
});

// ---------------------------------------------------------------- attainment and reports

router.get('/outcomes/attainment/offering/:id', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  if (!userCan(req, 'outcomes.manage') && !userCan(req, 'academics.read')) {
    const a = await courseAccess(currentUser(req), offeringId);
    if (a.role !== 'staff') throw forbidden();
  } else await assertInInstitution('course_offerings', offeringId, institutionId(req));
  const att = await offeringAttainment(offeringId);
  const { rows: names } = await db.query<{ id: number; name: string; roll_no: string | null }>(`SELECT st.id, st.first_name || ' ' || st.last_name AS name, st.roll_no FROM students st WHERE st.id IN (${rosterSql('$1')})`, [offeringId]);
  if (req.query.format === 'csv' || req.query.format === 'xlsx') {
    await sendTable(
      res,
      `clo-attainment-${offeringId}`,
      ['Roll no', 'Student', ...att.map((c) => `${c.code} %`)],
      names.map((n) => [n.roll_no, n.name, ...att.map((c) => c.per_student.find((p) => p.student_id === n.id)?.percent ?? '')]),
      req.query.format
    );
    return;
  }
  res.json({ clos: att, students: names });
});

router.get('/outcomes/attainment/program/:id', requireAny('outcomes.manage', 'academics.read'), async (req, res) => {
  const programId = id.parse(req.params.id);
  await assertInInstitution('programs', programId, institutionId(req));
  const termId = optionalId.parse(req.query.term_id);
  const r = await programAttainment(programId, termId);
  res.json({ plos: r.plos.map(({ per_student: _p, ...x }) => x), courses: r.courses });
});

/** Accreditation report: PLO attainment, the mapping matrix and each course's CLO attainment. */
router.get('/outcomes/report/:programId', requireAny('outcomes.manage', 'academics.read'), async (req, res) => {
  const programId = id.parse(req.params.programId);
  const inst = institutionId(req);
  await assertInInstitution('programs', programId, inst);
  const termId = optionalId.parse(req.query.term_id);
  const { rows: prog } = await db.query(`SELECT name, code FROM programs WHERE id = $1`, [programId]);
  const r = await programAttainment(programId, termId);
  if (req.query.format !== 'pdf') {
    const rows: (string | number | null)[][] = [];
    for (const p of r.plos) rows.push(['PLO', p.code, p.description, p.students, p.attainment_percent, p.target_percent, p.met == null ? '' : p.met ? 'Met' : 'Not met']);
    for (const c of r.courses) for (const clo of c.clos) rows.push([`CLO — ${c.course}${c.section_name ? ` (${c.section_name})` : ''}`, clo.code, clo.description, clo.students, clo.attainment_percent, clo.target_percent, clo.met == null ? '' : clo.met ? 'Met' : 'Not met']);
    await sendTable(res, `obe-report-${prog[0].code ?? programId}`, ['Level', 'Code', 'Outcome', 'Students', 'Attainment %', 'Target %', 'Status'], rows, req.query.format === 'csv' ? 'csv' : 'xlsx');
    return;
  }
  const ins = await institutionSettings(inst);
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="obe-report-${programId}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).text(`${ins?.name ?? ''}`, { align: 'left' });
  doc.font('Helvetica').fontSize(12).fillColor('#374151').text(`Outcome attainment report — ${prog[0].name}`).moveDown();
  const section = (title: string) => doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(title).moveDown(0.3);
  const line = (code: string, text: string, att: number | null, target: number, met: boolean | null, n: number) => {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(met === false ? '#b91c1c' : '#111827').text(`${code}  ${att == null ? '—' : `${att}%`} of ${n} students (target ${target}%)${met == null ? '' : met ? ' — met' : ' — not met'}`);
    doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(text).moveDown(0.3);
  };
  section('Program learning outcomes');
  for (const p of r.plos) line(p.code, p.description, p.attainment_percent, p.target_percent, p.met, p.students);
  for (const c of r.courses) {
    section(`${c.course}${c.section_name ? ` — ${c.section_name}` : ''}`);
    for (const clo of c.clos) line(clo.code, clo.description, clo.attainment_percent, clo.target_percent, clo.met, clo.students);
  }
  doc.end();
});

/** A student's mastery: each CLO of their courses and each PLO of their program (released grades only). */
async function mastery(studentId: number, inst: number) {
  const { rows: offerings } = await db.query<{ id: number; course: string; course_id: number }>(
    `SELECT DISTINCT o.id, co.name AS course, o.course_id FROM course_offerings o JOIN courses co ON co.id = o.course_id
      WHERE o.institution_id = $2 AND EXISTS (SELECT 1 FROM learning_outcomes lo WHERE lo.course_id = o.course_id) AND $1 IN (${rosterSql('o.id')})`,
    [studentId, inst]
  );
  const courses: { course: string; clos: { code: string; description: string; percent: number | null; attained: boolean | null }[] }[] = [];
  const cloPct = new Map<number, number>();
  for (const o of offerings) {
    const { rows: clos } = await db.query<{ id: number; code: string; description: string; pass_percent: string; target_percent: string }>(`SELECT id, code, description, pass_percent, target_percent FROM learning_outcomes WHERE course_id = $1 ORDER BY position, code`, [o.course_id]);
    const scores = (await cloScores(o.id, clos.map((c) => c.id), true)).filter((s) => s.student_id === studentId);
    for (const s of scores) cloPct.set(s.clo_id, s.percent);
    courses.push({
      course: o.course,
      clos: clos.map((c) => {
        const sc = scores.find((s) => s.clo_id === c.id);
        return { code: c.code, description: c.description, percent: sc?.percent ?? null, attained: sc ? sc.percent >= Number(c.pass_percent) : null };
      }),
    });
  }
  const { rows: plos } = await db.query<{ id: number; code: string; description: string; pass_percent: string; target_percent: string }>(
    `SELECT lo.id, lo.code, lo.description, lo.pass_percent, lo.target_percent FROM learning_outcomes lo JOIN program_levels pl ON pl.program_id = lo.program_id JOIN sections sec ON sec.program_level_id = pl.id JOIN students st ON st.section_id = sec.id
      WHERE st.id = $1 AND lo.level = 'program' ORDER BY lo.position, lo.code`,
    [studentId]
  );
  const { rows: maps } = await db.query<{ clo_id: number; plo_id: number; strength: number }>(`SELECT clo_id, plo_id, strength FROM outcome_mappings WHERE plo_id = ANY($1::int[])`, [plos.map((p) => p.id)]);
  const programs = plos.map((p) => {
    const mine = maps.filter((m) => m.plo_id === p.id && cloPct.has(m.clo_id));
    const w = mine.reduce((n, m) => n + m.strength, 0);
    const pct = w ? Math.round((mine.reduce((n, m) => n + cloPct.get(m.clo_id)! * m.strength, 0) / w) * 100) / 100 : null;
    const s = summarize(p, pct == null ? [] : [{ student_id: studentId, percent: pct }]);
    return { code: p.code, description: p.description, percent: pct, attained: s.per_student[0]?.attained ?? null };
  });
  return { courses, programs };
}

router.get('/outcomes/students/:id', async (req, res) => {
  const sid = id.parse(req.params.id);
  if (!userCan(req, 'outcomes.manage') && !userCan(req, 'academics.read')) await assertCanViewStudent(currentUser(req), sid, { allowTeachers: true, guardian: 'grades' });
  else await assertInInstitution('students', sid, institutionId(req));
  res.json(await mastery(sid, institutionId(req)));
});

router.get('/outcomes/students/:id/skills.pdf', async (req, res) => {
  const sid = id.parse(req.params.id);
  if (!userCan(req, 'outcomes.manage') && !userCan(req, 'academics.read')) await assertCanViewStudent(currentUser(req), sid, { allowTeachers: true, guardian: 'grades' });
  const inst = institutionId(req);
  const { rows: st } = await db.query(`SELECT first_name || ' ' || last_name AS name, roll_no FROM students WHERE id = $1 AND institution_id = $2`, [sid, inst]);
  if (!st[0]) throw notFound('Student not found');
  const m = await mastery(sid, inst);
  const ins = await institutionSettings(inst);
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="skills-${st[0].roll_no ?? sid}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).text(ins?.name ?? '');
  doc.font('Helvetica').fontSize(12).fillColor('#374151').text(`Skills transcript — ${st[0].name}${st[0].roll_no ? ` (${st[0].roll_no})` : ''}`).moveDown();
  const bar = (label: string, desc: string, pct: number | null, ok: boolean | null) => {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(label, 40, y, { width: 60 });
    doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(desc, 100, y, { width: 300 });
    doc.rect(410, y + 2, 100, 8).fill('#e5e7eb');
    if (pct != null) doc.rect(410, y + 2, Math.max(1, Math.min(100, pct)), 8).fill(ok ? '#059669' : '#d97706');
    doc.fillColor('#111827').fontSize(9).text(pct == null ? '—' : `${pct}%`, 515, y, { width: 40, align: 'right' });
    doc.y = Math.max(doc.y, y + 14) + 4;
  };
  if (m.programs.length) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Program outcomes', 40).moveDown(0.3);
    for (const p of m.programs) bar(p.code, p.description, p.percent, p.attained);
    doc.moveDown();
  }
  for (const c of m.courses) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(c.course, 40).moveDown(0.3);
    for (const clo of c.clos) bar(clo.code, clo.description, clo.percent, clo.attained);
    doc.moveDown(0.5);
  }
  doc.end();
});

export default router;
