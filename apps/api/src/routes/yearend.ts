// Year-end tools: preview who moves where, create next year's classes, promote / repeat /
// graduate / mark leavers in one go, advance university batches, and archive a finished
// year (read-only from then on). Mounted under /api/institution.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { id, promotionBody, promotionPreviewQuery } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
import { assertCampusAllowed, campusesFor } from '../lib/structure';
import { auth, currentUser, institutionId, requirePermission } from '../middleware/auth';

const router = Router();
router.use(auth);
const manage = requirePermission('year_end.manage');

async function year(req: Request, yearId: number) {
  const { rows } = await db.query<{ id: number; name: string; starts_on: string; status: string; is_current: boolean }>(
    `SELECT id, name, starts_on, status, is_current FROM academic_years WHERE id = $1 AND institution_id = $2`,
    [yearId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('Academic year not found');
  return rows[0];
}

/** Sections of a year with their level, the program's next level, and the campus. */
async function sectionsOf(req: Request, yearId: number) {
  const { rows } = await db.query<{
    id: number; code: string; name: string; label: string; campus_id: number | null; campus_name: string | null; program_level_id: number | null;
    level_name: string | null; program_id: number | null; program_name: string | null; next_level_id: number | null; next_level_name: string | null; students: number;
  }>(
    `SELECT s.id, s.code, s.name, COALESCE(s.label, '') AS label, s.campus_id, cm.name AS campus_name, s.program_level_id, l.name AS level_name,
            l.program_id, p.name AS program_name, nl.id AS next_level_id, nl.name AS next_level_name,
            (SELECT count(*)::int FROM students st WHERE st.section_id = s.id AND st.status = 'active') AS students
       FROM sections s LEFT JOIN campuses cm ON cm.id = s.campus_id LEFT JOIN program_levels l ON l.id = s.program_level_id
       LEFT JOIN programs p ON p.id = l.program_id
       LEFT JOIN LATERAL (SELECT id, name FROM program_levels x WHERE x.program_id = l.program_id AND x.sequence > l.sequence ORDER BY x.sequence LIMIT 1) nl ON true
      WHERE s.institution_id = $1 AND s.academic_year_id = $2
      ORDER BY p.name NULLS LAST, l.sequence NULLS LAST, s.label, s.id`,
    [institutionId(req), yearId]
  );
  const scope = campusesFor(req, 'year_end.manage');
  return scope === null ? rows : rows.filter((r) => r.campus_id != null && scope.includes(r.campus_id));
}

/**
 * Who would go where: everyone moves to the section of the next level with the same label on
 * the same campus; the final level graduates. Nothing is changed.
 */
router.get('/year-end/preview', manage, async (req, res) => {
  const q = promotionPreviewQuery.parse(req.query);
  if (q.from_year_id === q.to_year_id) throw badRequest('Choose two different years');
  const [from, to] = [await year(req, q.from_year_id), await year(req, q.to_year_id)];
  const [fromSections, toSections] = [await sectionsOf(req, from.id), await sectionsOf(req, to.id)];
  const target = (levelId: number | null, label: string, campus: number | null) =>
    toSections.find((t) => t.program_level_id === levelId && t.label === label && t.campus_id === campus) ??
    toSections.find((t) => t.program_level_id === levelId && t.campus_id === campus) ??
    null;
  const sections = fromSections.map((s) => {
    const next = s.next_level_id ? target(s.next_level_id, s.label, s.campus_id) : null;
    const same = target(s.program_level_id, s.label, s.campus_id);
    return {
      ...s,
      default_action: s.next_level_id ? 'promoted' : s.program_level_id ? 'graduated' : 'promoted',
      promote_to: next && { id: next.id, name: next.name, label: next.label },
      repeat_to: same && { id: same.id, name: same.name, label: same.label },
      missing_target: !!s.next_level_id && !next,
    };
  });
  const { rows: students } = await db.query(
    `SELECT st.id AS student_id, st.first_name, st.last_name, st.roll_no, st.section_id AS from_section_id
       FROM students st WHERE st.institution_id = $1 AND st.status = 'active' AND st.section_id = ANY($2::int[])
      ORDER BY st.section_id, st.roll_no NULLS LAST, st.first_name`,
    [institutionId(req), fromSections.map((s) => s.id)]
  );
  res.json({
    from,
    to,
    sections,
    to_sections: toSections.map((t) => ({ id: t.id, name: t.name, label: t.label, level_name: t.level_name, campus_name: t.campus_name })),
    moves: students.map((st) => {
      const sec = sections.find((s) => s.id === st.from_section_id)!;
      return {
        ...st,
        action: sec.default_action,
        to_section_id: sec.default_action === 'promoted' ? (sec.promote_to?.id ?? null) : null,
      };
    }),
  });
});

/** Create next year's classes: every level that has a class now, plus the level above it. */
router.post('/year-end/prepare-sections', manage, async (req, res) => {
  const q = promotionPreviewQuery.parse(req.body);
  const [from, to] = [await year(req, q.from_year_id), await year(req, q.to_year_id)];
  if (to.status === 'archived') throw conflict('The target year is archived', 'ARCHIVED');
  const fromSections = await sectionsOf(req, from.id);
  const existing = await sectionsOf(req, to.id);
  const suffix = to.starts_on.slice(0, 4);
  const wanted = new Map<string, { level: number; name: string; label: string; campus: number | null; base: string }>();
  for (const s of fromSections) {
    if (!s.program_level_id) continue;
    const base = s.code.replace(/-\d{4}$/, '');
    wanted.set(`${s.program_level_id}|${s.label}|${s.campus_id}`, { level: s.program_level_id, name: s.level_name ?? s.name, label: s.label, campus: s.campus_id, base });
    if (s.next_level_id) {
      const nextBase = fromSections.find((x) => x.program_level_id === s.next_level_id && x.label === s.label && x.campus_id === s.campus_id)?.code.replace(/-\d{4}$/, '');
      wanted.set(`${s.next_level_id}|${s.label}|${s.campus_id}`, {
        level: s.next_level_id,
        name: s.next_level_name!,
        label: s.label,
        campus: s.campus_id,
        base: nextBase ?? `${s.next_level_name!.replace(/[^A-Za-z0-9]+/g, '').slice(0, 12)}-${s.label || 'A'}`,
      });
    }
  }
  const created = await withTransaction(async (client) => {
    const out: Record<string, unknown>[] = [];
    for (const [key, w] of wanted) {
      if (existing.some((e) => `${e.program_level_id}|${e.label}|${e.campus_id}` === key)) continue;
      let code = `${w.base}-${suffix}`;
      for (let n = 2; (await client.query(`SELECT 1 FROM sections WHERE institution_id = $1 AND code = $2`, [institutionId(req), code])).rows[0]; n++) code = `${w.base}-${suffix}-${n}`;
      out.push(
        (
          await client.query(
            `INSERT INTO sections (institution_id, code, name, label, campus_id, program_level_id, academic_year_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code, name, label`,
            [institutionId(req), code, w.name, w.label, w.campus, w.level, to.id]
          )
        ).rows[0]
      );
    }
    return out;
  });
  res.status(201).json({ created });
});

/** Apply the moves: all of them or none. */
router.post('/year-end/promote', manage, async (req, res) => {
  const { moves } = promotionBody.parse(req.body);
  const s = institutionId(req);
  const scope = campusesFor(req, 'year_end.manage');
  const { rows: students } = await db.query<{ id: number; section_id: number | null; campus_id: number | null; status: string }>(
    `SELECT st.id, st.section_id, sec.campus_id, st.status FROM students st LEFT JOIN sections sec ON sec.id = st.section_id
      WHERE st.id = ANY($1::int[]) AND st.institution_id = $2`,
    [moves.map((m) => m.student_id), s]
  );
  const missing = moves.filter((m) => !students.some((st) => st.id === m.student_id)).map((m) => m.student_id);
  if (missing.length) throw badRequest('Some students are not in this institution', { student_ids: missing });
  const inactive = students.filter((st) => st.status !== 'active').map((st) => st.id);
  if (inactive.length) throw badRequest('Some students are no longer active', { student_ids: inactive });
  for (const st of students) assertCampusAllowed(scope, st.campus_id);
  const targetIds = [...new Set(moves.map((m) => m.to_section_id).filter((x): x is number => !!x))];
  const { rows: targets } = await db.query<{ id: number; campus_id: number | null; status: string; year_status: string | null }>(
    `SELECT s.id, s.campus_id, s.status, ay.status AS year_status FROM sections s LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
      WHERE s.id = ANY($1::int[]) AND s.institution_id = $2`,
    [targetIds, s]
  );
  for (const tid of targetIds) {
    const t = targets.find((x) => x.id === tid);
    if (!t) throw badRequest('A target class is not in this institution', { to_section_id: tid });
    if (t.status === 'archived' || t.year_status === 'archived') throw conflict('A target class is archived', 'ARCHIVED');
    assertCampusAllowed(scope, t.campus_id);
  }
  const today = todayIn(await institutionTimeZone(s));
  const counts = { promoted: 0, repeated: 0, graduated: 0, left: 0 };
  await withTransaction(async (client) => {
    for (const m of moves) {
      const from = students.find((st) => st.id === m.student_id)!.section_id;
      if (m.action === 'promoted' || m.action === 'repeated') {
        await client.query(`UPDATE students SET section_id = $2 WHERE id = $1`, [m.student_id, m.to_section_id]);
      } else {
        await client.query(`UPDATE students SET status = $2, left_on = $3 WHERE id = $1`, [m.student_id, m.action === 'graduated' ? 'graduated' : 'left', today]);
        await client.query(`UPDATE users SET is_active = false WHERE ref_id = $1 AND role = 'student' AND institution_id = $2`, [m.student_id, s]);
      }
      await client.query(
        `INSERT INTO student_promotions (institution_id, student_id, from_section_id, to_section_id, action, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [s, m.student_id, from, m.to_section_id, m.action, currentUser(req).id]
      );
      counts[m.action]++;
    }
  });
  res.json(counts);
});

/** Batches (universities, academies) don't change class; they move up a level. */
router.post('/year-end/advance-sections', manage, async (req, res) => {
  const b = z.object({ section_ids: z.array(id).min(1).max(500), steps: z.coerce.number().int().min(1).max(4).default(1) }).parse(req.body);
  const s = institutionId(req);
  const { rows } = await db.query<{ id: number; campus_id: number | null; status: string; program_id: number | null; sequence: number | null; target: number | null }>(
    `SELECT sec.id, sec.campus_id, sec.status, l.program_id, l.sequence,
            (SELECT x.id FROM program_levels x WHERE x.program_id = l.program_id AND x.sequence = l.sequence + $3) AS target
       FROM sections sec LEFT JOIN program_levels l ON l.id = sec.program_level_id WHERE sec.id = ANY($1::int[]) AND sec.institution_id = $2`,
    [b.section_ids, s, b.steps]
  );
  if (rows.length !== b.section_ids.length) throw badRequest('Some sections are not in this institution');
  const scope = campusesFor(req, 'year_end.manage');
  for (const r of rows) {
    assertCampusAllowed(scope, r.campus_id);
    if (r.status === 'archived') throw conflict('An archived section cannot move', 'ARCHIVED');
    if (!r.target) throw badRequest(`Section ${r.id} has no level ${b.steps} step(s) higher in its program`);
  }
  await withTransaction(async (client) => {
    for (const r of rows) await client.query(`UPDATE sections SET program_level_id = $2 WHERE id = $1`, [r.id, r.target]);
  });
  res.json({ advanced: rows.length });
});

/** Close a year: it, its terms and its classes become read-only. */
router.post('/academic-years/:id/archive', manage, async (req, res) => {
  const yearId = id.parse(req.params.id);
  const b = z.object({ next_current_year_id: z.coerce.number().int().positive().optional() }).parse(req.body ?? {});
  const y = await year(req, yearId);
  if (y.status === 'archived') throw conflict('This year is already archived');
  if (campusesFor(req, 'year_end.manage') !== null) throw conflict('Only institution-wide administrators can archive a year');
  if (y.is_current && !b.next_current_year_id) throw badRequest('This is the current year — choose the year that becomes current', { next_current_year_id: 'required' });
  const s = institutionId(req);
  const { rows: active } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM students st JOIN sections sec ON sec.id = st.section_id WHERE sec.academic_year_id = $1 AND st.status = 'active'`,
    [yearId]
  );
  if (active[0]!.n > 0) throw conflict(`${active[0]!.n} active students are still in this year's classes — promote them first`, 'IN_USE');
  await withTransaction(async (client) => {
    if (b.next_current_year_id) {
      const next = await year(req, b.next_current_year_id);
      if (next.status === 'archived') throw conflict('The next year is archived');
      await client.query(`UPDATE academic_years SET is_current = false WHERE institution_id = $1`, [s]);
      await client.query(`UPDATE academic_years SET is_current = true, status = 'active' WHERE id = $1`, [next.id]);
    }
    await client.query(`UPDATE academic_years SET status = 'archived', is_current = false WHERE id = $1`, [yearId]);
    await client.query(`UPDATE terms SET status = 'archived' WHERE academic_year_id = $1`, [yearId]);
    await client.query(`UPDATE sections SET status = 'archived' WHERE academic_year_id = $1`, [yearId]);
  });
  res.json({ ok: true });
});

export default router;
