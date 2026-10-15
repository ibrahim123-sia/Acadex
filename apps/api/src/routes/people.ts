// People: student admissions and profiles, staff, guardians (with per-guardian permissions),
// medical notes (restricted), photos and documents. Mounted under /api/institution.
// Campus-limited roles only see and change people of their campuses.
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  createStudentBody,
  createTeacherBody,
  documentMeta,
  guardianBody,
  id,
  linkGuardianBody,
  medicalBody,
  staffListQuery,
  studentListQuery,
  updateGuardianBody,
  updateGuardianshipBody,
  updateStaffBody,
  updateStudentBody,
  type Permission,
} from '@acadex/shared';
import { inviteUser } from '../auth/invites';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { checkCustomData } from '../lib/custom-fields';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { softDelete } from '../lib/soft-delete';
import { assertCampusAllowed, assertSectionWritable, campusClause, campusOfSection, campusesFor, isUniqueViolation } from '../lib/structure';
import { auth, currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';
import { grantSystemRole } from '../rbac';
import { storeUpload, type FilePurpose } from '../storage/files';

const router = Router();
router.use(auth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });
/** Parse one multipart file field; multer's own errors become proper HTTP errors. */
const oneFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'The file is too large (maximum 10 MB)', undefined, 'FILE_TOO_LARGE'));
    next(err instanceof multer.MulterError ? badRequest(err.message) : err);
  });
function requireFile(req: Request) {
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  return req.file;
}

/** An account with no password yet: the person sets one through the invitation. */
async function createAccount(institution: number, role: string, email: string, fullName: string, refId: number | null) {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (institution_id, role, email, password_hash, full_name, ref_id) VALUES ($1,$2,$3,NULL,$4,$5) RETURNING id`,
    [institution, role, email, fullName, refId]
  );
  return rows[0]!.id;
}

const splitName = (full: string) => {
  const [first = '', ...rest] = full.trim().split(/\s+/);
  return { first, last: rest.join(' ') };
};

// ---------------------------------------------------------------- students

/** A student of this institution the caller may act on with `permission` (campus scope). */
async function studentFor(req: Request, studentId: number, permission: Permission) {
  const { rows } = await db.query(
    `SELECT st.*, sec.campus_id FROM students st LEFT JOIN sections sec ON sec.id = st.section_id WHERE st.id = $1 AND st.institution_id = $2`,
    [studentId, institutionId(req)]
  );
  const st = rows[0];
  if (!st) throw notFound('Student not found');
  assertCampusAllowed(campusesFor(req, permission), st.campus_id);
  return st;
}

router.get('/students', requirePermission('students.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const f = studentListQuery.parse(req.query);
  const params: unknown[] = [institutionId(req)];
  let where = 'st.institution_id = $1';
  if (f.status !== 'all') {
    params.push(f.status);
    where += ` AND st.status = $${params.length}`;
  }
  if (f.search) {
    params.push(`%${f.search.toLowerCase()}%`);
    where += ` AND (lower(st.first_name || ' ' || st.last_name) LIKE $${params.length} OR lower(st.roll_no) LIKE $${params.length} OR lower(st.email) LIKE $${params.length})`;
  }
  if (f.section_id) {
    params.push(f.section_id);
    where += ` AND st.section_id = $${params.length}`;
  }
  if (f.campus_id) {
    params.push(f.campus_id);
    where += ` AND c.campus_id = $${params.length}`;
  }
  where += campusClause(campusesFor(req, 'students.read'), 'c.campus_id', params);
  params.push(pg.limit, pg.offset);
  const { rows } = await db.query(
    `SELECT st.id, st.roll_no, st.first_name, st.last_name, st.email, st.gender, st.age, st.status, st.section_id,
            c.name section_name, c.label section_label, c.campus_id, cm.name campus_name, (st.photo_file_id IS NOT NULL) has_photo,
            COALESCE((SELECT payment_status FROM tuition_fee f WHERE f.student_id = st.id AND f.institution_id = st.institution_id
                      ORDER BY id DESC LIMIT 1), '—') fee_status,
            u.id user_id, (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending,
            count(*) OVER() _total
       FROM students st LEFT JOIN sections c ON c.id = st.section_id LEFT JOIN campuses cm ON cm.id = c.campus_id
       LEFT JOIN users u ON u.ref_id = st.id AND u.role = 'student' AND u.institution_id = st.institution_id
      WHERE ${where}
      ORDER BY st.created_at DESC, st.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  sendPage(res, rows, pg);
});

// Admit a new student: the record, guardians, an account and an emailed invitation
router.post('/students', requirePermission('students.manage'), async (req, res) => {
  const s = institutionId(req);
  const b = createStudentBody.parse(req.body);
  const scope = campusesFor(req, 'students.manage');
  if (b.section_id) {
    await assertInInstitution('sections', b.section_id, s);
    await assertSectionWritable(b.section_id);
    assertCampusAllowed(scope, await campusOfSection(b.section_id));
  } else if (scope !== null) {
    throw badRequest('Choose the class for this student', { section_id: 'required' });
  }
  const custom = await checkCustomData(s, 'student', b.custom_data);
  try {
    const st = await withTransaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO students (institution_id, roll_no, first_name, last_name, age, gender, email, dob, section_id, city, phone, address, national_id, admission_date, custom_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14, CURRENT_DATE),$15) RETURNING *`,
          [s, b.roll_no, b.first_name, b.last_name, b.age, b.gender, b.email, b.dob, b.section_id, b.city, b.phone, b.address, b.national_id, b.admission_date, custom]
        )
      ).rows[0];
      const guardians = [...b.guardians];
      if (b.guardian_name) {
        const n = splitName(b.guardian_name);
        guardians.unshift({ first_name: n.first, last_name: n.last, phone: b.guardian_phone, email: '', relationship: 'guardian' });
      }
      for (const [i, g] of guardians.entries()) {
        const gid = (
          await client.query<{ id: number }>(
            `INSERT INTO guardians (institution_id, first_name, last_name, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [s, g.first_name, g.last_name, g.phone, g.email]
          )
        ).rows[0]!.id;
        await client.query(
          `INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship, is_primary, is_emergency_contact) VALUES ($1,$2,$3,$4,$5,$5)`,
          [s, gid, row.id, g.relationship, i === 0]
        );
      }
      const userId = await createAccount(s, 'student', b.email, `${b.first_name} ${b.last_name}`, row.id);
      await grantSystemRole(client, userId, 'student', s, currentUser(req).id);
      return { row, userId };
    });
    const invite = await inviteUser(st.userId, { id: currentUser(req).id, name: currentUser(req).name });
    res.status(201).json({ ...st.row, user_id: st.userId, invite });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A student or user with this email already exists');
    throw e;
  }
});

router.get('/students/:id', requirePermission('students.read'), async (req, res) => {
  const studentId = id.parse(req.params.id);
  const st = await studentFor(req, studentId, 'students.read');
  const s = institutionId(req);
  const canMedical = userCan(req, 'students.medical.read');
  const [section, guardians, enrollments, documents, promotions, account, medical, cards, issued] = await Promise.all([
    st.section_id
      ? db.query(
          `SELECT c.id, c.name, c.label, c.code, cm.name campus_name, l.name level_name, p.name program_name, ay.name academic_year
             FROM sections c LEFT JOIN campuses cm ON cm.id = c.campus_id LEFT JOIN program_levels l ON l.id = c.program_level_id
             LEFT JOIN programs p ON p.id = l.program_id LEFT JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = $1`,
          [st.section_id]
        )
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT gs.id AS guardianship_id, g.id, g.first_name, g.last_name, g.phone, g.email, g.occupation, gs.relationship, gs.is_primary,
              gs.can_view_grades, gs.can_view_fees, gs.can_message, gs.is_emergency_contact, (g.user_id IS NOT NULL) has_account,
              (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending
         FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id LEFT JOIN users u ON u.id = g.user_id
        WHERE gs.student_id = $1 AND gs.institution_id = $2 ORDER BY gs.is_primary DESC, g.first_name`,
      [studentId, s]
    ),
    db.query(
      `SELECT e.id, e.status, e.waitlist_position, o.id offering_id, co.code, co.name, co.credit_hours, t.name term_name
         FROM enrollments e JOIN course_offerings o ON o.id = e.offering_id JOIN courses co ON co.id = o.course_id LEFT JOIN terms t ON t.id = o.term_id
        WHERE e.student_id = $1 AND e.institution_id = $2 AND e.status <> 'dropped' ORDER BY t.starts_on DESC NULLS LAST, co.code`,
      [studentId, s]
    ),
    db.query(
      `SELECT d.id, d.title, d.category, d.created_at, f.id file_id, f.original_name, f.content_type, f.size_bytes
         FROM person_documents d JOIN files f ON f.id = d.file_id WHERE d.owner_type = 'student' AND d.owner_id = $1 AND d.institution_id = $2 ORDER BY d.created_at DESC`,
      [studentId, s]
    ),
    db.query(
      `SELECT p.action, p.created_at, fs.name from_name, fs.label from_label, fy.name from_year, ts.name to_name, ts.label to_label, ty.name to_year
         FROM student_promotions p LEFT JOIN sections fs ON fs.id = p.from_section_id LEFT JOIN academic_years fy ON fy.id = fs.academic_year_id
         LEFT JOIN sections ts ON ts.id = p.to_section_id LEFT JOIN academic_years ty ON ty.id = ts.academic_year_id
        WHERE p.student_id = $1 ORDER BY p.created_at DESC`,
      [studentId]
    ),
    db.query(`SELECT id, is_active, (password_hash IS NULL) invite_pending, last_login_at FROM users WHERE ref_id = $1 AND role = 'student' AND institution_id = $2`, [studentId, s]),
    canMedical ? db.query(`SELECT * FROM student_medical WHERE student_id = $1`, [studentId]) : Promise.resolve({ rows: [] }),
    db.query(`SELECT id, verify_code, valid_until, issued_at, revoked_at FROM id_cards WHERE holder_type = 'student' AND holder_id = $1 ORDER BY issued_at DESC`, [studentId]),
    db.query(`SELECT id, kind, serial_no, title, issued_at, revoked_at FROM issued_documents WHERE student_id = $1 ORDER BY issued_at DESC`, [studentId]),
  ]);
  res.json({
    ...st,
    section: section.rows[0] ?? null,
    guardians: guardians.rows,
    enrollments: enrollments.rows,
    documents: documents.rows,
    promotions: promotions.rows,
    account: account.rows[0] ?? null,
    medical: canMedical ? (medical.rows[0] ?? {}) : undefined,
    id_cards: cards.rows,
    issued_documents: issued.rows,
  });
});

router.patch('/students/:id', requirePermission('students.manage'), async (req, res) => {
  const studentId = id.parse(req.params.id);
  const b = updateStudentBody.parse(req.body);
  const st = await studentFor(req, studentId, 'students.manage');
  const s = institutionId(req);
  if (b.section_id !== undefined && b.section_id !== st.section_id) {
    const scope = campusesFor(req, 'students.manage');
    if (b.section_id) {
      await assertInInstitution('sections', b.section_id, s);
      await assertSectionWritable(b.section_id);
      assertCampusAllowed(scope, await campusOfSection(b.section_id));
    } else if (scope !== null) throw forbidden('Only institution-wide administrators can remove a student from every class');
  }
  const changes: Record<string, unknown> = { ...b };
  if (b.custom_data) changes.custom_data = await checkCustomData(s, 'student', b.custom_data, st.custom_data);
  if (b.status && ['graduated', 'left'].includes(b.status) && !st.left_on) changes.left_on = new Date().toISOString().slice(0, 10);
  const params: unknown[] = [studentId, s];
  const set = Object.entries(changes)
    .map(([k, v]) => (params.push(v), `${k} = $${params.length}`))
    .join(', ');
  try {
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(`UPDATE students SET ${set} WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
      const account = rows[0];
      if (b.email || b.first_name || b.last_name) {
        await client.query(
          `UPDATE users SET email = $2, full_name = $3 WHERE ref_id = $1 AND role = 'student' AND institution_id = $4`,
          [studentId, account.email, `${account.first_name} ${account.last_name}`, s]
        );
      }
      if (b.status) {
        // leavers and graduates keep their history but can no longer sign in
        await client.query(`UPDATE users SET is_active = $2 WHERE ref_id = $1 AND role = 'student' AND institution_id = $3`, [studentId, b.status === 'active', s]);
      }
      return account;
    });
    res.json(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Another student or user already has this email');
    throw e;
  }
});

/** To the recycle bin: the record disappears everywhere and the account stops working. */
router.delete('/students/:id', requirePermission('students.manage'), async (req, res) => {
  const studentId = id.parse(req.params.id);
  await studentFor(req, studentId, 'students.manage');
  await softDelete('students', studentId, institutionId(req), currentUser(req).id);
  await db.query(`UPDATE users SET is_active = false WHERE ref_id = $1 AND role = 'student' AND institution_id = $2`, [studentId, institutionId(req)]);
  res.status(204).end();
});

// ---------- medical (restricted) ----------

router.get('/students/:id/medical', requirePermission('students.medical.read'), async (req, res) => {
  const studentId = id.parse(req.params.id);
  await studentFor(req, studentId, 'students.medical.read');
  const { rows } = await db.query(`SELECT * FROM student_medical WHERE student_id = $1`, [studentId]);
  res.json(rows[0] ?? {});
});

router.put('/students/:id/medical', requirePermission('students.medical.manage'), async (req, res) => {
  const studentId = id.parse(req.params.id);
  await studentFor(req, studentId, 'students.medical.manage');
  const b = medicalBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO student_medical (student_id, institution_id, blood_group, conditions, allergies, medications, emergency_contact_name, emergency_contact_phone, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (student_id) DO UPDATE SET blood_group = EXCLUDED.blood_group, conditions = EXCLUDED.conditions, allergies = EXCLUDED.allergies,
       medications = EXCLUDED.medications, emergency_contact_name = EXCLUDED.emergency_contact_name,
       emergency_contact_phone = EXCLUDED.emergency_contact_phone, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [studentId, institutionId(req), b.blood_group, b.conditions, b.allergies, b.medications, b.emergency_contact_name, b.emergency_contact_phone, b.notes, currentUser(req).id]
  );
  res.json(rows[0]);
});

// ---------- guardians of a student ----------

router.post('/students/:id/guardians', requirePermission('guardians.manage'), async (req, res) => {
  const studentId = id.parse(req.params.id);
  await studentFor(req, studentId, 'students.read');
  const b = linkGuardianBody.parse(req.body);
  const s = institutionId(req);
  const result = await withTransaction(async (client) => {
    let guardianId: number;
    if ('guardian_id' in b) {
      await assertInInstitution('guardians', b.guardian_id, s);
      guardianId = b.guardian_id;
    } else {
      const g = b.guardian;
      const custom = await checkCustomData(s, 'guardian', g.custom_data);
      guardianId = (
        await client.query<{ id: number }>(
          `INSERT INTO guardians (institution_id, first_name, last_name, email, phone, national_id, occupation, address, custom_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [s, g.first_name, g.last_name, g.email, g.phone, g.national_id, g.occupation, g.address, custom]
        )
      ).rows[0]!.id;
    }
    if (b.is_primary) await client.query(`UPDATE guardianships SET is_primary = false WHERE student_id = $1`, [studentId]);
    try {
      return (
        await client.query(
          `INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship, is_primary, can_view_grades, can_view_fees, can_message, is_emergency_contact)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [s, guardianId, studentId, b.relationship, b.is_primary, b.can_view_grades, b.can_view_fees, b.can_message, b.is_emergency_contact]
        )
      ).rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('This guardian is already linked to the student');
      throw e;
    }
  });
  res.status(201).json(result);
});

router.patch('/guardianships/:id', requirePermission('guardians.manage'), async (req, res) => {
  const linkId = id.parse(req.params.id);
  const b = updateGuardianshipBody.parse(req.body);
  const s = institutionId(req);
  const { rows: found } = await db.query<{ student_id: number }>(`SELECT student_id FROM guardianships WHERE id = $1 AND institution_id = $2`, [linkId, s]);
  if (!found[0]) throw notFound();
  await studentFor(req, found[0].student_id, 'students.read');
  const row = await withTransaction(async (client) => {
    if (b.is_primary) await client.query(`UPDATE guardianships SET is_primary = false WHERE student_id = $1 AND id <> $2`, [found[0]!.student_id, linkId]);
    const params: unknown[] = [linkId, s];
    const set = Object.entries(b)
      .map(([k, v]) => (params.push(v), `${k} = $${params.length}`))
      .join(', ');
    return (await client.query(`UPDATE guardianships SET ${set} WHERE id = $1 AND institution_id = $2 RETURNING *`, params)).rows[0];
  });
  res.json(row);
});

router.delete('/guardianships/:id', requirePermission('guardians.manage'), async (req, res) => {
  const linkId = id.parse(req.params.id);
  const { rows } = await db.query<{ student_id: number }>(`SELECT student_id FROM guardianships WHERE id = $1 AND institution_id = $2`, [linkId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  await studentFor(req, rows[0].student_id, 'students.read');
  await db.query(`DELETE FROM guardianships WHERE id = $1`, [linkId]);
  res.status(204).end();
});

// ---------------------------------------------------------------- guardians

router.get('/guardians', requirePermission('guardians.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 100) : '';
  const { rows } = await db.query(
    `SELECT g.id, g.first_name, g.last_name, g.phone, g.email, (g.user_id IS NOT NULL) has_account,
            (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending,
            COALESCE((SELECT json_agg(json_build_object('id', st.id, 'name', st.first_name || ' ' || st.last_name, 'relationship', gs.relationship) ORDER BY st.first_name)
                        FROM guardianships gs JOIN students st ON st.id = gs.student_id WHERE gs.guardian_id = g.id), '[]') children,
            count(*) OVER() _total
       FROM guardians g LEFT JOIN users u ON u.id = g.user_id
      WHERE g.institution_id = $1 AND ($2 = '' OR lower(g.first_name || ' ' || g.last_name) LIKE $2 OR g.phone LIKE $2 OR lower(g.email) LIKE $2)
      ORDER BY g.first_name, g.last_name LIMIT $3 OFFSET $4`,
    [institutionId(req), search ? `%${search}%` : '', pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.post('/guardians', requirePermission('guardians.manage'), async (req, res) => {
  const b = guardianBody.parse(req.body);
  const s = institutionId(req);
  const custom = await checkCustomData(s, 'guardian', b.custom_data);
  const { rows } = await db.query(
    `INSERT INTO guardians (institution_id, first_name, last_name, email, phone, national_id, occupation, address, custom_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [s, b.first_name, b.last_name, b.email, b.phone, b.national_id, b.occupation, b.address, custom]
  );
  res.status(201).json(rows[0]);
});

router.get('/guardians/:id', requirePermission('guardians.read'), async (req, res) => {
  const guardianId = id.parse(req.params.id);
  const s = institutionId(req);
  const { rows } = await db.query(
    `SELECT g.*, (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending FROM guardians g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = $1 AND g.institution_id = $2`,
    [guardianId, s]
  );
  if (!rows[0]) throw notFound('Guardian not found');
  const children = await db.query(
    `SELECT gs.id guardianship_id, st.id, st.first_name, st.last_name, st.roll_no, c.name section_name, c.label section_label, cm.name campus_name,
            gs.relationship, gs.is_primary, gs.can_view_grades, gs.can_view_fees, gs.can_message, gs.is_emergency_contact
       FROM guardianships gs JOIN students st ON st.id = gs.student_id LEFT JOIN sections c ON c.id = st.section_id LEFT JOIN campuses cm ON cm.id = c.campus_id
      WHERE gs.guardian_id = $1 ORDER BY st.first_name`,
    [guardianId]
  );
  res.json({ ...rows[0], children: children.rows });
});

router.patch('/guardians/:id', requirePermission('guardians.manage'), async (req, res) => {
  const guardianId = id.parse(req.params.id);
  const b = updateGuardianBody.parse(req.body);
  const s = institutionId(req);
  const { rows: cur } = await db.query(`SELECT * FROM guardians WHERE id = $1 AND institution_id = $2`, [guardianId, s]);
  if (!cur[0]) throw notFound();
  const changes: Record<string, unknown> = { ...b };
  if (b.custom_data) changes.custom_data = await checkCustomData(s, 'guardian', b.custom_data, cur[0].custom_data);
  const params: unknown[] = [guardianId, s];
  const set = Object.entries(changes)
    .map(([k, v]) => (params.push(v), `${k} = $${params.length}`))
    .join(', ');
  const { rows } = await db.query(`UPDATE guardians SET ${set} WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
  if (rows[0].user_id && (b.email || b.first_name || b.last_name)) {
    await db.query(`UPDATE users SET email = COALESCE(NULLIF($2, ''), email), full_name = $3 WHERE id = $1`, [rows[0].user_id, rows[0].email, `${rows[0].first_name} ${rows[0].last_name}`.trim()]);
  }
  res.json(rows[0]);
});

router.delete('/guardians/:id', requirePermission('guardians.manage'), async (req, res) => {
  const guardianId = id.parse(req.params.id);
  const s = institutionId(req);
  const { rows } = await db.query<{ user_id: number | null }>(`SELECT user_id FROM guardians WHERE id = $1 AND institution_id = $2`, [guardianId, s]);
  if (!rows[0]) throw notFound();
  await softDelete('guardians', guardianId, s, currentUser(req).id);
  if (rows[0].user_id) await db.query(`UPDATE users SET is_active = false WHERE id = $1`, [rows[0].user_id]);
  res.status(204).end();
});

/** Give a guardian a parent-portal account (emailed invitation). */
router.post('/guardians/:id/invite', requirePermission('guardians.manage'), async (req, res) => {
  const guardianId = id.parse(req.params.id);
  const s = institutionId(req);
  const { rows } = await db.query(`SELECT * FROM guardians WHERE id = $1 AND institution_id = $2`, [guardianId, s]);
  const g = rows[0];
  if (!g) throw notFound();
  if (!g.email) throw badRequest('Add an email address for this guardian first');
  let userId: number = g.user_id;
  if (!userId) {
    try {
      userId = await withTransaction(async (client) => {
        const uid = await createAccount(s, 'parent', g.email, `${g.first_name} ${g.last_name}`.trim(), null);
        await grantSystemRole(client, uid, 'parent', s, currentUser(req).id);
        await client.query(`UPDATE guardians SET user_id = $2 WHERE id = $1`, [guardianId, uid]);
        return uid;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Someone already has an account with this email');
      throw e;
    }
  } else {
    const { rows: u } = await db.query<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (u[0]?.password_hash) throw badRequest('This guardian already uses the parent portal. They can use "Forgot password".');
  }
  const invite = await inviteUser(userId, { id: currentUser(req).id, name: currentUser(req).name });
  res.json({ invite, user_id: userId });
});

// ---------------------------------------------------------------- staff

async function staffFor(req: Request, staffId: number, permission: Permission) {
  const { rows } = await db.query(`SELECT * FROM teachers WHERE id = $1 AND institution_id = $2`, [staffId, institutionId(req)]);
  const t = rows[0];
  if (!t) throw notFound('Staff member not found');
  assertCampusAllowed(campusesFor(req, permission), t.campus_id);
  return t;
}

const WORKLOAD = `
  (SELECT count(*)::int FROM section_staff ss WHERE ss.teacher_id = t.id) AS courses,
  (SELECT COALESCE(sum(co.credit_hours), 0)::float8 FROM section_staff ss JOIN course_offerings o ON o.id = ss.offering_id
     JOIN courses co ON co.id = o.course_id LEFT JOIN terms tm ON tm.id = o.term_id
    WHERE ss.teacher_id = t.id AND (tm.status IS NULL OR tm.status = 'active')) AS credit_hours,
  (SELECT count(*)::int FROM timetable_slots tt WHERE tt.teacher_id = t.id) AS periods_per_week,
  (SELECT count(*)::int FROM sections hs WHERE hs.homeroom_teacher_id = t.id AND hs.status = 'active') AS homerooms`;

router.get('/teachers', requirePermission('staff.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const f = staffListQuery.parse(req.query);
  const params: unknown[] = [institutionId(req)];
  let where = 't.institution_id = $1';
  if (f.search) {
    params.push(`%${f.search.toLowerCase()}%`);
    where += ` AND (lower(t.first_name || ' ' || t.last_name) LIKE $${params.length} OR lower(t.email) LIKE $${params.length} OR lower(t.employee_no) LIKE $${params.length})`;
  }
  for (const [col, v] of [['t.campus_id', f.campus_id], ['t.department_id', f.department_id]] as const) {
    if (v) {
      params.push(v);
      where += ` AND ${col} = $${params.length}`;
    }
  }
  if (f.staff_type !== 'all') {
    params.push(f.staff_type);
    where += ` AND t.staff_type = $${params.length}`;
  }
  where += campusClause(campusesFor(req, 'staff.read'), 't.campus_id', params);
  params.push(pg.limit, pg.offset);
  const { rows } = await db.query(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.gender, t.phone, t.qualification, t.designation, t.employee_no, t.staff_type,
            t.employment_type, t.status, t.campus_id, cm.name campus_name, t.department_id, d.name department_name,
            (t.photo_file_id IS NOT NULL) has_photo, ${WORKLOAD},
            (SELECT count(*) FROM section_staff ts WHERE ts.teacher_id = t.id)::int subjects,
            u.id user_id, (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending,
            count(*) OVER() _total
       FROM teachers t LEFT JOIN campuses cm ON cm.id = t.campus_id LEFT JOIN departments d ON d.id = t.department_id
       LEFT JOIN users u ON u.ref_id = t.id AND u.role = 'teacher' AND u.institution_id = t.institution_id
      WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  sendPage(res, rows, pg);
});

// Add a staff member (an account + invitation for teaching staff, optional for others)
router.post('/teachers', requirePermission('staff.manage'), async (req, res) => {
  const s = institutionId(req);
  const b = createTeacherBody.parse(req.body);
  const scope = campusesFor(req, 'staff.manage');
  if (scope !== null && !b.campus_id) throw badRequest('Choose the campus', { campus_id: 'required' });
  assertCampusAllowed(scope, scope === null ? null : b.campus_id);
  for (const [table, ref] of [['campuses', b.campus_id], ['departments', b.department_id]] as const) if (ref) await assertInInstitution(table, ref, s);
  const custom = await checkCustomData(s, 'staff', b.custom_data);
  try {
    const t = await withTransaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO teachers (institution_id, first_name, last_name, gender, dob, email, phone, cnic, qualification, designation, employee_no,
                                 staff_type, employment_type, campus_id, department_id, joining_date, custom_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                   COALESCE($14, (SELECT id FROM campuses WHERE institution_id = $1 AND is_main LIMIT 1)),$15,$16,$17) RETURNING *`,
          [s, b.first_name, b.last_name, b.gender, b.dob, b.email, b.phone, b.cnic, b.qualification, b.designation, b.employee_no,
            b.staff_type, b.employment_type, b.campus_id, b.department_id, b.joining_date, custom]
        )
      ).rows[0];
      if (!b.create_account) return { row, userId: null };
      const userId = await createAccount(s, 'teacher', b.email, `${b.first_name} ${b.last_name}`, row.id);
      await grantSystemRole(client, userId, 'teacher', s, currentUser(req).id);
      return { row, userId };
    });
    const invite = t.userId ? await inviteUser(t.userId, { id: currentUser(req).id, name: currentUser(req).name }) : null;
    res.status(201).json({ ...t.row, user_id: t.userId, invite });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A staff member or user with this email (or employee number) already exists');
    throw e;
  }
});

router.get('/teachers/:id', requirePermission('staff.read'), async (req, res) => {
  const staffId = id.parse(req.params.id);
  await staffFor(req, staffId, 'staff.read');
  const s = institutionId(req);
  const [profile, teaching, documents, account] = await Promise.all([
    db.query(
      `SELECT t.*, cm.name campus_name, d.name department_name, ${WORKLOAD}
         FROM teachers t LEFT JOIN campuses cm ON cm.id = t.campus_id LEFT JOIN departments d ON d.id = t.department_id WHERE t.id = $1`,
      [staffId]
    ),
    db.query(
      `SELECT ss.role, o.id offering_id, co.code, co.name, co.credit_hours, sec.id section_id, sec.name section_name, sec.label section_label, tm.name term_name
         FROM section_staff ss JOIN course_offerings o ON o.id = ss.offering_id JOIN courses co ON co.id = o.course_id
         LEFT JOIN sections sec ON sec.id = o.section_id LEFT JOIN terms tm ON tm.id = o.term_id
        WHERE ss.teacher_id = $1 ORDER BY tm.starts_on DESC NULLS LAST, sec.name, co.name`,
      [staffId]
    ),
    db.query(
      `SELECT d.id, d.title, d.category, d.created_at, f.id file_id, f.original_name, f.content_type, f.size_bytes
         FROM person_documents d JOIN files f ON f.id = d.file_id WHERE d.owner_type = 'staff' AND d.owner_id = $1 AND d.institution_id = $2 ORDER BY d.created_at DESC`,
      [staffId, s]
    ),
    db.query(`SELECT id, is_active, (password_hash IS NULL) invite_pending, last_login_at FROM users WHERE ref_id = $1 AND role = 'teacher' AND institution_id = $2`, [staffId, s]),
  ]);
  res.json({ ...profile.rows[0], teaching: teaching.rows, documents: documents.rows, account: account.rows[0] ?? null });
});

router.patch('/teachers/:id', requirePermission('staff.manage'), async (req, res) => {
  const staffId = id.parse(req.params.id);
  const b = updateStaffBody.parse(req.body);
  const t = await staffFor(req, staffId, 'staff.manage');
  const s = institutionId(req);
  if (b.campus_id !== undefined) assertCampusAllowed(campusesFor(req, 'staff.manage'), b.campus_id);
  for (const [table, ref] of [['campuses', b.campus_id], ['departments', b.department_id]] as const) if (ref) await assertInInstitution(table, ref, s);
  const changes: Record<string, unknown> = { ...b };
  if (b.custom_data) changes.custom_data = await checkCustomData(s, 'staff', b.custom_data, t.custom_data);
  const params: unknown[] = [staffId, s];
  const set = Object.entries(changes)
    .map(([k, v]) => (params.push(v), `${k} = $${params.length}`))
    .join(', ');
  try {
    const row = await withTransaction(async (client) => {
      const r = (await client.query(`UPDATE teachers SET ${set} WHERE id = $1 AND institution_id = $2 RETURNING *`, params)).rows[0];
      if (b.email || b.first_name || b.last_name) {
        await client.query(`UPDATE users SET email = $2, full_name = $3 WHERE ref_id = $1 AND role = 'teacher' AND institution_id = $4`, [
          staffId,
          r.email,
          `${r.first_name} ${r.last_name}`,
          s,
        ]);
      }
      if (b.status) await client.query(`UPDATE users SET is_active = $2 WHERE ref_id = $1 AND role = 'teacher' AND institution_id = $3`, [staffId, b.status !== 'left', s]);
      return r;
    });
    res.json(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Another staff member already has this email or employee number');
    throw e;
  }
});

router.delete('/teachers/:id', requirePermission('staff.manage'), async (req, res) => {
  const staffId = id.parse(req.params.id);
  await staffFor(req, staffId, 'staff.manage');
  await softDelete('teachers', staffId, institutionId(req), currentUser(req).id);
  await db.query(`UPDATE users SET is_active = false WHERE ref_id = $1 AND role = 'teacher' AND institution_id = $2`, [staffId, institutionId(req)]);
  res.status(204).end();
});

// ---------------------------------------------------------------- photos & documents

const OWNERS = {
  students: { type: 'student', table: 'students', read: 'students.read', manage: 'students.manage' },
  teachers: { type: 'staff', table: 'teachers', read: 'staff.read', manage: 'staff.manage' },
  guardians: { type: 'guardian', table: 'guardians', read: 'guardians.read', manage: 'guardians.manage' },
} as const;
type OwnerKind = keyof typeof OWNERS;

async function assertOwner(req: Request, kind: OwnerKind, ownerId: number, permission: Permission) {
  if (kind === 'students') await studentFor(req, ownerId, permission);
  else if (kind === 'teachers') await staffFor(req, ownerId, permission);
  else await assertInInstitution('guardians', ownerId, institutionId(req));
}

async function saveUpload(req: Request, purpose: FilePurpose) {
  const file = requireFile(req);
  return storeUpload({ institutionId: institutionId(req), userId: currentUser(req).id, purpose, body: file.buffer, originalName: file.originalname });
}

const putPhoto = (kind: 'students' | 'teachers') =>
  async (req: Request, res: Response) => {
    const ownerId = id.parse(req.params.id);
    await assertOwner(req, kind, ownerId, OWNERS[kind].manage);
    const file = await saveUpload(req, 'photo');
    await db.query(`UPDATE ${kind} SET photo_file_id = $2 WHERE id = $1`, [ownerId, file.id]);
    res.json({ file_id: file.id });
  };
const deletePhoto = (kind: 'students' | 'teachers') =>
  async (req: Request, res: Response) => {
    const ownerId = id.parse(req.params.id);
    await assertOwner(req, kind, ownerId, OWNERS[kind].manage);
    const { rows } = await db.query<{ photo_file_id: number | null }>(`SELECT photo_file_id FROM ${kind} WHERE id = $1`, [ownerId]);
    await db.query(`UPDATE ${kind} SET photo_file_id = NULL WHERE id = $1`, [ownerId]);
    if (rows[0]?.photo_file_id) await softDelete('files', rows[0].photo_file_id, institutionId(req), currentUser(req).id);
    res.status(204).end();
  };
router.put('/students/:id/photo', requirePermission('students.manage'), oneFile, putPhoto('students'));
router.delete('/students/:id/photo', requirePermission('students.manage'), deletePhoto('students'));
router.put('/teachers/:id/photo', requirePermission('staff.manage'), oneFile, putPhoto('teachers'));
router.delete('/teachers/:id/photo', requirePermission('staff.manage'), deletePhoto('teachers'));

const addDocument = (kind: OwnerKind) =>
  async (req: Request, res: Response) => {
    const ownerId = id.parse(req.params.id);
    await assertOwner(req, kind, ownerId, OWNERS[kind].manage);
    const meta = documentMeta.parse(req.body);
    const file = await saveUpload(req, 'document');
    const { rows } = await db.query(
      `INSERT INTO person_documents (institution_id, owner_type, owner_id, file_id, category, title, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [institutionId(req), OWNERS[kind].type, ownerId, file.id, meta.category, meta.title, currentUser(req).id]
    );
    res.status(201).json({ ...rows[0], file });
  };
router.post('/students/:id/documents', requirePermission('students.manage'), oneFile, addDocument('students'));
router.post('/teachers/:id/documents', requirePermission('staff.manage'), oneFile, addDocument('teachers'));
router.post('/guardians/:id/documents', requirePermission('guardians.manage'), oneFile, addDocument('guardians'));

router.delete('/documents/:id', async (req, res) => {
  const docId = id.parse(req.params.id);
  const { rows } = await db.query<{ owner_type: string; owner_id: number; file_id: number }>(
    `SELECT owner_type, owner_id, file_id FROM person_documents WHERE id = $1 AND institution_id = $2`,
    [docId, institutionId(req)]
  );
  const d = rows[0];
  if (!d) throw notFound();
  const kind: OwnerKind = d.owner_type === 'student' ? 'students' : d.owner_type === 'staff' ? 'teachers' : 'guardians';
  if (!userCan(req, OWNERS[kind].manage)) throw forbidden();
  await assertOwner(req, kind, d.owner_id, OWNERS[kind].manage);
  await softDelete('person_documents', docId, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

export default router;
