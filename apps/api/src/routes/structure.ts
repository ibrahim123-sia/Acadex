// The academic structure: campuses, departments, programs and levels, academic years and
// terms, the holiday calendar, sections, the course catalog, course offerings with their
// staff, and enrolment (capacity + waitlist). Mounted under /api/institution.
import { Router, type Request } from 'express';
import {
  academicYearBody,
  createSectionBody,
  calendarQuery,
  campusBody,
  courseBody,
  courseListQuery,
  departmentBody,
  enrollBody,
  holidayBody,
  id,
  levelBody,
  offeringBody,
  offeringListQuery,
  offeringStaffBody,
  programBody,
  reorderLevelsBody,
  sectionListQuery,
  termBody,
  updateAcademicYearBody,
  updateCampusBody,
  updateCourseBody,
  updateDepartmentBody,
  updateOfferingBody,
  updateProgramBody,
  updateSectionBody,
  updateTermBody,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertInInstitution, type InstitutionTable } from '../lib/access';
import { badRequest, conflict, notFound } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { softDelete } from '../lib/soft-delete';
import {
  assertCampusAllowed,
  assertOfferingWritable,
  assertSectionWritable,
  calendarSettings,
  campusClause,
  campusesFor,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../lib/structure';
import { auth, currentUser, institutionId, requirePermission } from '../middleware/auth';
import { emitWebhook } from '../lib/webhooks';

const router = Router();
router.use(auth);

const read = requirePermission('structure.read');
const manage = requirePermission('structure.manage');

/** Every referenced id must belong to this institution. */
async function assertRefs(req: Request, refs: [InstitutionTable, number | null | undefined][]) {
  for (const [table, ref] of refs) if (ref) await assertInInstitution(table, ref, institutionId(req));
}

/** Build `SET a = $2, b = $3` from a parsed PATCH body (column names come from the schema, not the client). */
function setClause(body: Record<string, unknown>, params: unknown[], map: Record<string, (v: unknown) => unknown> = {}) {
  return Object.entries(body)
    .map(([k, v]) => {
      params.push(map[k] ? map[k]!(v) : v);
      return `${k} = $${params.length}`;
    })
    .join(', ');
}

async function updateRow(req: Request, table: string, rowId: number, body: Record<string, unknown>, map?: Record<string, (v: unknown) => unknown>) {
  const params: unknown[] = [rowId, institutionId(req)];
  const set = setClause(body, params, map);
  try {
    const { rows } = await db.query(`UPDATE ${table} SET ${set} WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
    if (!rows[0]) throw notFound();
    return rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('That code or name is already in use');
    throw e;
  }
}

async function insertRow(sql: string, params: unknown[], duplicate = 'That code is already in use') {
  try {
    return (await db.query(sql, params)).rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(duplicate);
    throw e;
  }
}

// ---------------------------------------------------------------- overview

/** Everything the setup screens need in one request. */
router.get('/structure', read, async (req, res) => {
  const s = institutionId(req);
  const [campuses, departments, programs, levels, years, terms, schemes] = await Promise.all([
    db.query(
      `SELECT c.id, c.name, c.code, c.address, c.phone, c.is_main,
              (SELECT count(*)::int FROM sections x WHERE x.campus_id = c.id AND x.status = 'active') sections,
              (SELECT count(*)::int FROM students st JOIN sections x ON x.id = st.section_id WHERE x.campus_id = c.id AND st.status = 'active') students
         FROM campuses c WHERE c.institution_id = $1 ORDER BY c.is_main DESC, c.name`,
      [s]
    ),
    db.query(
      `SELECT d.id, d.name, d.code, d.campus_id, d.head_teacher_id, t.first_name || ' ' || t.last_name AS head_name
         FROM departments d LEFT JOIN teachers t ON t.id = d.head_teacher_id WHERE d.institution_id = $1 ORDER BY d.name`,
      [s]
    ),
    db.query(
      `SELECT id, name, code, department_id, description, grading_scheme_id, credits_required FROM programs WHERE institution_id = $1 ORDER BY name`,
      [s]
    ),
    db.query(
      `SELECT l.id, l.program_id, l.name, l.sequence,
              (SELECT count(*)::int FROM sections x WHERE x.program_level_id = l.id AND x.status = 'active') sections
         FROM program_levels l WHERE l.institution_id = $1 ORDER BY l.program_id, l.sequence`,
      [s]
    ),
    db.query(`SELECT id, name, starts_on, ends_on, status, is_current FROM academic_years WHERE institution_id = $1 ORDER BY starts_on DESC`, [s]),
    db.query(`SELECT id, academic_year_id, name, kind, sequence, starts_on, ends_on, status FROM terms WHERE institution_id = $1 ORDER BY starts_on`, [s]),
    db.query(`SELECT id, name, kind, is_default FROM grading_schemes WHERE institution_id = $1 ORDER BY is_default DESC, name`, [s]),
  ]);
  res.json({
    campuses: campuses.rows,
    departments: departments.rows,
    programs: programs.rows.map((p) => ({ ...p, levels: levels.rows.filter((l) => l.program_id === p.id) })),
    academic_years: years.rows.map((y) => ({ ...y, terms: terms.rows.filter((t) => t.academic_year_id === y.id) })),
    grading_schemes: schemes.rows,
  });
});

// ---------------------------------------------------------------- campuses

router.post('/campuses', manage, async (req, res) => {
  const b = campusBody.parse(req.body);
  const row = await insertRow(
    `INSERT INTO campuses (institution_id, name, code, address, phone, is_main)
     VALUES ($1,$2,$3,$4,$5, NOT EXISTS (SELECT 1 FROM campuses WHERE institution_id = $1)) RETURNING *`,
    [institutionId(req), b.name, b.code, b.address, b.phone],
    'A campus with this code already exists'
  );
  res.status(201).json(row);
});

router.patch('/campuses/:id', manage, async (req, res) => {
  res.json(await updateRow(req, 'campuses', id.parse(req.params.id), updateCampusBody.parse(req.body)));
});

/** Make a campus the main one (exactly one per institution). */
router.post('/campuses/:id/main', manage, async (req, res) => {
  const campusId = id.parse(req.params.id);
  await assertRefs(req, [['campuses', campusId]]);
  await db.query(`UPDATE campuses SET is_main = (id = $1) WHERE institution_id = $2`, [campusId, institutionId(req)]);
  res.json({ ok: true });
});

router.delete('/campuses/:id', manage, async (req, res) => {
  const campusId = id.parse(req.params.id);
  const { rows } = await db.query<{ is_main: boolean; sections: number }>(
    `SELECT is_main, (SELECT count(*)::int FROM sections WHERE campus_id = c.id AND status = 'active') sections FROM campuses c WHERE id = $1 AND institution_id = $2`,
    [campusId, institutionId(req)]
  );
  const c = rows[0];
  if (!c) throw notFound();
  if (c.is_main) throw conflict('The main campus cannot be deleted — make another campus the main one first');
  if (c.sections > 0) throw conflict(`This campus still has ${c.sections} active classes — move or archive them first`, 'IN_USE');
  await softDelete('campuses', campusId, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

// ---------------------------------------------------------------- departments

router.get('/departments', read, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, t.first_name || ' ' || t.last_name AS head_name,
            (SELECT count(*)::int FROM teachers x WHERE x.department_id = d.id) staff,
            (SELECT count(*)::int FROM courses x WHERE x.department_id = d.id) courses
       FROM departments d LEFT JOIN teachers t ON t.id = d.head_teacher_id WHERE d.institution_id = $1 ORDER BY d.name`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.post('/departments', manage, async (req, res) => {
  const b = departmentBody.parse(req.body);
  await assertRefs(req, [['campuses', b.campus_id], ['teachers', b.head_teacher_id]]);
  const row = await insertRow(
    `INSERT INTO departments (institution_id, name, code, campus_id, head_teacher_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [institutionId(req), b.name, b.code, b.campus_id, b.head_teacher_id],
    'A department with this code already exists'
  );
  res.status(201).json(row);
});

router.patch('/departments/:id', manage, async (req, res) => {
  const b = updateDepartmentBody.parse(req.body);
  await assertRefs(req, [['campuses', b.campus_id], ['teachers', b.head_teacher_id]]);
  res.json(await updateRow(req, 'departments', id.parse(req.params.id), b));
});

router.delete('/departments/:id', manage, async (req, res) => {
  if (!(await softDelete('departments', id.parse(req.params.id), institutionId(req), currentUser(req).id))) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- programs & levels

router.post('/programs', manage, async (req, res) => {
  const b = programBody.parse(req.body);
  await assertRefs(req, [['departments', b.department_id], ['grading_schemes', b.grading_scheme_id]]);
  if (new Set(b.levels.map((l) => l.toLowerCase())).size !== b.levels.length) throw badRequest('Two levels have the same name');
  const s = institutionId(req);
  const program = await withTransaction(async (client) => {
    let p;
    try {
      p = (
        await client.query(
          `INSERT INTO programs (institution_id, name, code, department_id, description, grading_scheme_id, credits_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [s, b.name, b.code, b.department_id, b.description, b.grading_scheme_id, b.credits_required]
        )
      ).rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A program with this code already exists');
      throw e;
    }
    const levels = b.levels.length
      ? (
          await client.query(
            `INSERT INTO program_levels (institution_id, program_id, name, sequence)
             SELECT $1, $2, name, ord FROM unnest($3::text[]) WITH ORDINALITY AS l(name, ord) RETURNING *`,
            [s, p.id, b.levels]
          )
        ).rows
      : [];
    return { ...p, levels };
  });
  res.status(201).json(program);
});

router.patch('/programs/:id', manage, async (req, res) => {
  const b = updateProgramBody.parse(req.body);
  await assertRefs(req, [['departments', b.department_id], ['grading_schemes', b.grading_scheme_id]]);
  res.json(await updateRow(req, 'programs', id.parse(req.params.id), b));
});

router.delete('/programs/:id', manage, async (req, res) => {
  const programId = id.parse(req.params.id);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM sections s JOIN program_levels l ON l.id = s.program_level_id WHERE l.program_id = $1 AND s.status = 'active'`,
    [programId]
  );
  if ((rows[0]?.n ?? 0) > 0) throw conflict(`This program still has ${rows[0]!.n} active classes`, 'IN_USE');
  if (!(await softDelete('programs', programId, institutionId(req), currentUser(req).id))) throw notFound();
  res.status(204).end();
});

router.post('/programs/:id/levels', manage, async (req, res) => {
  const programId = id.parse(req.params.id);
  await assertRefs(req, [['programs', programId]]);
  const { name } = levelBody.parse(req.body);
  const row = await insertRow(
    `INSERT INTO program_levels (institution_id, program_id, name, sequence)
     VALUES ($1,$2,$3,(SELECT COALESCE(max(sequence),0) + 1 FROM program_levels WHERE program_id = $2)) RETURNING *`,
    [institutionId(req), programId, name]
  );
  res.status(201).json(row);
});

/** Put the levels of a program in this order (promotion follows it). */
router.put('/programs/:id/levels/order', manage, async (req, res) => {
  const programId = id.parse(req.params.id);
  const { level_ids } = reorderLevelsBody.parse(req.body);
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM program_levels WHERE program_id = $1 AND institution_id = $2`, [
    programId,
    institutionId(req),
  ]);
  const current = rows.map((r) => r.id).sort((a, b) => a - b);
  if (JSON.stringify([...level_ids].sort((a, b) => a - b)) !== JSON.stringify(current)) {
    throw badRequest('Send every level of the program exactly once');
  }
  await withTransaction(async (client) => {
    // two steps so the unique (program, sequence) constraint never sees duplicates
    await client.query(`UPDATE program_levels SET sequence = -sequence WHERE program_id = $1`, [programId]);
    await client.query(
      `UPDATE program_levels l SET sequence = o.ord FROM unnest($1::int[]) WITH ORDINALITY AS o(id, ord) WHERE l.id = o.id`,
      [level_ids]
    );
  });
  res.json({ ok: true });
});

router.patch('/levels/:id', manage, async (req, res) => {
  res.json(await updateRow(req, 'program_levels', id.parse(req.params.id), levelBody.parse(req.body)));
});

router.delete('/levels/:id', manage, async (req, res) => {
  const levelId = id.parse(req.params.id);
  try {
    const { rowCount } = await db.query(
      `DELETE FROM program_levels WHERE id = $1 AND institution_id = $2 AND NOT EXISTS (SELECT 1 FROM sections WHERE program_level_id = $1)`,
      [levelId, institutionId(req)]
    );
    if (!rowCount) throw conflict('This level has classes — move them to another level first', 'IN_USE');
  } catch (e) {
    if (isForeignKeyViolation(e)) throw conflict('This level is in use', 'IN_USE');
    throw e;
  }
  res.status(204).end();
});

// ---------------------------------------------------------------- academic years & terms

router.post('/academic-years', manage, async (req, res) => {
  const b = academicYearBody.parse(req.body);
  const s = institutionId(req);
  const year = await withTransaction(async (client) => {
    if (b.is_current) await client.query(`UPDATE academic_years SET is_current = false WHERE institution_id = $1`, [s]);
    let y;
    try {
      y = (
        await client.query(
          `INSERT INTO academic_years (institution_id, name, starts_on, ends_on, is_current, status)
           VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 THEN 'active' ELSE 'planned' END) RETURNING *`,
          [s, b.name, b.starts_on, b.ends_on, b.is_current]
        )
      ).rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('An academic year with this name already exists');
      throw e;
    }
    const terms: Record<string, unknown>[] = [];
    for (const [i, t] of b.terms.entries()) {
      terms.push(
        (
          await client.query(
            `INSERT INTO terms (institution_id, academic_year_id, name, kind, sequence, starts_on, ends_on, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [s, y.id, t.name, t.kind, i + 1, t.starts_on, t.ends_on, y.status]
          )
        ).rows[0]
      );
    }
    return { ...y, terms };
  });
  res.status(201).json(year);
});

router.patch('/academic-years/:id', manage, async (req, res) => {
  const yearId = id.parse(req.params.id);
  const b = updateAcademicYearBody.parse(req.body);
  const s = institutionId(req);
  const row = await withTransaction(async () => {
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM academic_years WHERE id = $1 AND institution_id = $2`, [yearId, s]);
    if (!rows[0]) throw notFound();
    if (rows[0].status === 'archived') throw conflict('This academic year is archived and read-only', 'ARCHIVED');
    if (b.is_current) await db.query(`UPDATE academic_years SET is_current = false WHERE institution_id = $1 AND id <> $2`, [s, yearId]);
    const updated = await updateRow(req, 'academic_years', yearId, b.is_current ? { ...b, status: 'active' } : b);
    if (updated.ends_on <= updated.starts_on) throw badRequest('The year must end after it starts');
    return updated;
  });
  res.json(row);
});

router.post('/academic-years/:id/terms', manage, async (req, res) => {
  const yearId = id.parse(req.params.id);
  const t = termBody.parse(req.body);
  const s = institutionId(req);
  const { rows } = await db.query<{ starts_on: string; ends_on: string; status: string }>(
    `SELECT starts_on, ends_on, status FROM academic_years WHERE id = $1 AND institution_id = $2`,
    [yearId, s]
  );
  const y = rows[0];
  if (!y) throw notFound('Academic year not found');
  if (y.status === 'archived') throw conflict('This academic year is archived and read-only', 'ARCHIVED');
  if (t.starts_on < y.starts_on || t.starts_on > y.ends_on || (t.ends_on && t.ends_on > y.ends_on)) throw badRequest('The term must fall inside its academic year');
  const row = await insertRow(
    `INSERT INTO terms (institution_id, academic_year_id, name, kind, sequence, starts_on, ends_on, status)
     VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(sequence),0) + 1 FROM terms WHERE academic_year_id = $2),$5,$6,$7) RETURNING *`,
    [s, yearId, t.name, t.kind, t.starts_on, t.ends_on, y.status === 'active' ? 'active' : 'planned'],
    'This year already has a term with that name'
  );
  res.status(201).json(row);
});

router.patch('/terms/:id', manage, async (req, res) => {
  const termId = id.parse(req.params.id);
  const b = updateTermBody.parse(req.body);
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM terms WHERE id = $1 AND institution_id = $2`, [termId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if (rows[0].status === 'archived') throw conflict('This term is archived and read-only', 'ARCHIVED');
  const row = await updateRow(req, 'terms', termId, b);
  if (row.ends_on && row.ends_on < row.starts_on) throw badRequest('A term cannot end before it starts');
  res.json(row);
});

router.delete('/terms/:id', manage, async (req, res) => {
  const termId = id.parse(req.params.id);
  const { rowCount } = await db.query(
    `DELETE FROM terms WHERE id = $1 AND institution_id = $2 AND status <> 'archived'
        AND NOT EXISTS (SELECT 1 FROM course_offerings WHERE term_id = $1)`,
    [termId, institutionId(req)]
  );
  if (!rowCount) throw conflict('This term has courses (or is archived) and cannot be deleted', 'IN_USE');
  res.status(204).end();
});

// ---------------------------------------------------------------- calendar

router.get('/calendar', read, async (req, res) => {
  const q = calendarQuery.parse(req.query);
  const s = institutionId(req);
  const [holidays, terms] = await Promise.all([
    db.query(
      `SELECT h.id, h.name, h.kind, h.starts_on, h.ends_on, h.campus_id, c.name AS campus_name
         FROM holidays h LEFT JOIN campuses c ON c.id = h.campus_id
        WHERE h.institution_id = $1 AND h.ends_on >= $2 AND h.starts_on <= $3 AND ($4::int IS NULL OR h.campus_id IS NULL OR h.campus_id = $4)
        ORDER BY h.starts_on`,
      [s, q.from, q.to, q.campus_id]
    ),
    db.query(
      `SELECT t.id, t.name, t.starts_on, t.ends_on, t.status, ay.name AS academic_year
         FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
        WHERE t.institution_id = $1 AND t.starts_on <= $3 AND (t.ends_on IS NULL OR t.ends_on >= $2) ORDER BY t.starts_on`,
      [s, q.from, q.to]
    ),
  ]);
  res.json({ holidays: holidays.rows, terms: terms.rows, working_days: (await calendarSettings(s)).workingDays });
});

router.post('/holidays', manage, async (req, res) => {
  const b = holidayBody.parse(req.body);
  await assertRefs(req, [['campuses', b.campus_id]]);
  const { rows } = await db.query(
    `INSERT INTO holidays (institution_id, campus_id, name, starts_on, ends_on, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [institutionId(req), b.campus_id, b.name, b.starts_on, b.ends_on, b.kind]
  );
  res.status(201).json(rows[0]);
});

router.patch('/holidays/:id', manage, async (req, res) => {
  const b = holidayBody.parse(req.body);
  await assertRefs(req, [['campuses', b.campus_id]]);
  res.json(await updateRow(req, 'holidays', id.parse(req.params.id), b));
});

router.delete('/holidays/:id', manage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM holidays WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- sections

router.get('/sections', requirePermission('sections.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 }); // also feeds section dropdowns
  const f = sectionListQuery.parse(req.query);
  const params: unknown[] = [institutionId(req)];
  let where = 'c.institution_id = $1';
  if (f.status !== 'all') where += ` AND c.status = '${f.status === 'archived' ? 'archived' : 'active'}'`;
  for (const [col, v] of [['c.campus_id', f.campus_id], ['c.academic_year_id', f.academic_year_id], ['c.program_level_id', f.program_level_id]] as const) {
    if (v) {
      params.push(v);
      where += ` AND ${col} = $${params.length}`;
    }
  }
  if (f.search) {
    params.push(`%${f.search.toLowerCase()}%`);
    where += ` AND (lower(c.name) LIKE $${params.length} OR lower(c.code) LIKE $${params.length})`;
  }
  where += campusClause(campusesFor(req, 'sections.read'), 'c.campus_id', params);
  params.push(pg.limit, pg.offset);
  const { rows } = await db.query(
    `SELECT c.id, c.code, c.name, c.label, c.status, c.capacity, c.campus_id, cm.name AS campus_name,
            c.program_level_id, l.name AS level_name, p.name AS program_name, c.academic_year_id, ay.name AS academic_year,
            c.homeroom_teacher_id, t.first_name || ' ' || t.last_name AS homeroom_teacher,
            (SELECT count(*) FROM students s WHERE s.section_id = c.id AND s.status = 'active')::int students,
            (SELECT count(*) FROM course_offerings o WHERE o.section_id = c.id)::int subjects,
            count(*) OVER() _total
       FROM sections c
       LEFT JOIN campuses cm ON cm.id = c.campus_id
       LEFT JOIN program_levels l ON l.id = c.program_level_id
       LEFT JOIN programs p ON p.id = l.program_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id
      WHERE ${where}
      ORDER BY p.name NULLS LAST, l.sequence NULLS LAST, c.name, c.label, c.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  sendPage(res, rows, pg);
});

// Create a section (a class, batch or cohort)
router.post('/sections', requirePermission('sections.manage'), async (req, res) => {
  const s = institutionId(req);
  const b = createSectionBody.parse(req.body);
  const scope = campusesFor(req, 'sections.manage');
  if (scope !== null && !b.campus_id) throw badRequest('Choose the campus for this class', { campus_id: 'required' });
  assertCampusAllowed(scope, scope === null ? null : b.campus_id);
  for (const [table, ref] of [
    ['campuses', b.campus_id],
    ['academic_years', b.academic_year_id],
    ['program_levels', b.program_level_id],
    ['teachers', b.homeroom_teacher_id],
  ] as const) {
    if (ref) await assertInInstitution(table, ref, s);
  }
  if (b.academic_year_id) {
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM academic_years WHERE id = $1`, [b.academic_year_id]);
    if (rows[0]?.status === 'archived') throw conflict('That academic year is archived', 'ARCHIVED');
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO sections (institution_id, code, name, label, capacity, homeroom_teacher_id, program_level_id, campus_id, academic_year_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               COALESCE($8, (SELECT id FROM campuses WHERE institution_id=$1 AND is_main LIMIT 1)),
               COALESCE($9, (SELECT id FROM academic_years WHERE institution_id=$1 AND is_current LIMIT 1)))
       RETURNING *`,
      [s, b.code, b.name, b.label, b.capacity, b.homeroom_teacher_id, b.program_level_id, b.campus_id, b.academic_year_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A section with this code already exists');
    throw e;
  }
});

router.get('/sections/:id', requirePermission('sections.read'), async (req, res) => {
  const sectionId = id.parse(req.params.id);
  const s = institutionId(req);
  const { rows } = await db.query(
    `SELECT c.*, cm.name AS campus_name, l.name AS level_name, p.name AS program_name, ay.name AS academic_year, ay.status AS year_status,
            t.first_name || ' ' || t.last_name AS homeroom_teacher
       FROM sections c LEFT JOIN campuses cm ON cm.id = c.campus_id LEFT JOIN program_levels l ON l.id = c.program_level_id
       LEFT JOIN programs p ON p.id = l.program_id LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id
      WHERE c.id = $1 AND c.institution_id = $2`,
    [sectionId, s]
  );
  const section = rows[0];
  if (!section) throw notFound('Section not found');
  assertCampusAllowed(campusesFor(req, 'sections.read'), section.campus_id);
  const [students, offerings] = await Promise.all([
    db.query(
      `SELECT id, roll_no, first_name, last_name, gender, status FROM students WHERE section_id = $1 AND institution_id = $2 ORDER BY roll_no NULLS LAST, first_name`,
      [sectionId, s]
    ),
    db.query(
      `SELECT o.id, o.course_id, co.code, co.name, co.credit_hours, o.term_id, tm.name AS term_name, o.enrollment_mode, o.capacity,
              COALESCE((SELECT json_agg(json_build_object('teacher_id', ss.teacher_id, 'role', ss.role, 'name', t.first_name || ' ' || t.last_name) ORDER BY ss.role, t.first_name)
                          FROM section_staff ss JOIN teachers t ON t.id = ss.teacher_id WHERE ss.offering_id = o.id), '[]') AS staff
         FROM course_offerings o JOIN courses co ON co.id = o.course_id LEFT JOIN terms tm ON tm.id = o.term_id
        WHERE o.section_id = $1 AND o.institution_id = $2 ORDER BY co.name`,
      [sectionId, s]
    ),
  ]);
  res.json({ ...section, students: students.rows, offerings: offerings.rows });
});

router.patch('/sections/:id', requirePermission('sections.manage'), async (req, res) => {
  const sectionId = id.parse(req.params.id);
  const b = updateSectionBody.parse(req.body);
  const scope = campusesFor(req, 'sections.manage');
  const { rows } = await db.query<{ campus_id: number | null }>(`SELECT campus_id FROM sections WHERE id = $1 AND institution_id = $2`, [sectionId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  assertCampusAllowed(scope, rows[0].campus_id);
  if (b.campus_id !== undefined) assertCampusAllowed(scope, b.campus_id);
  await assertSectionWritable(sectionId);
  await assertRefs(req, [['campuses', b.campus_id], ['academic_years', b.academic_year_id], ['program_levels', b.program_level_id], ['teachers', b.homeroom_teacher_id]]);
  res.json(await updateRow(req, 'sections', sectionId, b));
});

router.delete('/sections/:id', requirePermission('sections.manage'), async (req, res) => {
  const sectionId = id.parse(req.params.id);
  const { rows } = await db.query<{ campus_id: number | null; students: number }>(
    `SELECT campus_id, (SELECT count(*)::int FROM students WHERE section_id = c.id AND status = 'active') students FROM sections c WHERE id = $1 AND institution_id = $2`,
    [sectionId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  assertCampusAllowed(campusesFor(req, 'sections.manage'), rows[0].campus_id);
  if (rows[0].students > 0) throw conflict(`This class still has ${rows[0].students} students — move them first`, 'IN_USE');
  await softDelete('sections', sectionId, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

// ---------------------------------------------------------------- courses

router.get('/courses', read, async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const f = courseListQuery.parse(req.query);
  const { rows } = await db.query(
    `SELECT co.id, co.code, co.name, co.description, co.credit_hours, co.department_id, d.name AS department_name,
            (SELECT count(*)::int FROM course_offerings o WHERE o.course_id = co.id) offerings, count(*) OVER() _total
       FROM courses co LEFT JOIN departments d ON d.id = co.department_id
      WHERE co.institution_id = $1 AND ($2 = '' OR lower(co.name) LIKE $2 OR lower(co.code) LIKE $2) AND ($3::int IS NULL OR co.department_id = $3)
      ORDER BY co.code LIMIT $4 OFFSET $5`,
    [institutionId(req), f.search ? `%${f.search.toLowerCase()}%` : '', f.department_id, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.post('/courses', manage, async (req, res) => {
  const b = courseBody.parse(req.body);
  await assertRefs(req, [['departments', b.department_id]]);
  const row = await insertRow(
    `INSERT INTO courses (institution_id, code, name, description, department_id, credit_hours) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [institutionId(req), b.code, b.name, b.description, b.department_id, b.credit_hours],
    'A course with this code already exists'
  );
  res.status(201).json(row);
});

router.patch('/courses/:id', manage, async (req, res) => {
  const b = updateCourseBody.parse(req.body);
  await assertRefs(req, [['departments', b.department_id]]);
  res.json(await updateRow(req, 'courses', id.parse(req.params.id), b));
});

router.delete('/courses/:id', manage, async (req, res) => {
  if (!(await softDelete('courses', id.parse(req.params.id), institutionId(req), currentUser(req).id))) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- offerings

const OFFERING_SELECT = `
  SELECT o.id, o.course_id, co.code, co.name, co.credit_hours, o.term_id, tm.name AS term_name, o.section_id, sec.name AS section_name,
         sec.label AS section_label, sec.campus_id, o.enrollment_mode, o.capacity, o.waitlist_enabled,
         (SELECT count(*)::int FROM enrollments e WHERE e.offering_id = o.id AND e.status = 'active') AS enrolled,
         (SELECT count(*)::int FROM enrollments e WHERE e.offering_id = o.id AND e.status = 'waitlisted') AS waitlisted,
         COALESCE((SELECT json_agg(json_build_object('teacher_id', ss.teacher_id, 'role', ss.role, 'name', t.first_name || ' ' || t.last_name) ORDER BY ss.role)
                     FROM section_staff ss JOIN teachers t ON t.id = ss.teacher_id WHERE ss.offering_id = o.id), '[]') AS staff
    FROM course_offerings o JOIN courses co ON co.id = o.course_id
    LEFT JOIN terms tm ON tm.id = o.term_id LEFT JOIN sections sec ON sec.id = o.section_id`;

router.get('/offerings', read, async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const f = offeringListQuery.parse(req.query);
  const params: unknown[] = [institutionId(req), f.term_id, f.section_id, f.course_id, f.campus_id];
  let where = `o.institution_id = $1 AND ($2::int IS NULL OR o.term_id = $2) AND ($3::int IS NULL OR o.section_id = $3)
               AND ($4::int IS NULL OR o.course_id = $4) AND ($5::int IS NULL OR sec.campus_id = $5)`;
  where += campusClause(campusesFor(req, 'structure.read'), 'sec.campus_id', params);
  params.push(pg.limit, pg.offset);
  const { rows } = await db.query(
    `${OFFERING_SELECT.replace('SELECT o.id', 'SELECT count(*) OVER() _total, o.id')} WHERE ${where} ORDER BY tm.starts_on DESC NULLS LAST, co.code, sec.name
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  sendPage(res, rows, pg);
});

async function loadOffering(req: Request, offeringId: number) {
  const { rows } = await db.query(`${OFFERING_SELECT} WHERE o.id = $1 AND o.institution_id = $2`, [offeringId, institutionId(req)]);
  if (!rows[0]) throw notFound('Course offering not found');
  return rows[0];
}

router.post('/offerings', manage, async (req, res) => {
  const b = offeringBody.parse(req.body);
  await assertRefs(req, [['courses', b.course_id], ['terms', b.term_id], ['sections', b.section_id]]);
  if (b.enrollment_mode === 'section' && !b.section_id) throw badRequest('A course for a whole class needs the class', { section_id: 'required' });
  if (b.section_id) await assertSectionWritable(b.section_id);
  const { rows } = await db.query(
    `INSERT INTO course_offerings (institution_id, course_id, term_id, section_id, enrollment_mode, capacity, waitlist_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [institutionId(req), b.course_id, b.term_id, b.section_id, b.enrollment_mode, b.capacity, b.waitlist_enabled]
  );
  res.status(201).json(await loadOffering(req, rows[0].id));
});

router.get('/offerings/:id', read, async (req, res) => {
  res.json(await loadOffering(req, id.parse(req.params.id)));
});

router.patch('/offerings/:id', manage, async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const b = updateOfferingBody.parse(req.body);
  await assertRefs(req, [['terms', b.term_id], ['sections', b.section_id]]);
  await assertOfferingWritable(offeringId);
  await updateRow(req, 'course_offerings', offeringId, b);
  const o = await loadOffering(req, offeringId);
  if (o.enrollment_mode === 'section' && !o.section_id) throw badRequest('A course for a whole class needs the class');
  if (b.capacity !== undefined) await fillFromWaitlist(offeringId);
  res.json(await loadOffering(req, offeringId));
});

router.delete('/offerings/:id', manage, async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertOfferingWritable(offeringId);
  const { rows } = await db.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM assessments WHERE offering_id = $1) + (SELECT count(*) FROM modules WHERE offering_id = $1) AS n`,
    [offeringId]
  );
  if (Number(rows[0]?.n ?? 0) > 0) throw conflict('This course has grades or assignments and cannot be deleted', 'IN_USE');
  const { rowCount } = await db.query(`DELETE FROM course_offerings WHERE id = $1 AND institution_id = $2`, [offeringId, institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

router.post('/offerings/:id/staff', manage, async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const b = offeringStaffBody.parse(req.body);
  const o = await loadOffering(req, offeringId);
  await assertRefs(req, [['teachers', b.teacher_id]]);
  await assertOfferingWritable(offeringId);
  await db.query(
    `INSERT INTO section_staff (institution_id, teacher_id, offering_id, section_id, role) VALUES ($1,$2,$3,$4,$5)`,
    [institutionId(req), b.teacher_id, offeringId, o.section_id, b.role]
  );
  res.status(201).json(await loadOffering(req, offeringId));
});

router.delete('/offerings/:id/staff/:teacherId', manage, async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertOfferingWritable(offeringId);
  const { rowCount } = await db.query(`DELETE FROM section_staff WHERE offering_id = $1 AND teacher_id = $2 AND institution_id = $3`, [
    offeringId,
    id.parse(req.params.teacherId),
    institutionId(req),
  ]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- enrolment & waitlist

/** Move waitlisted students into free seats, in queue order. */
async function fillFromWaitlist(offeringId: number) {
  await db.query(
    `WITH o AS (SELECT capacity FROM course_offerings WHERE id = $1),
          free AS (SELECT CASE WHEN (SELECT capacity FROM o) IS NULL THEN 1000000
                               ELSE (SELECT capacity FROM o) - (SELECT count(*) FROM enrollments WHERE offering_id = $1 AND status = 'active') END AS n),
          moved AS (SELECT id FROM enrollments WHERE offering_id = $1 AND status = 'waitlisted'
                     ORDER BY waitlist_position NULLS LAST, created_at LIMIT GREATEST((SELECT n FROM free), 0))
     UPDATE enrollments SET status = 'active', waitlist_position = NULL, updated_at = now() WHERE id IN (SELECT id FROM moved)`,
    [offeringId]
  );
  // renumber the remaining queue 1, 2, 3, …
  await db.query(
    `UPDATE enrollments e SET waitlist_position = q.pos
       FROM (SELECT id, row_number() OVER (ORDER BY waitlist_position NULLS LAST, created_at) AS pos
               FROM enrollments WHERE offering_id = $1 AND status = 'waitlisted') q
      WHERE e.id = q.id`,
    [offeringId]
  );
}

router.get('/offerings/:id/enrollments', read, async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const o = await loadOffering(req, offeringId);
  const { rows } = await db.query(
    o.enrollment_mode === 'section'
      ? `SELECT st.id AS student_id, st.roll_no, st.first_name, st.last_name, 'active' AS status, NULL::int AS waitlist_position
           FROM students st WHERE st.section_id = $1 AND st.institution_id = $2 AND st.status = 'active' ORDER BY st.roll_no NULLS LAST, st.first_name`
      : `SELECT e.student_id, st.roll_no, st.first_name, st.last_name, e.status, e.waitlist_position
           FROM enrollments e JOIN students st ON st.id = e.student_id
          WHERE e.offering_id = $1 AND e.institution_id = $2 AND e.status IN ('active', 'waitlisted')
          ORDER BY e.status, e.waitlist_position NULLS FIRST, st.first_name`,
    [o.enrollment_mode === 'section' ? o.section_id : offeringId, institutionId(req)]
  );
  res.json({ offering: o, students: rows });
});

/** Enrol students: seats first, then the waitlist (if enabled), otherwise refused. */
router.post('/offerings/:id/enrollments', requirePermission('enrollments.manage'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const { student_ids } = enrollBody.parse(req.body);
  const o = await loadOffering(req, offeringId);
  if (o.enrollment_mode !== 'open') throw badRequest('Everyone in the class takes this course; enrol students into the class instead');
  await assertOfferingWritable(offeringId);
  const s = institutionId(req);
  const unique = [...new Set(student_ids)];
  const { rows: found } = await db.query<{ id: number }>(
    `SELECT id FROM students WHERE id = ANY($1::int[]) AND institution_id = $2 AND status = 'active'`,
    [unique, s]
  );
  const missing = unique.filter((x) => !found.some((f) => f.id === x));
  if (missing.length) throw badRequest('Some students are not active students of this institution', { student_ids: missing });

  const result = await withTransaction(async (client) => {
    // lock the offering so two enrolments can't both take the last seat
    await client.query(`SELECT id FROM course_offerings WHERE id = $1 FOR UPDATE`, [offeringId]);
    const out = { enrolled: [] as number[], waitlisted: [] as number[], already: [] as number[], full: [] as number[] };
    for (const sid of unique) {
      const { rows: ex } = await client.query<{ status: string }>(`SELECT status FROM enrollments WHERE offering_id = $1 AND student_id = $2`, [offeringId, sid]);
      if (ex[0] && ['active', 'waitlisted'].includes(ex[0].status)) {
        out.already.push(sid);
        continue;
      }
      const { rows: c } = await client.query<{ n: number }>(`SELECT count(*)::int n FROM enrollments WHERE offering_id = $1 AND status = 'active'`, [offeringId]);
      const hasSeat = o.capacity == null || c[0]!.n < o.capacity;
      if (!hasSeat && !o.waitlist_enabled) {
        out.full.push(sid);
        continue;
      }
      const status = hasSeat ? 'active' : 'waitlisted';
      await client.query(
        `INSERT INTO enrollments (institution_id, offering_id, student_id, status, waitlist_position)
         VALUES ($1,$2,$3,$4, CASE WHEN $4 = 'waitlisted' THEN (SELECT COALESCE(max(waitlist_position),0) + 1 FROM enrollments WHERE offering_id = $2 AND status = 'waitlisted') END)
         ON CONFLICT ON CONSTRAINT enrollments_offering_id_student_id_key
         DO UPDATE SET status = EXCLUDED.status, waitlist_position = EXCLUDED.waitlist_position, updated_at = now()`,
        [s, offeringId, sid, status]
      );
      (hasSeat ? out.enrolled : out.waitlisted).push(sid);
    }
    if (out.enrolled.length) await emitWebhook(s, 'student.enrolled', { offering_id: offeringId, student_ids: out.enrolled });
    return out;
  });
  res.status(201).json(result);
});

/** Drop a student; the first waitlisted student takes the seat. */
router.delete('/offerings/:id/enrollments/:studentId', requirePermission('enrollments.manage'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertOfferingWritable(offeringId);
  const { rowCount } = await db.query(
    `UPDATE enrollments SET status = 'dropped', waitlist_position = NULL, updated_at = now()
      WHERE offering_id = $1 AND student_id = $2 AND institution_id = $3 AND status IN ('active', 'waitlisted')`,
    [offeringId, id.parse(req.params.studentId), institutionId(req)]
  );
  if (!rowCount) throw notFound('This student is not enrolled');
  await fillFromWaitlist(offeringId);
  res.status(204).end();
});

export default router;
