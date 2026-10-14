// Bulk import and bulk update from CSV / Excel (OneRoster-compatible column names), always with
// a dry run first: POST /imports/:entity/preview shows what would happen row by row, then
// /commit applies it in one transaction. Also bulk invitations. Mounted under /api/institution.
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { GUARDIAN_RELATIONSHIPS, email as emailSchema, isoDate, type Permission } from '@acadex/shared';
import { inviteUser } from '../auth/invites';
import { db, withTransaction, type Db } from '../db/context';
import { fieldDefs } from '../lib/custom-fields';
import { HttpError, badRequest, forbidden } from '../lib/errors';
import { mapHeaders, parseBool, parseDate, readRows, rowObject, type RawRow } from '../lib/import-parse';
import { campusesFor } from '../lib/structure';
import { auth, currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';
import { grantSystemRole } from '../rbac';
import { storeUpload } from '../storage/files';

const router = Router();
router.use(auth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 } });
const oneFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'The file is too large (maximum 5 MB)', undefined, 'FILE_TOO_LARGE'));
    next(err instanceof multer.MulterError ? badRequest(err.message) : err);
  });

const ENTITIES = ['students', 'staff', 'guardians', 'courses', 'enrollments'] as const;
type Entity = (typeof ENTITIES)[number];
const entityParam = z.enum(ENTITIES);
const modeParam = z.enum(['create', 'upsert']).default('create');

const NEEDS: Record<Entity, Permission> = {
  students: 'students.manage',
  staff: 'staff.manage',
  guardians: 'guardians.manage',
  courses: 'structure.manage',
  enrollments: 'enrollments.manage',
};

const ALIASES: Record<Entity, Record<string, string[]>> = {
  students: {
    first_name: ['firstname', 'givenname', 'first'],
    last_name: ['lastname', 'familyname', 'surname', 'last'],
    email: ['emailaddress', 'mail'],
    roll_no: ['rollno', 'rollnumber', 'identifier', 'studentid', 'admissionno', 'registrationno', 'regno'],
    section: ['class', 'sectioncode', 'classcode', 'batch', 'cohort'],
    gender: ['sex'],
    dob: ['dateofbirth', 'birthdate', 'birthday'],
    phone: ['mobile', 'phonenumber', 'sms'],
    city: ['town'],
    address: ['homeaddress'],
    national_id: ['cnic', 'bform', 'nationalid'],
    admission_date: ['admissiondate', 'enrolmentdate', 'enrollmentdate'],
    guardian_name: ['parentname', 'fathername', 'guardian'],
    guardian_phone: ['parentphone', 'fatherphone', 'guardianmobile'],
    guardian_email: ['parentemail'],
    guardian_relationship: ['relationship', 'relation'],
    status: ['enabledUser'],
  },
  staff: {
    first_name: ['firstname', 'givenname', 'first'],
    last_name: ['lastname', 'familyname', 'surname', 'last'],
    email: ['emailaddress', 'mail'],
    phone: ['mobile', 'phonenumber', 'sms'],
    designation: ['title', 'jobtitle', 'position'],
    employee_no: ['employeeno', 'employeeid', 'identifier', 'staffid'],
    qualification: ['qualifications', 'degree'],
    gender: ['sex'],
    staff_type: ['stafftype', 'type'],
    employment_type: ['employmenttype', 'contract'],
    campus: ['campuscode', 'branch', 'orgsourcedids'],
    department: ['departmentcode', 'dept'],
    joining_date: ['joiningdate', 'startdate', 'hiredate'],
    cnic: ['nationalid'],
  },
  guardians: {
    first_name: ['firstname', 'givenname', 'first'],
    last_name: ['lastname', 'familyname', 'surname', 'last'],
    email: ['emailaddress', 'mail'],
    phone: ['mobile', 'phonenumber', 'sms'],
    relationship: ['relation', 'type'],
    student: ['studentrollno', 'studentemail', 'student', 'rollno', 'childrollno'],
    is_primary: ['primary', 'primarycontact'],
    can_view_grades: ['grades', 'viewgrades'],
    can_view_fees: ['fees', 'viewfees'],
    can_message: ['messages', 'canmessage'],
    occupation: ['job', 'profession'],
    national_id: ['cnic'],
  },
  courses: {
    code: ['coursecode', 'subjectcode'],
    name: ['title', 'coursename', 'subject', 'subjectname'],
    credit_hours: ['credits', 'credithours', 'creditunits'],
    department: ['departmentcode', 'dept'],
    description: ['summary'],
  },
  enrollments: {
    student: ['usersourcedid', 'user', 'studentemail', 'studentrollno', 'rollno', 'email'],
    course: ['coursecode', 'course'],
    section: ['sectioncode', 'class', 'classcode', 'batch', 'cohort'],
    offering_id: ['classsourcedid', 'offering'],
    role: ['enrollmentrole'],
  },
};

interface RowResult {
  row: number;
  action: 'create' | 'update' | 'link' | 'skip';
  label: string;
  errors: { field: string; message: string }[];
  apply?: (client: Db) => Promise<{ invite?: number }>;
}

const lower = (v?: string) => (v ?? '').trim().toLowerCase();
const emailOk = (v: string) => emailSchema.safeParse(v).success;
const dateOk = (v: string) => isoDate.safeParse(v).success;

/** Lookups shared by every row (a handful of queries per import, not per row). */
async function loadContext(s: number) {
  const [sections, campuses, departments, students, staff, guardians, courses, offerings] = await Promise.all([
    db.query<{ id: number; code: string; campus_id: number | null; status: string; year_status: string | null }>(
      `SELECT s.id, s.code, s.campus_id, s.status, ay.status year_status FROM sections s LEFT JOIN academic_years ay ON ay.id = s.academic_year_id WHERE s.institution_id = $1`,
      [s]
    ),
    db.query<{ id: number; code: string }>(`SELECT id, code FROM campuses WHERE institution_id = $1`, [s]),
    db.query<{ id: number; code: string }>(`SELECT id, code FROM departments WHERE institution_id = $1`, [s]),
    db.query<{ id: number; email: string; roll_no: string | null; section_id: number | null }>(`SELECT id, email, roll_no, section_id FROM students WHERE institution_id = $1`, [s]),
    db.query<{ id: number; email: string; employee_no: string | null }>(`SELECT id, email, employee_no FROM teachers WHERE institution_id = $1`, [s]),
    db.query<{ id: number; email: string; phone: string }>(`SELECT id, email, phone FROM guardians WHERE institution_id = $1`, [s]),
    db.query<{ id: number; code: string }>(`SELECT id, code FROM courses WHERE institution_id = $1`, [s]),
    db.query<{ id: number; course_id: number; section_id: number | null; enrollment_mode: string; capacity: number | null; term_status: string | null }>(
      `SELECT o.id, o.course_id, o.section_id, o.enrollment_mode, o.capacity, t.status term_status FROM course_offerings o LEFT JOIN terms t ON t.id = o.term_id WHERE o.institution_id = $1`,
      [s]
    ),
  ]);
  const byLower = <T>(rows: T[], key: (r: T) => string | null | undefined) => new Map(rows.filter((r) => key(r)).map((r) => [lower(key(r)!), r]));
  return {
    sections: byLower(sections.rows, (r) => r.code),
    campuses: byLower(campuses.rows, (r) => r.code),
    departments: byLower(departments.rows, (r) => r.code),
    studentsByEmail: byLower(students.rows, (r) => r.email),
    studentsByRoll: byLower(students.rows, (r) => r.roll_no),
    studentsById: new Map(students.rows.map((r) => [String(r.id), r])),
    staffByEmail: byLower(staff.rows, (r) => r.email),
    staffByNo: byLower(staff.rows, (r) => r.employee_no),
    guardiansByEmail: byLower(guardians.rows, (r) => r.email),
    guardiansByPhone: byLower(guardians.rows, (r) => r.phone),
    courses: byLower(courses.rows, (r) => r.code),
    offerings: offerings.rows,
  };
}
type Ctx = Awaited<ReturnType<typeof loadContext>>;

async function account(client: Db, s: number, role: 'student' | 'teacher' | 'parent', email: string, name: string, ref: number | null, by: number) {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO users (institution_id, role, email, password_hash, full_name, ref_id) VALUES ($1,$2,$3,NULL,$4,$5) RETURNING id`,
    [s, role, email, name, ref]
  );
  await grantSystemRole(client, rows[0]!.id, role, s, by);
  return rows[0]!.id;
}

function checkCustom(defs: Awaited<ReturnType<typeof fieldDefs>>, custom: Record<string, string>, errors: RowResult['errors']) {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(custom)) {
    const def = defs.find((d) => d.key === key)!;
    if (raw === '') continue;
    if (def.field_type === 'number') {
      if (!Number.isFinite(Number(raw))) errors.push({ field: key, message: `${def.label} must be a number` });
      else out[key] = Number(raw);
    } else if (def.field_type === 'checkbox') {
      const b = parseBool(raw);
      if (b === undefined) errors.push({ field: key, message: `${def.label} must be yes or no` });
      else out[key] = b;
    } else if (def.field_type === 'select') {
      const match = def.options.find((o) => lower(o) === lower(raw));
      if (!match) errors.push({ field: key, message: `${def.label} must be one of: ${def.options.join(', ')}` });
      else out[key] = match;
    } else if (def.field_type === 'date') {
      const d = parseDate(raw)!;
      if (!dateOk(d)) errors.push({ field: key, message: `${def.label} must be a date` });
      else out[key] = d;
    } else out[key] = raw.slice(0, 500);
  }
  return out;
}

// ---------------------------------------------------------------- per-entity row handlers

function studentRow(req: Request, ctx: Ctx, mode: 'create' | 'upsert', r: RawRow, custom: Record<string, string>, defs: Awaited<ReturnType<typeof fieldDefs>>, seen: Set<string>): Omit<RowResult, 'row'> {
  const s = institutionId(req);
  const errors: RowResult['errors'] = [];
  const email = lower(r.email);
  const existing = (email && ctx.studentsByEmail.get(email)) || (r.roll_no && ctx.studentsByRoll.get(lower(r.roll_no))) || null;
  const action = existing ? (mode === 'upsert' ? 'update' : 'skip') : 'create';
  if (action === 'skip') errors.push({ field: 'email', message: 'This student already exists (use "create or update" to update)' });
  if (action === 'create') {
    if (!r.first_name) errors.push({ field: 'first_name', message: 'Required' });
    if (!r.last_name) errors.push({ field: 'last_name', message: 'Required' });
    if (!email) errors.push({ field: 'email', message: 'Required' });
  }
  if (email && !emailOk(email)) errors.push({ field: 'email', message: 'Not a valid email' });
  if (email) {
    if (seen.has(email)) errors.push({ field: 'email', message: 'Appears twice in this file' });
    seen.add(email);
  }
  let sectionId: number | null | undefined;
  if (r.section) {
    const sec = ctx.sections.get(lower(r.section));
    if (!sec) errors.push({ field: 'section', message: `No class with code "${r.section}"` });
    else if (sec.status === 'archived' || sec.year_status === 'archived') errors.push({ field: 'section', message: 'That class is archived' });
    else {
      const scope = campusesFor(req, 'students.manage');
      if (scope !== null && (sec.campus_id == null || !scope.includes(sec.campus_id))) errors.push({ field: 'section', message: 'That class is on a campus you do not manage' });
      sectionId = sec.id;
    }
  } else if (action === 'create' && campusesFor(req, 'students.manage') !== null) errors.push({ field: 'section', message: 'Required' });
  const dob = parseDate(r.dob);
  if (dob && !dateOk(dob)) errors.push({ field: 'dob', message: 'Not a valid date' });
  const admission = parseDate(r.admission_date);
  if (admission && !dateOk(admission)) errors.push({ field: 'admission_date', message: 'Not a valid date' });
  const status = r.status ? lower(r.status) : undefined;
  if (status && !['active', 'inactive', 'graduated', 'left', 'true', 'false'].includes(status)) errors.push({ field: 'status', message: 'active, inactive, graduated or left' });
  const relationship = lower(r.guardian_relationship) || 'guardian';
  if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)) errors.push({ field: 'guardian_relationship', message: `One of: ${GUARDIAN_RELATIONSHIPS.join(', ')}` });
  if (r.guardian_email && !emailOk(r.guardian_email)) errors.push({ field: 'guardian_email', message: 'Not a valid email' });
  const customData = checkCustom(defs, custom, errors);
  const label = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || email || r.roll_no || '—';
  const normStatus = status === 'true' ? 'active' : status === 'false' ? 'inactive' : status;
  const by = currentUser(req).id;
  return {
    action,
    label,
    errors,
    apply: async (client) => {
      if (action === 'update' && existing) {
        const fields: Record<string, unknown> = {
          first_name: r.first_name, last_name: r.last_name, roll_no: r.roll_no, section_id: sectionId, gender: r.gender, dob, phone: r.phone,
          city: r.city, address: r.address, national_id: r.national_id, admission_date: admission, status: normStatus,
        };
        const params: unknown[] = [existing.id];
        const sets = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => (params.push(v), `${k} = $${params.length}`));
        if (Object.keys(customData).length) {
          params.push(JSON.stringify(customData));
          sets.push(`custom_data = custom_data || $${params.length}::jsonb`);
        }
        if (sets.length) await client.query(`UPDATE students SET ${sets.join(', ')} WHERE id = $1`, params);
        return {};
      }
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO students (institution_id, first_name, last_name, email, roll_no, section_id, gender, dob, phone, city, address, national_id, admission_date, status, custom_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,''),COALESCE($11,''),COALESCE($12,''),COALESCE($13::date, CURRENT_DATE),COALESCE($14,'active'),$15) RETURNING id`,
        [s, r.first_name, r.last_name, email, r.roll_no ?? null, sectionId ?? null, r.gender ?? null, dob ?? null, r.phone ?? null, r.city, r.address, r.national_id, admission ?? null, normStatus ?? null, customData]
      );
      const sid = rows[0]!.id;
      if (r.guardian_name) {
        const [first = '', ...rest] = r.guardian_name.split(/\s+/);
        const g = await client.query<{ id: number }>(
          `INSERT INTO guardians (institution_id, first_name, last_name, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [s, first, rest.join(' '), r.guardian_phone ?? '', lower(r.guardian_email)]
        );
        await client.query(
          `INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship, is_primary, is_emergency_contact) VALUES ($1,$2,$3,$4,true,true)`,
          [s, g.rows[0]!.id, sid, relationship]
        );
      }
      return { invite: await account(client, s, 'student', email, `${r.first_name} ${r.last_name}`, sid, by) };
    },
  };
}

function staffRow(req: Request, ctx: Ctx, mode: 'create' | 'upsert', r: RawRow, custom: Record<string, string>, defs: Awaited<ReturnType<typeof fieldDefs>>, seen: Set<string>): Omit<RowResult, 'row'> {
  const s = institutionId(req);
  const errors: RowResult['errors'] = [];
  const email = lower(r.email);
  const existing = (email && ctx.staffByEmail.get(email)) || (r.employee_no && ctx.staffByNo.get(lower(r.employee_no))) || null;
  const action = existing ? (mode === 'upsert' ? 'update' : 'skip') : 'create';
  if (action === 'skip') errors.push({ field: 'email', message: 'This staff member already exists (use "create or update" to update)' });
  if (action === 'create') {
    if (!r.first_name) errors.push({ field: 'first_name', message: 'Required' });
    if (!r.last_name) errors.push({ field: 'last_name', message: 'Required' });
    if (!email) errors.push({ field: 'email', message: 'Required' });
  }
  if (email && !emailOk(email)) errors.push({ field: 'email', message: 'Not a valid email' });
  if (email) {
    if (seen.has(email)) errors.push({ field: 'email', message: 'Appears twice in this file' });
    seen.add(email);
  }
  const staffType = r.staff_type ? (lower(r.staff_type).startsWith('non') ? 'non_teaching' : 'teaching') : undefined;
  const employment = r.employment_type ? lower(r.employment_type).replace(/[\s-]+/g, '_') : undefined;
  if (employment && !['full_time', 'part_time', 'visiting', 'contract'].includes(employment)) errors.push({ field: 'employment_type', message: 'full time, part time, visiting or contract' });
  let campusId: number | undefined;
  if (r.campus) {
    const c = ctx.campuses.get(lower(r.campus));
    if (!c) errors.push({ field: 'campus', message: `No campus with code "${r.campus}"` });
    else campusId = c.id;
  }
  const scope = campusesFor(req, 'staff.manage');
  if (scope !== null && (campusId == null || !scope.includes(campusId))) errors.push({ field: 'campus', message: 'Choose one of your campuses' });
  let departmentId: number | undefined;
  if (r.department) {
    const d = ctx.departments.get(lower(r.department));
    if (!d) errors.push({ field: 'department', message: `No department with code "${r.department}"` });
    else departmentId = d.id;
  }
  const joining = parseDate(r.joining_date);
  if (joining && !dateOk(joining)) errors.push({ field: 'joining_date', message: 'Not a valid date' });
  const customData = checkCustom(defs, custom, errors);
  const by = currentUser(req).id;
  return {
    action,
    label: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || email || '—',
    errors,
    apply: async (client) => {
      if (action === 'update' && existing) {
        const fields: Record<string, unknown> = {
          first_name: r.first_name, last_name: r.last_name, phone: r.phone, designation: r.designation, employee_no: r.employee_no, qualification: r.qualification,
          gender: r.gender, staff_type: staffType, employment_type: employment, campus_id: campusId, department_id: departmentId, joining_date: joining, cnic: r.cnic,
        };
        const params: unknown[] = [existing.id];
        const sets = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => (params.push(v), `${k} = $${params.length}`));
        if (Object.keys(customData).length) {
          params.push(JSON.stringify(customData));
          sets.push(`custom_data = custom_data || $${params.length}::jsonb`);
        }
        if (sets.length) await client.query(`UPDATE teachers SET ${sets.join(', ')} WHERE id = $1`, params);
        return {};
      }
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO teachers (institution_id, first_name, last_name, email, phone, designation, employee_no, qualification, gender, staff_type, employment_type, campus_id, department_id, joining_date, cnic, custom_data)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,''),$7,COALESCE($8,''),$9,COALESCE($10,'teaching'),COALESCE($11,'full_time'),
                 COALESCE($12,(SELECT id FROM campuses WHERE institution_id = $1 AND is_main LIMIT 1)),$13,$14,$15,$16) RETURNING id`,
        [s, r.first_name, r.last_name, email, r.phone ?? null, r.designation ?? null, r.employee_no ?? null, r.qualification ?? null, r.gender ?? null, staffType ?? null, employment ?? null, campusId ?? null, departmentId ?? null, joining ?? null, r.cnic ?? null, customData]
      );
      if ((staffType ?? 'teaching') !== 'teaching') return {};
      return { invite: await account(client, s, 'teacher', email, `${r.first_name} ${r.last_name}`, rows[0]!.id, by) };
    },
  };
}

function guardianRow(req: Request, ctx: Ctx, _mode: 'create' | 'upsert', r: RawRow, seen: Set<string>): Omit<RowResult, 'row'> {
  const s = institutionId(req);
  const errors: RowResult['errors'] = [];
  const email = lower(r.email);
  if (!r.first_name) errors.push({ field: 'first_name', message: 'Required' });
  if (email && !emailOk(email)) errors.push({ field: 'email', message: 'Not a valid email' });
  if (!email && !r.phone) errors.push({ field: 'phone', message: 'An email or a phone number is needed to recognise the guardian' });
  const student = r.student ? ctx.studentsByRoll.get(lower(r.student)) ?? ctx.studentsByEmail.get(lower(r.student)) : undefined;
  if (!r.student) errors.push({ field: 'student', message: 'Required (roll number or email)' });
  else if (!student) errors.push({ field: 'student', message: `No student "${r.student}"` });
  const relationship = lower(r.relationship) || 'guardian';
  if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)) errors.push({ field: 'relationship', message: `One of: ${GUARDIAN_RELATIONSHIPS.join(', ')}` });
  const perms = { is_primary: parseBool(r.is_primary), can_view_grades: parseBool(r.can_view_grades), can_view_fees: parseBool(r.can_view_fees), can_message: parseBool(r.can_message) };
  const existing = (email && ctx.guardiansByEmail.get(email)) || (r.phone && ctx.guardiansByPhone.get(lower(r.phone))) || null;
  // the same new guardian twice in one file: created by the first row, linked by the others
  const key = email || `phone:${lower(r.phone)}`;
  const repeat = seen.has(key);
  seen.add(key);
  return {
    action: existing || repeat ? 'link' : 'create',
    label: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() + (student ? ` → ${r.student}` : ''),
    errors,
    apply: async (client) => {
      // looked up when applied, so earlier rows of the same file count
      let gid = ((email && ctx.guardiansByEmail.get(email)) || (r.phone && ctx.guardiansByPhone.get(lower(r.phone))) || existing)?.id;
      if (!gid) {
        gid = (
          await client.query<{ id: number }>(
            `INSERT INTO guardians (institution_id, first_name, last_name, email, phone, occupation, national_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [s, r.first_name, r.last_name ?? '', email, r.phone ?? '', r.occupation ?? '', r.national_id ?? '']
          )
        ).rows[0]!.id;
        if (email) ctx.guardiansByEmail.set(email, { id: gid, email, phone: r.phone ?? '' });
        if (r.phone) ctx.guardiansByPhone.set(lower(r.phone), { id: gid, email, phone: r.phone });
      }
      await client.query(
        `INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship, is_primary, can_view_grades, can_view_fees, can_message)
         VALUES ($1,$2,$3,$4,COALESCE($5,false),COALESCE($6,true),COALESCE($7,true),COALESCE($8,true))
         ON CONFLICT ON CONSTRAINT guardianships_guardian_id_student_id_key DO UPDATE SET relationship = EXCLUDED.relationship,
           is_primary = COALESCE($5, guardianships.is_primary), can_view_grades = COALESCE($6, guardianships.can_view_grades),
           can_view_fees = COALESCE($7, guardianships.can_view_fees), can_message = COALESCE($8, guardianships.can_message)`,
        [s, gid, student!.id, relationship, perms.is_primary ?? null, perms.can_view_grades ?? null, perms.can_view_fees ?? null, perms.can_message ?? null]
      );
      return {};
    },
  };
}

function courseRow(req: Request, ctx: Ctx, mode: 'create' | 'upsert', r: RawRow, seen: Set<string>): Omit<RowResult, 'row'> {
  const s = institutionId(req);
  const errors: RowResult['errors'] = [];
  const code = (r.code ?? '').trim();
  if (!code) errors.push({ field: 'code', message: 'Required' });
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code) || code.length > 20) errors.push({ field: 'code', message: 'Letters, digits, dot, dash or underscore (max 20)' });
  if (seen.has(lower(code))) errors.push({ field: 'code', message: 'Appears twice in this file' });
  seen.add(lower(code));
  const existing = ctx.courses.get(lower(code));
  const action = existing ? (mode === 'upsert' ? 'update' : 'skip') : 'create';
  if (action === 'skip') errors.push({ field: 'code', message: 'This course already exists (use "create or update" to update)' });
  if (action === 'create' && !r.name) errors.push({ field: 'name', message: 'Required' });
  const credits = r.credit_hours !== undefined ? Number(r.credit_hours) : undefined;
  if (credits !== undefined && (!Number.isFinite(credits) || credits < 0 || credits > 50)) errors.push({ field: 'credit_hours', message: 'A number from 0 to 50' });
  let departmentId: number | undefined;
  if (r.department) {
    const d = ctx.departments.get(lower(r.department));
    if (!d) errors.push({ field: 'department', message: `No department with code "${r.department}"` });
    else departmentId = d.id;
  }
  return {
    action,
    label: `${code} ${r.name ?? ''}`.trim(),
    errors,
    apply: async (client) => {
      if (existing) {
        await client.query(
          `UPDATE courses SET name = COALESCE($2, name), credit_hours = COALESCE($3, credit_hours), department_id = COALESCE($4, department_id), description = COALESCE($5, description) WHERE id = $1`,
          [existing.id, r.name ?? null, credits ?? null, departmentId ?? null, r.description ?? null]
        );
      } else {
        await client.query(`INSERT INTO courses (institution_id, code, name, credit_hours, department_id, description) VALUES ($1,$2,$3,$4,$5,COALESCE($6,''))`, [
          s, code, r.name, credits ?? null, departmentId ?? null, r.description ?? null,
        ]);
      }
      return {};
    },
  };
}

function enrollmentRow(req: Request, ctx: Ctx, _mode: 'create' | 'upsert', r: RawRow): Omit<RowResult, 'row'> {
  const s = institutionId(req);
  const errors: RowResult['errors'] = [];
  const role = lower(r.role) || 'student';
  if (!['student', 'teacher'].includes(role)) errors.push({ field: 'role', message: 'student or teacher' });
  let offering: Ctx['offerings'][number] | undefined;
  if (r.offering_id) offering = ctx.offerings.find((o) => String(o.id) === r.offering_id!.trim());
  else {
    const course = r.course ? ctx.courses.get(lower(r.course)) : undefined;
    const section = r.section ? ctx.sections.get(lower(r.section)) : undefined;
    if (!r.course) errors.push({ field: 'course', message: 'Required (or the offering id)' });
    else if (!course) errors.push({ field: 'course', message: `No course "${r.course}"` });
    if (r.section && !section) errors.push({ field: 'section', message: `No class "${r.section}"` });
    if (course) {
      const candidates = ctx.offerings.filter((o) => o.course_id === course.id && (!section || o.section_id === section.id) && o.term_status !== 'archived');
      offering = candidates.find((o) => o.term_status === 'active') ?? candidates[0];
      if (!offering && !errors.length) errors.push({ field: 'course', message: 'That course is not offered (in an open term) for this class' });
    }
  }
  if (!offering && r.offering_id) errors.push({ field: 'offering_id', message: 'No such course offering' });
  if (offering?.term_status === 'archived') errors.push({ field: 'course', message: 'That course is in an archived term' });
  const who = lower(r.student);
  if (!who) errors.push({ field: 'student', message: 'Required (email, roll number or id)' });
  const student = role === 'student' ? ctx.studentsByEmail.get(who) ?? ctx.studentsByRoll.get(who) ?? ctx.studentsById.get(who) : undefined;
  const teacher = role === 'teacher' ? ctx.staffByEmail.get(who) ?? ctx.staffByNo.get(who) : undefined;
  if (who && role === 'student' && !student) errors.push({ field: 'student', message: `No student "${r.student}"` });
  if (who && role === 'teacher' && !teacher) errors.push({ field: 'student', message: `No staff member "${r.student}"` });
  return {
    action: 'link',
    label: `${r.student ?? ''} → ${r.course ?? r.offering_id ?? ''}${r.section ? ` (${r.section})` : ''}`,
    errors,
    apply: async (client) => {
      const o = offering!;
      if (role === 'teacher') {
        await client.query(
          `INSERT INTO section_staff (institution_id, teacher_id, offering_id, section_id, role) SELECT $1,$2,$3,$4,'teacher'
            WHERE NOT EXISTS (SELECT 1 FROM section_staff WHERE offering_id = $3 AND teacher_id = $2)`,
          [s, teacher!.id, o.id, o.section_id]
        );
      } else if (o.enrollment_mode === 'section') {
        // everyone in the class takes it: enrolling means joining the class
        await client.query(`UPDATE students SET section_id = $2 WHERE id = $1`, [student!.id, o.section_id]);
      } else {
        await client.query(
          `INSERT INTO enrollments (institution_id, offering_id, student_id, status, waitlist_position)
           SELECT $1, $2, $3, CASE WHEN o.capacity IS NULL OR o.capacity > (SELECT count(*) FROM enrollments WHERE offering_id = $2 AND status = 'active') THEN 'active' ELSE 'waitlisted' END,
                  CASE WHEN o.capacity IS NOT NULL AND o.capacity <= (SELECT count(*) FROM enrollments WHERE offering_id = $2 AND status = 'active')
                       THEN (SELECT COALESCE(max(waitlist_position), 0) + 1 FROM enrollments WHERE offering_id = $2 AND status = 'waitlisted') END
             FROM course_offerings o WHERE o.id = $2
           ON CONFLICT ON CONSTRAINT enrollments_offering_id_student_id_key DO NOTHING`,
          [s, o.id, student!.id]
        );
      }
      return {};
    },
  };
}

// ---------------------------------------------------------------- preview / commit

async function evaluate(req: Request, entity: Entity, mode: 'create' | 'upsert') {
  const file = req.file;
  if (!file) throw badRequest('Attach the CSV or Excel file in the "file" field');
  const s = institutionId(req);
  const stored = await storeUpload({ institutionId: s, userId: currentUser(req).id, purpose: 'import', body: file.buffer, originalName: file.originalname });
  const { headers, rows } = await readRows(file.buffer, stored.content_type);
  const defs = ['students', 'staff', 'guardians'].includes(entity) ? await fieldDefs(s, entity === 'students' ? 'student' : entity === 'staff' ? 'staff' : 'guardian') : [];
  const { map, custom, unmatched } = mapHeaders(headers, ALIASES[entity], defs);
  const ctx = await loadContext(s);
  const seen = new Set<string>();
  const results: RowResult[] = rows.map((cells, i) => {
    const r = rowObject(cells, map);
    const c = Object.fromEntries(Object.entries(custom).map(([k, idx]) => [k, (cells[idx] ?? '').trim()]));
    const base =
      entity === 'students' ? studentRow(req, ctx, mode, r, c, defs, seen)
      : entity === 'staff' ? staffRow(req, ctx, mode, r, c, defs, seen)
      : entity === 'guardians' ? guardianRow(req, ctx, mode, r, seen)
      : entity === 'courses' ? courseRow(req, ctx, mode, r, seen)
      : enrollmentRow(req, ctx, mode, r);
    return { row: i + 2, ...base }; // +2: spreadsheet row number (header is row 1)
  });
  const summary = {
    entity,
    mode,
    file_name: file.originalname,
    total: results.length,
    valid: results.filter((r) => !r.errors.length).length,
    invalid: results.filter((r) => r.errors.length).length,
    creates: results.filter((r) => !r.errors.length && r.action === 'create').length,
    updates: results.filter((r) => !r.errors.length && r.action === 'update').length,
    links: results.filter((r) => !r.errors.length && r.action === 'link').length,
    columns: { matched: Object.keys(map).concat(Object.keys(custom).map((k) => `custom: ${k}`)), unmatched },
  };
  return { summary, results };
}

const guard = (req: Request) => {
  const entity = entityParam.parse(req.params.entity);
  if (!userCan(req, NEEDS[entity])) throw forbidden(`Importing ${entity} needs the ${NEEDS[entity]} permission`);
  return entity;
};

router.post('/imports/:entity/preview', requirePermission('imports.run'), oneFile, async (req, res) => {
  const entity = guard(req);
  const { summary, results } = await evaluate(req, entity, modeParam.parse(req.body?.mode));
  res.json({ ...summary, rows: results.map(({ apply: _apply, ...r }) => r) });
});

router.post('/imports/:entity/commit', requirePermission('imports.run'), oneFile, async (req, res) => {
  const entity = guard(req);
  const mode = modeParam.parse(req.body?.mode);
  const skipInvalid = parseBool(req.body?.skip_invalid) === true;
  const sendInvites = parseBool(req.body?.send_invites) === true;
  const { summary, results } = await evaluate(req, entity, mode);
  const errors = results.filter((r) => r.errors.length);
  if (errors.length && !skipInvalid) {
    return void res.status(422).json({
      error: `${errors.length} rows have problems — fix them, or import only the valid rows`,
      code: 'IMPORT_INVALID',
      ...summary,
      rows: results.map(({ apply: _apply, ...r }) => r),
    });
  }
  const invites: number[] = [];
  await withTransaction(async (client) => {
    for (const r of results) {
      if (r.errors.length || !r.apply) continue;
      const out = await r.apply(client);
      if (out.invite) invites.push(out.invite);
    }
  });
  const by = { id: currentUser(req).id, name: currentUser(req).name };
  if (sendInvites) for (const userId of invites) await inviteUser(userId, by);
  const { rows } = await db.query(
    `INSERT INTO import_jobs (institution_id, entity, mode, status, file_name, total_rows, ok_rows, error_rows, errors, created_by)
     VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9) RETURNING id`,
    [institutionId(req), entity, mode, summary.file_name, summary.total, summary.valid, summary.invalid,
      JSON.stringify(errors.map((r) => ({ row: r.row, label: r.label, errors: r.errors }))), by.id]
  );
  res.status(201).json({ ...summary, job_id: rows[0].id, imported: summary.valid, skipped: summary.invalid, accounts: invites.length, invites_sent: sendInvites ? invites.length : 0 });
});

router.get('/imports', requirePermission('imports.run'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.id, j.entity, j.mode, j.status, j.file_name, j.total_rows, j.ok_rows, j.error_rows, j.errors, j.created_at, u.full_name created_by_name
       FROM import_jobs j LEFT JOIN users u ON u.id = j.created_by WHERE j.institution_id = $1 ORDER BY j.created_at DESC LIMIT 50`,
    [institutionId(req)]
  );
  res.json(rows);
});

const TEMPLATES: Record<Entity, string[]> = {
  students: ['first_name', 'last_name', 'email', 'roll_no', 'section', 'gender', 'dob', 'phone', 'guardian_name', 'guardian_phone', 'guardian_email', 'guardian_relationship', 'city', 'address'],
  staff: ['first_name', 'last_name', 'email', 'phone', 'designation', 'employee_no', 'qualification', 'staff_type', 'campus', 'department', 'joining_date'],
  guardians: ['first_name', 'last_name', 'email', 'phone', 'relationship', 'student', 'is_primary', 'can_view_grades', 'can_view_fees', 'can_message'],
  courses: ['code', 'name', 'credit_hours', 'department', 'description'],
  enrollments: ['student', 'course', 'section', 'role'],
};

/** A CSV with the right headers (and the institution's custom fields) to fill in. */
router.get('/imports/templates/:entity', requirePermission('imports.run'), async (req, res) => {
  const entity = entityParam.parse(req.params.entity);
  const defs = ['students', 'staff', 'guardians'].includes(entity)
    ? await fieldDefs(institutionId(req), entity === 'students' ? 'student' : entity === 'staff' ? 'staff' : 'guardian')
    : [];
  const header = [...TEMPLATES[entity], ...defs.map((d) => d.key)].join(',');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="acadex-${entity}-template.csv"` });
  res.send(`\uFEFF${header}\r\n`); // a BOM so Excel opens it as UTF-8
});

// ---------------------------------------------------------------- bulk invite

const bulkInviteBody = z.object({
  kind: z.enum(['students', 'staff', 'guardians']),
  /** limit to these record ids; omitted = everyone who still needs an invitation */
  ids: z.array(z.coerce.number().int().positive()).max(2000).optional(),
});

/** Send invitations to everyone who hasn't activated an account (guardians: create one first). */
router.post('/bulk-invite', async (req, res) => {
  const b = bulkInviteBody.parse(req.body);
  const need: Permission = b.kind === 'students' ? 'students.manage' : b.kind === 'staff' ? 'staff.manage' : 'guardians.manage';
  if (!userCan(req, need)) throw forbidden();
  const s = institutionId(req);
  const by = { id: currentUser(req).id, name: currentUser(req).name };
  const ids = b.ids ?? null;
  const userIds: number[] = [];
  let skipped = 0;
  if (b.kind === 'guardians') {
    const { rows } = await db.query<{ id: number; email: string; name: string; user_id: number | null; activated: boolean }>(
      `SELECT g.id, g.email, trim(g.first_name || ' ' || g.last_name) AS name, g.user_id, (u.password_hash IS NOT NULL) AS activated
         FROM guardians g LEFT JOIN users u ON u.id = g.user_id
        WHERE g.institution_id = $1 AND ($2::int[] IS NULL OR g.id = ANY($2))`,
      [s, ids]
    );
    await withTransaction(async (client) => {
      for (const g of rows) {
        if (g.activated || !g.email) {
          skipped++;
          continue;
        }
        if (g.user_id) {
          userIds.push(g.user_id);
          continue;
        }
        const { rows: clash } = await client.query(`SELECT 1 FROM users WHERE email = $1`, [g.email]);
        if (clash[0]) {
          skipped++;
          continue;
        }
        const uid = await account(client, s, 'parent', g.email, g.name, null, by.id);
        await client.query(`UPDATE guardians SET user_id = $2 WHERE id = $1`, [g.id, uid]);
        userIds.push(uid);
      }
    });
  } else {
    const role = b.kind === 'students' ? 'student' : 'teacher';
    const table = b.kind === 'students' ? 'students' : 'teachers';
    const { rows } = await db.query<{ id: number }>(
      `SELECT u.id FROM users u JOIN ${table} p ON p.id = u.ref_id
        WHERE u.institution_id = $1 AND u.role = $2 AND u.password_hash IS NULL AND u.is_active AND ($3::int[] IS NULL OR p.id = ANY($3))`,
      [s, role, ids]
    );
    userIds.push(...rows.map((r) => r.id));
  }
  for (const uid of userIds) await inviteUser(uid, by);
  res.json({ invited: userIds.length, skipped });
});

export default router;
