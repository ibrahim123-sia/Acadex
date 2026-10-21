// Demo data for local development: four institutions that each look native.
//   Greenwood High School   a school (one campus, classes, letter grades, an archived last session)
//   Sunrise Schools         a 3-branch school network (branch principals see only their branch)
//   Northfield University   a university (departments, semesters, credit hours, GPA, open enrolment)
//   Skillforge Academy      a training center (cohorts, trainers, modules, competency grading)
// plus a platform admin and a group admin over Greenwood + Sunrise.
//
// Refuses to run in production, and refuses a database that already has data unless --reset.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  GRADING_PRESETS,
  INSTITUTION_DEFAULTS,
  academicYearFor,
  type GradingPreset,
  type InstitutionType,
} from '@acadex/shared';
import { pool } from './pool';
import { db, runAsSystem } from './context';
import { todayIn } from '../lib/locale';
import { syncRbacCatalogue } from '../rbac';

const TZ = 'Asia/Karachi';
const PW = 'Acadex@123';
const TODAY = todayIn(TZ);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const q = async (text: string, params?: unknown[]): Promise<Row[]> => (await db.query(text, params)).rows;

/** Multi-row INSERT in chunks (one round trip per 300 rows). Rows come back in input order. */
async function insertMany(table: string, cols: string[], rows: unknown[][], returning = 'id'): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(',')})`).join(',');
    out.push(...(await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values} RETURNING ${returning}`, params)));
  }
  return out;
}

// deterministic pseudo-random numbers, so every seed run produces the same data
let seedState = 42;
const rnd = () => ((seedState = (seedState * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const code = (n = 10) => crypto.randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, n).toUpperCase();

const FIRST = ['Ali','Fatima','Hamza','Zainab','Ahmed','Maryam','Hassan','Aisha','Omar','Iqra','Saad','Noor','Talha','Areeba','Bilal','Sana','Usman','Hina','Danish','Mahnoor','Faizan','Rida','Kashan','Emaan'];
const LAST = ['Sheikh','Butt','Qureshi','Farooq','Nadeem','Javed','Aslam','Riaz','Khalid','Tariq','Mehmood','Siddiqui','Anwar','Baig','Malik','Raza','Khan','Shah'];
const FATHERS = ['Imran','Kamran','Tariq','Nadeem','Asif','Shahid','Rashid','Zahid','Khalid','Naveed'];
const MOTHERS = ['Saima','Nadia','Shazia','Rubina','Farah','Uzma','Sadia','Amna','Huma','Asma'];

function dateAdd(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** the calendar year an institution's current academic year starts in */
const y0 = (inst: { year: Row }) => Number(String(inst.year.starts_on).slice(0, 4));

let hash = '';
const users: Row[] = [];
async function makeUsers(
  list: { institution_id: number | null; role: string; email: string; full_name: string; ref_id?: number | null }[]
): Promise<Row[]> {
  if (!list.length) return [];
  const rows = await insertMany(
    'users',
    ['institution_id', 'role', 'email', 'password_hash', 'full_name', 'ref_id', 'email_verified_at'],
    list.map((u) => [u.institution_id, u.role, u.email.toLowerCase(), hash, u.full_name, u.ref_id ?? null, new Date()]),
    'id, institution_id, role, email'
  );
  users.push(...rows);
  return rows;
}

/** Grant each user the built-in role matching their primary role (one statement). */
async function grantPrimaryRoles(rows: Row[], skip: Set<number> = new Set()) {
  const list = rows.filter((u) => !skip.has(u.id));
  if (!list.length) return;
  await q(
    `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, institution_id)
     SELECT u.id, r.id, r.scope_type, CASE WHEN r.scope_type = 'platform' THEN NULL ELSE u.scope END,
            CASE WHEN r.scope_type = 'institution' THEN u.scope END
       FROM unnest($1::int[], $2::text[], $3::int[]) AS u(id, role, scope)
       JOIN roles r ON r.key = u.role AND r.institution_id IS NULL AND r.is_system`,
    [list.map((u) => u.id), list.map((u) => u.role), list.map((u) => u.scope ?? u.institution_id)]
  );
}

// ---------------------------------------------------------------- institution skeleton

interface InstitutionDef {
  name: string;
  slug: string;
  type: InstitutionType;
  color: string;
  plan: 'free' | 'pro' | 'enterprise';
  address: string;
  phone: string;
  campuses: { code: string; name: string; address: string }[];
  grading?: GradingPreset;
  extraGrading?: GradingPreset[];
  settings?: Row;
  groupId?: number | null;
}

interface Inst {
  id: number;
  slug: string;
  type: InstitutionType;
  campuses: Row[];
  year: Row;
  terms: Row[];
  schemes: Record<string, number>;
}

async function createInstitution(def: InstitutionDef): Promise<Inst> {
  const [inst] = await q(
    `INSERT INTO institutions (name, slug, primary_color, plan, contact_email, phone, address, type, group_id, settings, onboarded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING id`,
    [def.name, def.slug, def.color, def.plan, `info@${def.slug}.edu`, def.phone, def.address, def.type, def.groupId ?? null, def.settings ?? {}]
  );
  const id = inst!.id as number;
  // the bank account printed on fee vouchers, and the test payment provider (demo only: no money moves)
  await q(
    `INSERT INTO payment_accounts (institution_id, provider, mode, public_config) VALUES ($1, 'bank', 'live', $2), ($1, 'fake', 'sandbox', '{}')`,
    [id, JSON.stringify({ bank_name: 'Meezan Bank', branch: 'Main branch', account_title: def.name, iban: `PK36MEZN00${String(1000000000000000 + id * 7919).slice(0, 14)}` })]
  );
  const campuses = await insertMany(
    'campuses',
    ['institution_id', 'name', 'code', 'address', 'phone', 'is_main'],
    def.campuses.map((c, i) => [id, c.name, c.code, c.address, def.phone, i === 0]),
    'id, code, name'
  );
  const defaults = INSTITUTION_DEFAULTS[def.type];
  const layout = academicYearFor(defaults, TODAY);
  const [year] = await q(
    `INSERT INTO academic_years (institution_id, name, starts_on, ends_on, status, is_current) VALUES ($1,$2,$3,$4,'active',true) RETURNING *`,
    [id, layout.name, layout.startsOn, layout.endsOn]
  );
  const terms = await insertMany(
    'terms',
    ['institution_id', 'academic_year_id', 'name', 'kind', 'sequence', 'starts_on', 'ends_on', 'status'],
    layout.terms.map((t) => [
      id,
      year!.id,
      t.name,
      defaults.termKind,
      t.sequence,
      t.startsOn,
      t.endsOn,
      t.startsOn <= TODAY && (!t.endsOn || t.endsOn >= TODAY) ? 'active' : t.startsOn > TODAY ? 'planned' : 'archived',
    ]),
    '*'
  );
  const schemes: Record<string, number> = {};
  for (const [i, key] of [def.grading ?? defaults.grading, ...(def.extraGrading ?? [])].entries()) {
    const p = GRADING_PRESETS[key];
    const [s] = await q(
      `INSERT INTO grading_schemes (institution_id, name, kind, bands, gpa_scale, pass_percent, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [id, p.name, p.kind, JSON.stringify(p.bands), 'gpa_scale' in p ? p.gpa_scale : null, p.pass_percent, i === 0]
    );
    schemes[key] = s!.id;
  }
  return { id, slug: def.slug, type: def.type, campuses, year: year!, terms, schemes };
}

async function addPrograms(inst: Inst, programs: { code: string; name: string; levels: string[]; department_id?: number | null; grading?: GradingPreset; credits?: number }[]) {
  const out: Record<string, { id: number; levels: Row[] }> = {};
  for (const p of programs) {
    const [row] = await q(
      `INSERT INTO programs (institution_id, department_id, name, code, grading_scheme_id, credits_required) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [inst.id, p.department_id ?? null, p.name, p.code, p.grading ? inst.schemes[p.grading] : null, p.credits ?? null]
    );
    const levels = await insertMany(
      'program_levels',
      ['institution_id', 'program_id', 'name', 'sequence'],
      p.levels.map((l, i) => [inst.id, row!.id, l, i + 1]),
      'id, name, sequence'
    );
    out[p.code] = { id: row!.id, levels };
  }
  return out;
}

async function addCourses(inst: Inst, courses: { code: string; name: string; credits?: number; department_id?: number | null }[]) {
  const rows = await insertMany(
    'courses',
    ['institution_id', 'department_id', 'code', 'name', 'credit_hours'],
    courses.map((c) => [inst.id, c.department_id ?? null, c.code, c.name, c.credits ?? null]),
    'id, code, name'
  );
  return Object.fromEntries(rows.map((r) => [r.code, r])) as Record<string, Row>;
}

let staffIndex = 0;
async function addStaff(inst: Inst, n: number, opts: { campus_id: number; department_id?: number | null; designations: string[]; qualifications: string[] }) {
  const list = Array.from({ length: n }, () => {
    const i = staffIndex++;
    const fn = FIRST[(i * 3) % FIRST.length]!;
    const ln = LAST[(i * 5) % LAST.length]!;
    return { i, fn, ln, email: `${fn}.${ln}.t${i}@${inst.slug}.edu`.toLowerCase() };
  });
  const rows = await insertMany(
    'teachers',
    ['institution_id', 'first_name', 'last_name', 'gender', 'dob', 'email', 'phone', 'cnic', 'qualification', 'designation',
      'employee_no', 'campus_id', 'department_id', 'joining_date', 'staff_type', 'employment_type'],
    list.map((s) => [
      inst.id, s.fn, s.ln, s.i % 2 ? 'Female' : 'Male', `198${s.i % 9}-04-12`, s.email, `+92300${1210000 + s.i}`,
      `42101-${1000000 + s.i}-${s.i % 9}`, pick(opts.qualifications), pick(opts.designations),
      `EMP-${String(1000 + s.i)}`, opts.campus_id, opts.department_id ?? null, dateAdd(TODAY, -between(200, 2500)), 'teaching',
      s.i % 5 === 4 ? 'visiting' : 'full_time',
    ]),
    'id, first_name, last_name, email'
  );
  const accounts = await makeUsers(rows.map((t) => ({ institution_id: inst.id, role: 'teacher', email: t.email, full_name: `${t.first_name} ${t.last_name}`, ref_id: t.id })));
  await grantPrimaryRoles(accounts);
  return rows;
}

let studentIndex = 0;
interface SectionDef {
  code: string;
  name: string;
  label: string;
  campus_id: number;
  level_id: number;
  year_id?: number;
  students: number;
  age: [number, number];
  homeroom?: number | null;
  capacity?: number | null;
  status?: 'active' | 'archived';
}
async function addSection(inst: Inst, s: SectionDef) {
  const [row] = await q(
    `INSERT INTO sections (institution_id, code, name, label, campus_id, program_level_id, academic_year_id, capacity, homeroom_teacher_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, code, name`,
    [inst.id, s.code, s.name, s.label, s.campus_id, s.level_id, s.year_id ?? inst.year.id, s.capacity ?? null, s.homeroom ?? null, s.status ?? 'active']
  );
  return row!;
}

async function addStudents(inst: Inst, section: Row | null, n: number, age: [number, number], extra: { status?: string; left_on?: string } = {}) {
  const list = Array.from({ length: n }, (_, j) => {
    const i = studentIndex++;
    // even positions in FIRST are boys' names, odd ones girls': match the gender below
    const fn = FIRST[(i * 2 + (i % 2)) % FIRST.length]!;
    const ln = LAST[(i * 3 + 1) % LAST.length]!;
    return { i, j, fn, ln, email: `${fn}.${ln}.s${i}@${inst.slug}.edu`.toLowerCase() };
  });
  const prefix = inst.slug.toUpperCase().slice(0, 3);
  const rows = await insertMany(
    'students',
    ['institution_id', 'roll_no', 'first_name', 'last_name', 'age', 'gender', 'email', 'phone', 'dob', 'section_id', 'city',
      'national_id', 'nationality', 'address', 'admission_date', 'status', 'left_on'],
    list.map((s) => {
      const a = between(age[0], age[1]);
      return [
        inst.id, `${prefix}-${section ? section.code : 'ALU'}-${String(s.j + 1).padStart(3, '0')}`, s.fn, s.ln, a, s.i % 2 ? 'Female' : 'Male',
        s.email, `+92310${1220000 + s.i}`, `${Number(TODAY.slice(0, 4)) - a}-0${1 + (s.i % 9)}-15`, section?.id ?? null,
        pick(['Karachi', 'Lahore', 'Islamabad']), `42201-${2000000 + s.i}-${s.i % 9}`, 'Pakistani',
        `House ${10 + s.i}, Street ${1 + (s.i % 20)}`, dateAdd(TODAY, -between(30, 900)), extra.status ?? 'active', extra.left_on ?? null,
      ];
    }),
    'id, first_name, last_name, email, section_id'
  );
  const accounts = await makeUsers(rows.map((st) => ({ institution_id: inst.id, role: 'student', email: st.email, full_name: `${st.first_name} ${st.last_name}`, ref_id: st.id })));
  await grantPrimaryRoles(accounts);
  // a father for everyone, a mother for every third student
  const guardianRows: unknown[][] = [];
  const links: { student: number; idx: number; relationship: string; primary: boolean }[] = [];
  rows.forEach((st, k) => {
    guardianRows.push([inst.id, pick(FATHERS), st.last_name, `+92300${3330000 + st.id}`, 'Business', `House ${10 + k}`]);
    links.push({ student: st.id, idx: guardianRows.length - 1, relationship: 'father', primary: true });
    if (k % 3 === 0) {
      guardianRows.push([inst.id, pick(MOTHERS), st.last_name, `+92301${4440000 + st.id}`, 'Teacher', `House ${10 + k}`]);
      links.push({ student: st.id, idx: guardianRows.length - 1, relationship: 'mother', primary: false });
    }
  });
  const guardians = await insertMany('guardians', ['institution_id', 'first_name', 'last_name', 'phone', 'occupation', 'address'], guardianRows);
  await insertMany(
    'guardianships',
    ['institution_id', 'guardian_id', 'student_id', 'relationship', 'is_primary', 'is_emergency_contact'],
    links.map((l) => [inst.id, guardians[l.idx]!.id, l.student, l.relationship, l.primary, l.primary])
  );
  return rows;
}

/** Offer courses to a section in a term and assign teachers round-robin. */
async function offer(inst: Inst, section: Row, courses: Row[], term: Row, staff: Row[], opts: { mode?: 'section' | 'open'; capacity?: number | null; start?: number } = {}) {
  const offerings = await insertMany(
    'course_offerings',
    ['institution_id', 'section_id', 'course_id', 'term_id', 'enrollment_mode', 'capacity'],
    courses.map((c) => [inst.id, section.id, c.id, term.id, opts.mode ?? 'section', opts.capacity ?? null]),
    'id, course_id'
  );
  await insertMany(
    'section_staff',
    ['institution_id', 'teacher_id', 'offering_id', 'section_id', 'role'],
    offerings.map((o, i) => [inst.id, staff[((opts.start ?? 0) + i) % staff.length]!.id, o.id, section.id, 'teacher'])
  );
  return offerings.map((o, i) => ({
    id: o.id as number,
    course_id: o.course_id as number,
    name: courses[i]!.name as string,
    teacher_id: staff[((opts.start ?? 0) + i) % staff.length]!.id as number,
  }));
}

const holidaysOf = new Map<number, Set<string>>();
async function addHolidays(inst: Inst, list: { name: string; from: string; to: string; kind?: string; campus_id?: number | null }[]) {
  await insertMany('holidays', ['institution_id', 'campus_id', 'name', 'starts_on', 'ends_on', 'kind'], list.map((h) => [inst.id, h.campus_id ?? null, h.name, h.from, h.to, h.kind ?? 'holiday']));
  const days = new Set<string>();
  for (const h of list) for (let d = h.from; d <= h.to; d = dateAdd(d, 1)) days.add(d);
  holidaysOf.set(inst.id, days);
}

/** The last n working days before today (no weekends, no holidays). */
function pastSchoolDays(inst: Inst, n: number) {
  const working = new Set(INSTITUTION_DEFAULTS[inst.type].workingDays);
  const off = holidaysOf.get(inst.id) ?? new Set();
  const out: string[] = [];
  for (let d = dateAdd(TODAY, -1); out.length < n; d = dateAdd(d, -1)) if (working.has(weekday(d)) && !off.has(d)) out.push(d);
  return out;
}
function nextSchoolDay(inst: Inst, from: string) {
  const working = new Set(INSTITUTION_DEFAULTS[inst.type].workingDays);
  const off = holidaysOf.get(inst.id) ?? new Set();
  let d = from;
  while (!working.has(weekday(d)) || off.has(d)) d = dateAdd(d, 1);
  return d;
}

/** The bell schedule of an institution (once): six teaching periods with a break. */
const periodsOf = new Map<number, Row[]>();
async function bellSchedule(inst: Inst) {
  const hit = periodsOf.get(inst.id);
  if (hit) return hit;
  const plan: [string, string, string, boolean][] = [
    ['Period 1', '08:00', '08:45', false],
    ['Period 2', '08:45', '09:30', false],
    ['Period 3', '09:30', '10:15', false],
    ['Break', '10:15', '10:45', true],
    ['Period 4', '10:45', '11:30', false],
    ['Period 5', '11:30', '12:15', false],
    ['Period 6', '12:15', '13:00', false],
  ];
  const rows = await insertMany('periods', ['institution_id', 'name', 'starts_at', 'ends_at', 'position', 'is_break'], plan.map((p, i) => [inst.id, p[0], p[1], p[2], i + 1, p[3]]), 'id, is_break');
  const teaching = rows.filter((r) => !r.is_break);
  periodsOf.set(inst.id, teaching);
  return teaching;
}

const PAGE = (course: string, topic: string) =>
  `<h2>${topic}</h2><p>In this part of <strong>${course}</strong> we look at ${topic.toLowerCase()}. Read the notes, try the examples, then check yourself with the practice questions.</p><ul><li>Key idea one</li><li>Key idea two</li><li>A worked example</li></ul>`;

/** Course space, assessments with released grades, upcoming work, registers, fees and the timetable for a section. */
async function addActivity(
  inst: Inst,
  section: Row,
  students: Row[],
  offerings: { id: number; name: string; teacher_id: number }[],
  opts: { fee: number[]; assessments: [string, string, number][]; attendanceDays?: number; timetable?: boolean }
) {
  const days = pastSchoolDays(inst, opts.attendanceDays ?? 10);
  const teacherUser = async (teacherId: number) => (await q(`SELECT id FROM users WHERE role = 'teacher' AND ref_id = $1`, [teacherId]))[0]?.id ?? null;
  const perClass = inst.type === 'university' || inst.type === 'college';

  // registers: one a day for schools, one per class for colleges and universities
  const sessions = perClass
    ? await insertMany('attendance_sessions', ['institution_id', 'section_id', 'offering_id', 'date', 'kind'], days.flatMap((d) => offerings.slice(0, 2).map((o) => [inst.id, section.id, o.id, d, 'class'])), 'id')
    : await insertMany('attendance_sessions', ['institution_id', 'section_id', 'date', 'kind'], days.map((d) => [inst.id, section.id, d, 'day']), 'id');
  await insertMany(
    'attendance_records',
    ['session_id', 'student_id', 'institution_id', 'status', 'minutes_late', 'method'],
    sessions.flatMap((s, di) =>
      students.map((st, k) => {
        const status = (k + di) % 11 === 0 ? 'absent' : (k + di) % 17 === 0 ? 'leave' : (k + di) % 13 === 0 ? 'late' : 'present';
        return [s.id, st.id, inst.id, status, status === 'late' ? 10 : null, 'manual'];
      })
    ),
    'session_id'
  );

  for (const [oi, o] of offerings.entries()) {
    const createdBy = await teacherUser(o.teacher_id);
    // gradebook categories
    const cats = await insertMany(
      'grade_categories',
      ['institution_id', 'offering_id', 'name', 'weight', 'drop_lowest', 'position'],
      [
        [inst.id, o.id, 'Assignments', 30, 0, 0],
        [inst.id, o.id, 'Quizzes', 20, 0, 1],
        [inst.id, o.id, 'Exams', 50, 0, 2],
      ],
      'id, name'
    );
    const cat = (kind: string) => cats.find((c) => c.name === (kind === 'quiz' ? 'Quizzes' : kind === 'exam' ? 'Exams' : 'Assignments'))!.id;
    // course space: three modules of pages, the first two published
    const mods = await insertMany(
      'modules',
      ['institution_id', 'offering_id', 'title', 'description', 'position', 'published'],
      ['Getting started', 'Unit 1', 'Unit 2'].map((t, i) => [inst.id, o.id, t, i === 0 ? `How ${o.name} works this term.` : '', i, i < 2]),
      'id'
    );
    await insertMany(
      'content_items',
      ['institution_id', 'module_id', 'kind', 'title', 'body_html', 'position', 'completion'],
      [
        [inst.id, mods[0]!.id, 'page', 'Welcome and course outline', PAGE(o.name, 'Course outline'), 0, 'view'],
        [inst.id, mods[1]!.id, 'page', `${o.name}: lesson notes`, PAGE(o.name, 'The first unit'), 0, 'mark_done'],
        [inst.id, mods[1]!.id, 'link', 'Further reading (OpenStax)', '', 1, 'view'],
        [inst.id, mods[2]!.id, 'page', `${o.name}: unit 2 notes`, PAGE(o.name, 'The second unit'), 0, 'mark_done'],
      ]
    );
    await q(`UPDATE content_items SET url = 'https://openstax.org/subjects' WHERE module_id = $1 AND kind = 'link'`, [mods[1]!.id]);

    // past assessments, graded and released
    for (const [type, name, total] of opts.assessments) {
      const kind = /quiz/i.test(type) ? 'quiz' : /mid|final|exam|test/i.test(type) ? 'exam' : /project/i.test(type) ? 'project' : 'assignment';
      const [a] = await q(
        `INSERT INTO assessments (institution_id, offering_id, category_id, kind, title, points, due_at, status, submission_types, release_mode, grades_released_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8,'manual',now(),$9) RETURNING id`,
        [inst.id, o.id, cat(kind), kind, `${o.name} — ${name}`, total, `${dateAdd(TODAY, -between(5, 25))}T17:00:00Z`, kind === 'quiz' || kind === 'exam' ? ['none'] : ['text', 'file'], createdBy]
      );
      await insertMany(
        'grades',
        ['institution_id', 'assessment_id', 'student_id', 'points', 'status', 'graded_at', 'released_at', 'feedback_html'],
        students.map((st, k) => [inst.id, a!.id, st.id, Math.round(total * (0.45 + ((k * 13 + o.id * 7) % 50) / 100)), 'released', new Date(), new Date(), k % 3 === 0 ? '<p>Good work — show your steps next time.</p>' : ''])
      );
    }

    // upcoming work: an assignment linked into Unit 1, handed in by a few students
    const [hw] = await q(
      `INSERT INTO assessments (institution_id, offering_id, category_id, kind, title, instructions_html, points, due_at, status, submission_types, allowed_attempts, late_policy, created_by)
       VALUES ($1,$2,$3,'assignment',$4,$5,20,$6,'published',ARRAY['text','file','link'],2,'{"mode":"penalty","penalty_percent_per_day":10,"max_penalty_percent":50}',$7) RETURNING id`,
      [inst.id, o.id, cat('assignment'), `${o.name}: ${pick(['Chapter review', 'Worksheet', 'Mini project', 'Practice problems'])}`, `<p>Complete the ${o.name} task and hand it in before the due date.</p>`, `${nextSchoolDay(inst, dateAdd(TODAY, 4 + (oi % 3) * 2))}T18:59:00Z`, createdBy]
    );
    await q(`INSERT INTO content_items (institution_id, module_id, kind, title, assessment_id, completion, position) VALUES ($1,$2,'assessment',$3,$4,'submit',2)`, [inst.id, mods[1]!.id, 'Hand in: unit 1 task', hw!.id]);
    for (const st of students.slice(0, 2)) {
      const [sub] = await q(`INSERT INTO submissions (institution_id, assessment_id, student_id, attempt, status, submitted_at) VALUES ($1,$2,$3,1,'submitted',now() - interval '1 day') RETURNING id`, [inst.id, hw!.id, st.id]);
      await q(`INSERT INTO submission_versions (institution_id, submission_id, version, text_html) VALUES ($1,$2,1,$3)`, [inst.id, sub!.id, `<p>${st.first_name}'s answers for the unit 1 task.</p>`]);
    }

    // the first course of each section also has a quiz from a question bank
    if (oi === 0) {
      const [bank] = await q(`INSERT INTO question_banks (institution_id, course_id, name, created_by) VALUES ($1,(SELECT course_id FROM course_offerings WHERE id = $2),$3,$4) RETURNING id`, [inst.id, o.id, `${o.name} question bank`, createdBy]);
      const qs: [string, string, unknown][] = [
        ['mcq', `<p>Which of these best describes the main idea of unit 1 in ${o.name}?</p>`, { options: [{ id: 'a', text: 'The key idea' }, { id: 'b', text: 'A side note' }, { id: 'c', text: 'Something unrelated' }], correct: 'a' }],
        ['true_false', '<p>Practice makes learning stick.</p>', { correct: true }],
        ['numeric', '<p>What is 12 × 12?</p>', { answer: 144, tolerance: 0 }],
        ['short', '<p>Name the first unit of this course.</p>', { accepted: ['unit 1', 'the first unit'], case_sensitive: false }],
        ['essay', '<p>In two or three sentences, explain one thing you learned this week.</p>', { min_words: 10, max_words: 150 }],
      ];
      const qrows = await insertMany('questions', ['institution_id', 'bank_id', 'type', 'prompt_html', 'data', 'points', 'created_by'], qs.map(([t, p, d]) => [inst.id, bank!.id, t, p, JSON.stringify(d), t === 'essay' ? 4 : 2, createdBy]));
      const [quiz] = await q(
        `INSERT INTO assessments (institution_id, offering_id, category_id, kind, title, points, due_at, status, submission_types, allowed_attempts, quiz, created_by)
         VALUES ($1,$2,$3,'quiz',$4,12,$5,'published',ARRAY['none'],2,'{"time_limit_minutes":20,"shuffle_questions":true,"shuffle_options":true,"one_at_a_time":false,"show_results":"after_submit","scoring":"highest"}',$6) RETURNING id`,
        [inst.id, o.id, cat('quiz'), `${o.name}: unit 1 check`, `${nextSchoolDay(inst, dateAdd(TODAY, 6))}T18:59:00Z`, createdBy]
      );
      await insertMany('assessment_questions', ['institution_id', 'assessment_id', 'question_id', 'position'], qrows.map((r, i) => [inst.id, quiz!.id, r.id, i]));
      await q(`INSERT INTO content_items (institution_id, module_id, kind, title, assessment_id, completion, position) VALUES ($1,$2,'assessment','Quiz: unit 1 check',$3,'submit',3)`, [inst.id, mods[1]!.id, quiz!.id]);
    }
    // some progress through the space
    const firstItems = await q(`SELECT i.id FROM content_items i WHERE i.module_id = ANY($1::int[]) AND i.kind = 'page' ORDER BY i.module_id, i.position LIMIT 2`, [mods.map((m) => m.id)]);
    const progress = students.flatMap((st, k) => firstItems.slice(0, (k % 3) + 0).map((it) => [st.id, it.id, inst.id, 'done', 100, new Date()]));
    if (progress.length) await insertMany('content_progress', ['student_id', 'item_id', 'institution_id', 'status', 'percent', 'completed_at'], progress, 'item_id');
  }

  // fees: a structure for the section with two instalments (one past due, one coming up),
  // invoices for every student, and a mix of paid, part-paid and unpaid
  const total = pick(opts.fee);
  const half = Math.round(total / 2);
  const [structure] = await q(
    `INSERT INTO fee_structures (institution_id, name, academic_year_id, late_fine) VALUES ($1,$2,$3,'{"kind":"per_day","amount":50,"grace_days":3,"max":1500}') RETURNING id`,
    [inst.id, `${section.name} fees`, section.academic_year_id ?? null]
  );
  await q(`INSERT INTO fee_structure_items (institution_id, structure_id, head, amount, frequency, position) VALUES ($1,$2,'Tuition',$3,'per_installment',0), ($1,$2,'Exam fee',1500,'once',1)`, [inst.id, structure!.id, half]);
  const insts = await insertMany('fee_installments', ['institution_id', 'structure_id', 'label', 'due_date', 'position'], [
    [inst.id, structure!.id, 'First instalment', dateAdd(TODAY, -25), 0],
    [inst.id, structure!.id, 'Second instalment', dateAdd(TODAY, 12), 1],
  ]);
  const year = TODAY.slice(0, 4);
  const currency = (await q(`SELECT currency FROM institutions WHERE id = $1`, [inst.id]))[0]!.currency as string;
  const invoiceRows: unknown[][] = [];
  students.forEach((st, k) => {
    insts.forEach((ins, n) => {
      const amount = half + (n === 0 ? 1500 : 0);
      const paid = n === 0 ? [amount, amount, Math.round(amount / 2), 0][k % 4]! : k % 4 === 0 ? amount : 0;
      invoiceRows.push([
        inst.id, `INV-${year}-${inst.slug.slice(0, 3).toUpperCase()}${String(st.id).padStart(5, '0')}${n}`, st.id, structure!.id, ins.id,
        `${section.name} fees — ${n === 0 ? 'First' : 'Second'} instalment`, dateAdd(TODAY, n === 0 ? -40 : -3), dateAdd(TODAY, n === 0 ? -25 : 12),
        paid >= amount ? 'paid' : paid > 0 ? 'partially_paid' : 'issued', currency, amount, paid, crypto.randomBytes(18).toString('base64url'),
      ]);
    });
  });
  const invoices = await insertMany(
    'invoices',
    ['institution_id', 'number', 'student_id', 'structure_id', 'installment_id', 'title', 'issue_date', 'due_date', 'status', 'currency', 'total', 'paid', 'pay_token'],
    invoiceRows,
    'id, student_id, total, paid, number'
  );
  await insertMany(
    'invoice_items',
    ['institution_id', 'invoice_id', 'kind', 'head', 'label', 'amount'],
    invoices.flatMap((v, i) => (i % 2 === 0 ? [[inst.id, v.id, 'fee', 'Tuition', 'Tuition', half], [inst.id, v.id, 'fee', 'Exam fee', 'Exam fee', 1500]] : [[inst.id, v.id, 'fee', 'Tuition', 'Tuition', half]]))
  );
  const pays = invoices.filter((v) => Number(v.paid) > 0);
  if (pays.length) {
    await insertMany(
      'payments',
      ['institution_id', 'invoice_id', 'student_id', 'receipt_no', 'amount', 'method', 'received_at'],
      pays.map((v, i) => [inst.id, v.id, v.student_id, `RCT-${year}-${String(v.id).padStart(6, '0')}`, v.paid, i % 3 === 0 ? 'bank' : 'cash', `${dateAdd(TODAY, -between(1, 20))}T10:00:00Z`])
    );
  }

  if (opts.timetable) {
    const periods = await bellSchedule(inst);
    const term = inst.terms.find((t) => t.status === 'active') ?? inst.terms[0];
    const workdays = [1, 2, 3, 4, 5];
    await q(`UPDATE course_offerings SET periods_per_week = 5 WHERE id = ANY($1::int[])`, [offerings.map((o) => o.id)]);
    const slots: unknown[][] = [];
    const used = new Set<string>();
    for (const [di, d] of workdays.entries()) {
      for (const [oi, o] of offerings.slice(0, periods.length).entries()) {
        const p = periods[(oi + di) % periods.length]!;
        // a teacher who teaches two sections can't be in both at once
        const key = `${o.teacher_id}:${d}:${p.id}`;
        const clash = used.has(key) || (await q(`SELECT 1 FROM timetable_slots WHERE teacher_id = $1 AND weekday = $2 AND period_id = $3 AND term_id IS NOT DISTINCT FROM $4`, [o.teacher_id, d, p.id, term?.id ?? null]))[0];
        used.add(key);
        slots.push([inst.id, term?.id ?? null, section.id, o.id, clash ? null : o.teacher_id, d, p.id]);
      }
    }
    await insertMany('timetable_slots', ['institution_id', 'term_id', 'section_id', 'offering_id', 'teacher_id', 'weekday', 'period_id'], slots);
  }
}

async function addMedical(inst: Inst, students: Row[]) {
  const notes = [
    { blood: 'B+', allergies: 'Peanuts', conditions: '', meds: 'EpiPen in the school bag' },
    { blood: 'O+', allergies: '', conditions: 'Asthma', meds: 'Inhaler as needed' },
    { blood: 'A-', allergies: 'Penicillin', conditions: '', meds: '' },
  ];
  await insertMany(
    'student_medical',
    ['student_id', 'institution_id', 'blood_group', 'allergies', 'conditions', 'medications', 'emergency_contact_name', 'emergency_contact_phone'],
    students.slice(0, 3).map((st, i) => [st.id, inst.id, notes[i]!.blood, notes[i]!.allergies, notes[i]!.conditions, notes[i]!.meds, `${pick(FATHERS)} ${st.last_name}`, `+92300${5550000 + st.id}`]),
    'student_id'
  );
}

async function announce(inst: Inst, list: [string, string, string][]) {
  await insertMany(
    'announcements',
    ['institution_id', 'title', 'target_audience', 'description', 'end_date'],
    list.map(([title, audience, text]) => [inst.id, title, audience, text, dateAdd(TODAY, 30)])
  );
}

async function notify(inst: Inst, userRows: Row[], type: string, title: string, message: string) {
  if (!userRows.length) return;
  await insertMany('notifications', ['institution_id', 'user_id', 'type', 'title', 'message'], userRows.map((u) => [inst.id, u.id, type, title, message]));
}

async function adminFor(inst: Inst, email: string, name: string) {
  const [u] = await makeUsers([{ institution_id: inst.id, role: 'institution_admin', email, full_name: name }]);
  await grantPrimaryRoles([u!]);
  return u!;
}

// ---------------------------------------------------------------- the four tenants

async function seedGreenwood(groupId: number) {
  const inst = await createInstitution({
    name: 'Greenwood High School', slug: 'greenwood', type: 'school', color: '#16A34A', plan: 'pro',
    address: 'Block 5, Gulshan-e-Iqbal, Karachi', phone: '+92 21 3480 1234', groupId,
    campuses: [{ code: 'MAIN', name: 'Main campus', address: 'Block 5, Gulshan-e-Iqbal, Karachi' }],
  });
  const campus = inst.campuses[0]!.id;
  const admin = await adminFor(inst, 'admin@greenwood.edu', 'Greenwood High School Administrator');
  const [science, languages] = await insertMany('departments', ['institution_id', 'campus_id', 'name', 'code'], [
    [inst.id, campus, 'Science', 'SCI'],
    [inst.id, campus, 'Languages', 'LANG'],
  ]);
  const staff = await addStaff(inst, 8, { campus_id: campus, designations: ['Senior Teacher', 'Teacher', 'Subject Coordinator'], qualifications: ['M.Sc', 'M.A', 'B.Ed', 'M.Phil'] });
  await q(`UPDATE departments SET head_teacher_id = $1 WHERE id = $2`, [staff[0]!.id, science!.id]);
  await q(`UPDATE departments SET head_teacher_id = $1 WHERE id = $2`, [staff[1]!.id, languages!.id]);
  await q(`UPDATE teachers SET department_id = $1 WHERE id = ANY($2::int[])`, [science!.id, staff.filter((_, i) => i % 2 === 0).map((t) => t.id)]);
  await q(`UPDATE teachers SET department_id = $1 WHERE id = ANY($2::int[])`, [languages!.id, staff.filter((_, i) => i % 2 === 1).map((t) => t.id)]);
  // non-teaching staff
  await insertMany('teachers', ['institution_id', 'first_name', 'last_name', 'email', 'phone', 'designation', 'staff_type', 'campus_id', 'employee_no'], [
    [inst.id, 'Rashid', 'Mehmood', 'accounts@greenwood.edu', '+923001212121', 'Accountant', 'non_teaching', campus, 'EMP-9001'],
    [inst.id, 'Samina', 'Akhtar', 'library@greenwood.edu', '+923001212122', 'Librarian', 'non_teaching', campus, 'EMP-9002'],
  ]);

  const defaults = INSTITUTION_DEFAULTS.school;
  const programs = await addPrograms(inst, defaults.programs);
  const level = (program: string, name: string) => programs[program]!.levels.find((l) => l.name === name)!.id;
  const C = await addCourses(inst, [
    { code: 'ENG', name: 'English', department_id: languages!.id },
    { code: 'MATH', name: 'Mathematics', department_id: science!.id },
    { code: 'SCI', name: 'General Science', department_id: science!.id },
    { code: 'SST', name: 'Social Studies' },
    { code: 'ISL', name: 'Islamiat' },
    { code: 'URDU', name: 'Urdu', department_id: languages!.id },
    { code: 'PHY', name: 'Physics', department_id: science!.id },
    { code: 'CHEM', name: 'Chemistry', department_id: science!.id },
    { code: 'BIO', name: 'Biology', department_id: science!.id },
    { code: 'CS', name: 'Computer Science', department_id: science!.id },
    { code: 'ART', name: 'Art & Craft' },
    { code: 'GK', name: 'General Knowledge' },
  ]);
  const early = [C.ENG!, C.MATH!, C.ART!, C.GK!];
  const primary = [C.ENG!, C.MATH!, C.SCI!, C.SST!, C.ISL!, C.URDU!];
  const secondary = [C.ENG!, C.MATH!, C.PHY!, C.CHEM!, C.BIO!, C.CS!, C.ISL!, C.URDU!];

  const y = y0(inst);
  await addHolidays(inst, [
    { name: 'Iqbal Day', from: `${y}-11-09`, to: `${y}-11-09` },
    { name: 'Mid-term examinations', from: `${y}-12-08`, to: `${y}-12-16`, kind: 'exam_period' },
    { name: 'Winter break', from: `${y}-12-22`, to: `${y}-12-31`, kind: 'break' },
    { name: 'Kashmir Day', from: `${y + 1}-02-05`, to: `${y + 1}-02-05` },
    { name: 'Pakistan Day', from: `${y + 1}-03-23`, to: `${y + 1}-03-23` },
  ]);

  const term = inst.terms[0]!;
  const sectionDefs: [string, string, string, string, string, number, Row[], [number, number]][] = [
    ['KG-A', 'Kindergarten', 'A', 'EY', 'Kindergarten', 5, early, [4, 5]],
    ['C1-A', 'Class 1', 'A', 'PRI', 'Class 1', 5, primary, [5, 6]],
    ['C2-A', 'Class 2', 'A', 'PRI', 'Class 2', 5, primary, [6, 7]],
    ['C5-A', 'Class 5', 'A', 'PRI', 'Class 5', 5, primary, [9, 10]],
    ['C9-A', 'Class 9', 'A', 'SEC', 'Class 9', 5, secondary, [13, 14]],
    ['C9-B', 'Class 9', 'B', 'SEC', 'Class 9', 4, secondary, [13, 14]],
    ['C10-A', 'Class 10', 'A', 'SEC', 'Class 10', 5, secondary, [14, 15]],
  ];
  const all: Row[] = [];
  const sections: Record<string, Row> = {};
  let start = 0;
  for (const [codeS, name, label, prog, lvl, n, courses, age] of sectionDefs) {
    const section = (sections[codeS] = await addSection(inst, { code: codeS, name, label, campus_id: campus, level_id: level(prog, lvl), students: n, age, homeroom: staff[start % staff.length]!.id, capacity: 35 }));
    const students = await addStudents(inst, section, n, age);
    const offerings = await offer(inst, section, courses, term, staff, { start });
    await addActivity(inst, section, students, offerings, { fee: [25000, 30000, 35000], assessments: [['Quiz', 'Quiz 1', 20], ['Midterm', 'Mid-term', 50]], timetable: true });
    all.push(...students);
    start += 2;
  }
  await addMedical(inst, all);

  // last session, archived: Class 9 students were promoted into Class 10; one student graduated
  const prevStart = String(y - 1);
  const [prev] = await q(
    `INSERT INTO academic_years (institution_id, name, starts_on, ends_on, status, is_current) VALUES ($1,$2,$3,$4,'archived',false) RETURNING id`,
    [inst.id, `${prevStart}–${String(Number(prevStart) + 1).slice(2)}`, `${prevStart}-08-01`, `${Number(prevStart) + 1}-07-31`]
  );
  await q(`INSERT INTO terms (institution_id, academic_year_id, name, kind, starts_on, ends_on, status) VALUES ($1,$2,'Annual','annual',$3,$4,'archived')`, [
    inst.id, prev!.id, `${prevStart}-08-01`, `${Number(prevStart) + 1}-07-31`,
  ]);
  const old9 = await addSection(inst, { code: `C9-A-${prevStart}`, name: 'Class 9', label: 'A', campus_id: campus, level_id: level('SEC', 'Class 9'), year_id: prev!.id, students: 0, age: [13, 14], status: 'archived' });
  const old10 = await addSection(inst, { code: `C10-A-${prevStart}`, name: 'Class 10', label: 'A', campus_id: campus, level_id: level('SEC', 'Class 10'), year_id: prev!.id, students: 0, age: [15, 16], status: 'archived' });
  const current10 = all.filter((st) => st.section_id === sections['C10-A']!.id);
  await insertMany('student_promotions', ['institution_id', 'student_id', 'from_section_id', 'to_section_id', 'action', 'created_by'],
    current10.map((st) => [inst.id, st.id, old9.id, sections['C10-A']!.id, 'promoted', admin.id]));
  const alumni = await addStudents(inst, null, 2, [16, 17], { status: 'graduated', left_on: `${Number(prevStart) + 1}-07-31` });
  await insertMany('student_promotions', ['institution_id', 'student_id', 'from_section_id', 'to_section_id', 'action', 'created_by'],
    alumni.map((s) => [inst.id, s.id, old10.id, null, 'graduated', admin.id]));

  // custom fields
  await insertMany('custom_fields', ['institution_id', 'entity', 'key', 'label', 'field_type', 'options', 'required', 'sort'], [
    [inst.id, 'student', 'house', 'House', 'select', JSON.stringify(['Jinnah', 'Iqbal', 'Liaquat', 'Sir Syed']), false, 1],
    [inst.id, 'student', 'transport_route', 'Transport route', 'text', '[]', false, 2],
    [inst.id, 'staff', 'subject_specialism', 'Subject specialism', 'text', '[]', false, 1],
  ]);
  const houses = ['Jinnah', 'Iqbal', 'Liaquat', 'Sir Syed'];
  await q(
    `UPDATE students s SET custom_data = jsonb_build_object('house', (ARRAY['${houses.join("','")}'])[1 + (s.id % 4)], 'transport_route', CASE WHEN s.id % 3 = 0 THEN 'Route 3 — Gulshan' ELSE '' END)
      WHERE s.institution_id = $1`,
    [inst.id]
  );

  // a parent with a portal account for the first two students; a second guardian who may not see fees
  const [first, second] = all;
  const [parent] = await makeUsers([{ institution_id: inst.id, role: 'parent', email: 'parent1@greenwood.edu', full_name: `Imran ${first!.last_name}` }]);
  await grantPrimaryRoles([parent!]);
  const [g] = await insertMany('guardians', ['institution_id', 'user_id', 'first_name', 'last_name', 'email', 'phone', 'occupation'], [
    [inst.id, parent!.id, 'Imran', first!.last_name, 'parent1@greenwood.edu', '+923009998877', 'Engineer'],
  ]);
  await q(`DELETE FROM guardianships WHERE student_id = ANY($1::int[]) AND relationship = 'father'`, [[first!.id, second!.id]]);
  await insertMany('guardianships', ['institution_id', 'guardian_id', 'student_id', 'relationship', 'is_primary', 'is_emergency_contact'], [
    [inst.id, g!.id, first!.id, 'father', true, true],
    [inst.id, g!.id, second!.id, 'father', true, true],
  ]);
  await q(`UPDATE guardianships SET can_view_fees = false WHERE student_id = $1 AND relationship = 'mother'`, [first!.id]);
  await notify(inst, [parent!], 'fee', 'Fee reminder', 'A tuition fee instalment is due for your child this week.');
  await notify(inst, [parent!], 'grade', 'New result published', 'Mid-term results are now available.');

  // ---- Fees and admissions demo: discounts, an open admission form with applicants and enquiries, a
  // mid-term date sheet, and learning outcomes for Class 9 mathematics
  await insertMany('discounts', ['institution_id', 'name', 'kind', 'method', 'value', 'heads', 'sibling_from'], [
    [inst.id, 'Sibling discount', 'sibling', 'percent', 10, ['Tuition'], 2],
    [inst.id, 'Merit scholarship', 'scholarship', 'percent', 25, ['Tuition'], null],
  ]);
  const [merit] = await q(`SELECT id FROM discounts WHERE institution_id = $1 AND kind = 'scholarship'`, [inst.id]);
  await q(`INSERT INTO student_discounts (institution_id, student_id, discount_id, reason, approved_by) VALUES ($1,$2,$3,'Top of class last year',$4)`, [inst.id, all[2]!.id, merit!.id, admin.id]);

  const [bank] = await q(`INSERT INTO question_banks (institution_id, name, created_by) VALUES ($1, 'Entrance test — Class 1', $2) RETURNING id`, [inst.id, admin.id]);
  await insertMany('questions', ['institution_id', 'bank_id', 'type', 'prompt_html', 'data', 'points', 'created_by'], [2, 3, 4, 5, 6].map((n) => [
    inst.id, bank!.id, 'numeric', `<p>What is ${n} + ${n}?</p>`, JSON.stringify({ answer: n * 2, tolerance: 0 }), 1, admin.id,
  ]));
  const [form] = await q(
    `INSERT INTO admission_forms (institution_id, slug, title, description, program_id, program_level_id, fields, documents, application_fee, entrance_test, seats, status, created_by)
     VALUES ($1, 'class-one-2027', 'Class 1 admissions 2027', 'Admissions for Class 1 are open. Apply online, upload the B-form and take a short entrance test.', $2, $3, $4, $5, 1500, $6, 30, 'open', $7) RETURNING id`,
    [
      inst.id, programs.PRI!.id, level('PRI', 'Class 1'),
      JSON.stringify([{ key: 'religion', label: 'Religion', type: 'select', options: ['Islam', 'Christianity', 'Hinduism', 'Other'], required: true }, { key: 'siblings', label: 'Siblings at Greenwood', type: 'text', required: false }]),
      JSON.stringify([{ key: 'b_form', label: 'B-form / birth certificate', required: true }, { key: 'photo', label: 'Photograph', required: false }]),
      JSON.stringify({ bank_id: bank!.id, count: 5, minutes: 20 }),
      admin.id,
    ]
  );
  const applicants = [
    ['Hania', 'Rauf', 'submitted', null],
    ['Daniyal', 'Khan', 'tested', 4],
    ['Mahnoor', 'Iqbal', 'offered', 5],
  ] as const;
  for (const [i, [fn, ln, st, score]] of applicants.entries()) {
    await q(
      `INSERT INTO applications (institution_id, form_id, number, token_hash, first_name, last_name, email, phone, guardian_name, guardian_phone, guardian_email, guardian_relationship, data, status, test_score, test_max, merit_rank, offer_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'father',$12,$13,$14,$15,$16,$17)`,
      [
        inst.id, form!.id, `APP-${TODAY.slice(0, 4)}-${String(i + 1).padStart(5, '0')}`, crypto.createHash('sha256').update(crypto.randomBytes(24)).digest('hex'),
        fn, ln, `${fn.toLowerCase()}.${ln.toLowerCase()}@family.example`, `+92300555000${i}`, `Mr ${ln}`, `+92300555100${i}`, `${ln.toLowerCase()}.parent@family.example`,
        JSON.stringify({ religion: 'Islam' }), st, score, score == null ? null : 5, st === 'offered' ? 1 : null, st === 'offered' ? `${dateAdd(TODAY, 14)}T23:59:00Z` : null,
      ]
    );
  }
  const enquiries = await insertMany(
    'enquiries',
    ['institution_id', 'name', 'phone', 'student_name', 'source', 'status', 'next_follow_up_at', 'notes', 'created_by'],
    [
      [inst.id, 'Bushra Naveed', '+923211234501', 'Ayaan', 'website', 'new', `${dateAdd(TODAY, 1)}T10:00:00Z`, 'Asked about transport', admin.id],
      [inst.id, 'Kamran Ali', '+923211234502', 'Zoya', 'walk_in', 'visited', `${dateAdd(TODAY, -1)}T10:00:00Z`, 'Visited with family; liked the science lab', admin.id],
      [inst.id, 'Sadia Farooq', '+923211234503', 'Hamza', 'referral', 'contacted', `${dateAdd(TODAY, 3)}T10:00:00Z`, '', admin.id],
      [inst.id, 'Tariq Mehmood', '+923211234504', 'Eman', 'social', 'lost', null, 'Chose a school closer to home', admin.id],
    ]
  );
  await insertMany('enquiry_followups', ['institution_id', 'enquiry_id', 'channel', 'note', 'user_id'], [
    [inst.id, enquiries[1]!.id, 'phone', 'Called to book a visit', admin.id],
    [inst.id, enquiries[1]!.id, 'visit', 'School tour done', admin.id],
    [inst.id, enquiries[2]!.id, 'whatsapp', 'Sent the admission form link', admin.id],
  ]);

  const [series] = await q(
    `INSERT INTO exam_series (institution_id, term_id, name, kind, result_style, status, instructions, created_by) VALUES ($1,$2,'Mid-term examinations','midterm','board','scheduled','Bring your admit card, pens and a geometry box. Mobile phones are not allowed.',$3) RETURNING id`,
    [inst.id, term.id, admin.id]
  );
  const c9 = await q(`SELECT o.id FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.section_id = $1 ORDER BY c.code`, [sections['C9-A']!.id]);
  await insertMany('exam_sessions', ['institution_id', 'series_id', 'offering_id', 'date', 'starts_at', 'ends_at', 'total_marks', 'pass_marks'], c9.map((o, i) => [
    inst.id, series!.id, o.id, nextSchoolDay(inst, dateAdd(`${y}-12-08` < TODAY ? dateAdd(TODAY, 14) : `${y}-12-08`, i)), '09:00', '12:00', 75, 25,
  ]));

  const sec = programs.SEC!.id;
  const plos = await insertMany('learning_outcomes', ['institution_id', 'level', 'program_id', 'code', 'description', 'position'], [
    [inst.id, 'program', sec, 'PLO1', 'Solve problems using mathematical and scientific reasoning', 0],
    [inst.id, 'program', sec, 'PLO2', 'Communicate ideas clearly in writing', 1],
  ]);
  const clos = await insertMany('learning_outcomes', ['institution_id', 'level', 'course_id', 'code', 'description', 'bloom_level', 'position'], [
    [inst.id, 'course', C.MATH!.id, 'CLO1', 'Apply algebraic methods to solve equations', 'apply', 0],
    [inst.id, 'course', C.MATH!.id, 'CLO2', 'Explain the steps of a geometric proof', 'understand', 1],
  ]);
  await insertMany('outcome_mappings', ['institution_id', 'clo_id', 'plo_id', 'strength'], [
    [inst.id, clos[0]!.id, plos[0]!.id, 3],
    [inst.id, clos[1]!.id, plos[0]!.id, 1],
    [inst.id, clos[1]!.id, plos[1]!.id, 2],
  ]);
  const mathWork = await q(
    `SELECT a.id, a.kind FROM assessments a JOIN course_offerings o ON o.id = a.offering_id WHERE o.section_id = $1 AND o.course_id = $2 AND a.kind IN ('quiz', 'exam') ORDER BY a.id`,
    [sections['C9-A']!.id, C.MATH!.id]
  );
  if (mathWork.length) {
    await insertMany('outcome_alignments', ['institution_id', 'clo_id', 'target_type', 'target_id'], mathWork.flatMap((a) => [[inst.id, clos[a.kind === 'exam' ? 0 : 1]!.id, 'assessment', a.id]]));
  }

  // ID cards for Class 10
  const validUntil = String(inst.year.ends_on);
  await insertMany('id_cards', ['institution_id', 'holder_type', 'holder_id', 'verify_code', 'valid_until', 'issued_by'],
    current10.map((s) => [inst.id, 'student', s.id, code(12), validUntil, admin.id]));

  await announce(inst, [
    ['Mid-term examination schedule', 'All', 'The mid-term examinations run from 8 to 16 December. The date sheet is on the notice board and in the app.'],
    ['Parent-teacher meeting', 'All', 'Parent-teacher meetings are this Saturday from 9:00 to 12:00 in the main hall.'],
    ['Staff development workshop', 'Teachers', 'A workshop on formative assessment will be held on Friday after school.'],
    ['Annual sports day', 'Students', 'Sports day is next month. Sign up for events with your class teacher.'],
  ]);
  await notify(inst, [admin], 'info', 'New admissions', 'Several new students were admitted this week.');
  return inst;
}

async function seedSunrise(groupId: number) {
  const inst = await createInstitution({
    name: 'Sunrise Schools', slug: 'sunrise', type: 'chain', color: '#EA580C', plan: 'enterprise',
    address: 'Head office: Shahrah-e-Faisal, Karachi', phone: '+92 21 3456 7890', groupId,
    campuses: [
      { code: 'GUL', name: 'Gulshan branch', address: 'Block 13-D, Gulshan-e-Iqbal, Karachi' },
      { code: 'DHA', name: 'DHA branch', address: 'Phase 6, DHA, Karachi' },
      { code: 'CLF', name: 'Clifton branch', address: 'Block 4, Clifton, Karachi' },
    ],
  });
  await adminFor(inst, 'admin@sunrise.edu', 'Sunrise Schools Administrator');
  const programs = await addPrograms(inst, [
    { code: 'PRI', name: 'Primary', levels: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'] },
    { code: 'SEC', name: 'Secondary', levels: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'] },
  ]);
  const level = (program: string, name: string) => programs[program]!.levels.find((l) => l.name === name)!.id;
  const C = await addCourses(inst, [
    { code: 'ENG', name: 'English' }, { code: 'MATH', name: 'Mathematics' }, { code: 'SCI', name: 'Science' },
    { code: 'URDU', name: 'Urdu' }, { code: 'ISL', name: 'Islamiat' }, { code: 'PHY', name: 'Physics' }, { code: 'CS', name: 'Computer Science' },
  ]);
  const primary = [C.ENG!, C.MATH!, C.SCI!, C.URDU!, C.ISL!];
  const secondary = [C.ENG!, C.MATH!, C.PHY!, C.CS!, C.URDU!];
  await addHolidays(inst, [
    { name: 'Iqbal Day', from: `${y0(inst)}-11-09`, to: `${y0(inst)}-11-09` },
    { name: 'Winter break', from: `${y0(inst)}-12-22`, to: `${y0(inst)}-12-31`, kind: 'break' },
  ]);
  // the network's own role: a branch principal sees and runs one branch
  const [principalRole] = await q(
    `INSERT INTO roles (institution_id, key, name, description, scope_type) VALUES ($1,'branch_principal','Branch principal','Runs one branch: students, staff, classes, fees','institution') RETURNING id`,
    [inst.id]
  );
  await q(`INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`, [
    principalRole!.id,
    ['institution.dashboard.read', 'students.read', 'students.manage', 'staff.read', 'sections.read', 'fees.read', 'fees.manage', 'academics.read',
      'announcements.read', 'announcements.manage', 'structure.read', 'guardians.read', 'records.read_any'],
  ]);
  const term = inst.terms[0]!;
  const sizes: Record<string, number> = { GUL: 5, DHA: 4, CLF: 4 };
  for (const [ci, campus] of inst.campuses.entries()) {
    const staff = await addStaff(inst, 3, { campus_id: campus.id, designations: ['Teacher', 'Senior Teacher'], qualifications: ['B.Ed', 'M.A', 'M.Sc'] });
    const [principal] = await makeUsers([{ institution_id: inst.id, role: 'institution_admin', email: `principal.${campus.code.toLowerCase()}@sunrise.edu`, full_name: `${pick(FATHERS)} ${pick(LAST)} (Principal, ${campus.name})` }]);
    await q(`INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, institution_id) VALUES ($1,$2,'campus',$3,$4)`, [principal!.id, principalRole!.id, campus.id, inst.id]);
    const defs: [string, string, string, number][] = [
      [`${campus.code}-C1`, 'Class 1', 'PRI', ci],
      [`${campus.code}-C5`, 'Class 5', 'PRI', ci + 1],
      [`${campus.code}-C8`, 'Class 8', 'SEC', ci + 2],
      [`${campus.code}-C10`, 'Class 10', 'SEC', ci],
    ];
    for (const [codeS, name, prog, start] of defs) {
      const section = await addSection(inst, { code: codeS, name, label: 'A', campus_id: campus.id, level_id: level(prog, name), students: sizes[campus.code]!, age: [6, 15], homeroom: staff[start % staff.length]!.id, capacity: 30 });
      const age: [number, number] = name === 'Class 1' ? [5, 6] : name === 'Class 5' ? [9, 10] : name === 'Class 8' ? [12, 13] : [14, 15];
      const students = await addStudents(inst, section, sizes[campus.code]!, age);
      const offerings = await offer(inst, section, prog === 'PRI' ? primary : secondary, term, staff, { start });
      await addActivity(inst, section, students, offerings, { fee: campus.code === 'DHA' ? [45000, 50000] : [28000, 32000], assessments: [['Test', 'Monthly test', 25]], timetable: true });
    }
  }
  await announce(inst, [
    ['Inter-branch science fair', 'All', 'The inter-branch science fair is at the Clifton branch on the last Saturday of the month.'],
    ['Branch principals meeting', 'Teachers', 'Monthly principals meeting at the head office on Monday at 10:00.'],
  ]);
  return inst;
}

async function seedNorthfield() {
  const inst = await createInstitution({
    name: 'Northfield University', slug: 'northfield', type: 'university', color: '#1D4ED8', plan: 'enterprise',
    address: 'Sector H-12, Islamabad', phone: '+92 51 9087 6543',
    campuses: [{ code: 'H12', name: 'H-12 campus', address: 'Sector H-12, Islamabad' }],
    extraGrading: ['pass_fail'],
  });
  const campus = inst.campuses[0]!.id;
  const admin = await adminFor(inst, 'registrar@northfield.edu', 'Office of the Registrar');
  const depts = await insertMany('departments', ['institution_id', 'campus_id', 'name', 'code'], [
    [inst.id, campus, 'Department of Computer Science', 'CS'],
    [inst.id, campus, 'Department of Management Sciences', 'MS'],
    [inst.id, campus, 'Department of Mathematics', 'MTH'],
  ], 'id, code');
  const dept = (c: string) => depts.find((d) => d.code === c)!.id;
  const cs = await addStaff(inst, 4, { campus_id: campus, department_id: dept('CS'), designations: ['Assistant Professor', 'Lecturer', 'Associate Professor'], qualifications: ['PhD Computer Science', 'MS Computer Science'] });
  const ms = await addStaff(inst, 2, { campus_id: campus, department_id: dept('MS'), designations: ['Assistant Professor', 'Lecturer'], qualifications: ['PhD Management', 'MBA'] });
  const mth = await addStaff(inst, 2, { campus_id: campus, department_id: dept('MTH'), designations: ['Lecturer'], qualifications: ['MPhil Mathematics'] });
  await q(`UPDATE departments SET head_teacher_id = $1 WHERE id = $2`, [cs[2]!.id, dept('CS')]);
  const semesters = Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`);
  const programs = await addPrograms(inst, [
    { code: 'BSCS', name: 'BS Computer Science', levels: semesters, department_id: dept('CS'), credits: 133 },
    { code: 'BBA', name: 'Bachelor of Business Administration', levels: semesters, department_id: dept('MS'), credits: 130 },
  ]);
  const C = await addCourses(inst, [
    { code: 'CS101', name: 'Programming Fundamentals', credits: 4, department_id: dept('CS') },
    { code: 'CS102', name: 'Discrete Structures', credits: 3, department_id: dept('CS') },
    { code: 'CS201', name: 'Data Structures and Algorithms', credits: 4, department_id: dept('CS') },
    { code: 'CS202', name: 'Database Systems', credits: 4, department_id: dept('CS') },
    { code: 'MTH101', name: 'Calculus and Analytical Geometry', credits: 3, department_id: dept('MTH') },
    { code: 'MTH201', name: 'Linear Algebra', credits: 3, department_id: dept('MTH') },
    { code: 'ENG101', name: 'Functional English', credits: 3 },
    { code: 'BUS101', name: 'Principles of Management', credits: 3, department_id: dept('MS') },
    { code: 'ACC101', name: 'Financial Accounting', credits: 3, department_id: dept('MS') },
    { code: 'ECO101', name: 'Microeconomics', credits: 3, department_id: dept('MS') },
  ]);
  const y = y0(inst);
  await addHolidays(inst, [
    { name: 'Iqbal Day', from: `${y}-11-09`, to: `${y}-11-09` },
    { name: 'Winter break', from: `${y}-12-24`, to: `${y + 1}-01-02`, kind: 'break' },
    { name: 'Fall final examinations', from: `${y + 1}-01-04`, to: `${y + 1}-01-15`, kind: 'exam_period' },
  ]);
  const fall = inst.terms.find((t) => t.status === 'active') ?? inst.terms[0]!;
  const lvl = (p: string, n: number) => programs[p]!.levels[n - 1]!.id;
  const batches: [string, string, string, number, Row[], Row[]][] = [
    ['BSCS-2026', 'BSCS batch 2026', 'BSCS', 1, [C.CS101!, C.MTH101!, C.ENG101!], [...cs, ...mth]],
    ['BSCS-2025', 'BSCS batch 2025', 'BSCS', 3, [C.CS201!, C.CS202!, C.MTH201!], [...cs, ...mth].reverse()],
    ['BBA-2026', 'BBA batch 2026', 'BBA', 1, [C.BUS101!, C.ACC101!, C.ECO101!, C.ENG101!], [...ms, ...mth]],
  ];
  for (const [codeS, name, prog, sem, courses, teachers] of batches) {
    const section = await addSection(inst, { code: codeS, name, label: '', campus_id: campus, level_id: lvl(prog, sem), students: 8, age: [18, 22] });
    const students = await addStudents(inst, section, 8, sem === 1 ? [18, 19] : [19, 21]);
    // each batch's courses are open course sections with a capacity; students enrol individually
    const offerings = await offer(inst, section, courses, fall, teachers, { mode: 'open', capacity: 40 });
    // Database Systems is popular: a small lab, so two students wait for a seat
    const lab = offerings.find((o) => o.course_id === C.CS202!.id);
    if (lab) await q(`UPDATE course_offerings SET capacity = 6 WHERE id = $1`, [lab.id]);
    const enrol: unknown[][] = [];
    for (const o of offerings) {
      const cap = codeS === 'BSCS-2025' && C.CS202!.id === o.course_id ? 6 : 40;
      students.forEach((st, k) => enrol.push([inst.id, o.id, st.id, k < cap ? 'active' : 'waitlisted', k < cap ? null : k - cap + 1]));
    }
    await insertMany('enrollments', ['institution_id', 'offering_id', 'student_id', 'status', 'waitlist_position'], enrol);
    await addActivity(inst, section, students, offerings, { fee: [145000, 160000], assessments: [['Quiz', 'Quiz 1', 10], ['Midterm', 'Midterm exam', 30], ['Assignment', 'Assignment 1', 10]], attendanceDays: 8 });
  }
  await insertMany('custom_fields', ['institution_id', 'entity', 'key', 'label', 'field_type', 'options', 'required', 'sort'], [
    [inst.id, 'student', 'residence', 'Residence', 'select', JSON.stringify(['Day scholar', 'Boys hostel', 'Girls hostel']), true, 1],
    [inst.id, 'student', 'scholarship', 'Merit scholarship', 'checkbox', '[]', false, 2],
  ]);
  await q(`UPDATE students SET custom_data = jsonb_build_object('residence', CASE WHEN id % 3 = 0 THEN 'Boys hostel' WHEN id % 3 = 1 THEN 'Day scholar' ELSE 'Girls hostel' END, 'scholarship', id % 4 = 0) WHERE institution_id = $1`, [inst.id]);
  await announce(inst, [
    ['Course registration closes Friday', 'Students', 'Add / drop for the Fall semester closes this Friday. Full sections have a waitlist.'],
    ['Faculty board meeting', 'Teachers', 'The faculty board meets on Wednesday at 14:00 in the senate hall.'],
  ]);
  await notify(inst, [admin], 'info', 'Waitlist', 'Database Systems (BSCS-2025) is full; 2 students are waitlisted.');
  return inst;
}

async function seedSkillforge() {
  const inst = await createInstitution({
    name: 'Skillforge Academy', slug: 'skillforge', type: 'training_center', color: '#7C3AED', plan: 'pro',
    address: 'Arfa Software Technology Park, Lahore', phone: '+92 42 3577 1100',
    campuses: [{ code: 'ARFA', name: 'Arfa Tower', address: 'Arfa Software Technology Park, Lahore' }],
    extraGrading: ['pass_fail'],
  });
  const campus = inst.campuses[0]!.id;
  await adminFor(inst, 'admin@skillforge.edu', 'Skillforge Academy Operations');
  const trainers = await addStaff(inst, 3, { campus_id: campus, designations: ['Lead Trainer', 'Trainer'], qualifications: ['BS Software Engineering', 'MBA Marketing', 'BS Computer Science'] });
  const programs = await addPrograms(inst, [
    { code: 'FSWD', name: 'Full-Stack Web Development', levels: ['Foundations', 'Frontend', 'Backend', 'Capstone'] },
    { code: 'DM', name: 'Digital Marketing', levels: ['Foundations', 'Advanced'], grading: 'pass_fail' },
  ]);
  const C = await addCourses(inst, [
    { code: 'WEB101', name: 'HTML & CSS' }, { code: 'WEB102', name: 'JavaScript Essentials' }, { code: 'WEB201', name: 'React' },
    { code: 'WEB202', name: 'Node.js & APIs' }, { code: 'WEB301', name: 'Databases' }, { code: 'DM101', name: 'SEO Fundamentals' },
    { code: 'DM102', name: 'Social Media Marketing' },
  ]);
  await addHolidays(inst, [{ name: 'Demo day', from: dateAdd(TODAY, 21), to: dateAdd(TODAY, 21), kind: 'event' }]);
  const intake = inst.terms[0]!;
  const cohorts: [string, string, string, string, Row[]][] = [
    ['FSWD-C7', 'FSWD Cohort 7', 'FSWD', 'Frontend', [C.WEB102!, C.WEB201!]],
    ['FSWD-C8', 'FSWD Cohort 8', 'FSWD', 'Foundations', [C.WEB101!, C.WEB102!]],
    ['DM-C3', 'Digital Marketing Cohort 3', 'DM', 'Foundations', [C.DM101!, C.DM102!]],
  ];
  for (const [i, [codeS, name, prog, lvlName, courses]] of cohorts.entries()) {
    const level = programs[prog]!.levels.find((l) => l.name === lvlName)!.id;
    const section = await addSection(inst, { code: codeS, name, label: '', campus_id: campus, level_id: level, students: 6, age: [19, 30], homeroom: trainers[i % trainers.length]!.id, capacity: 25 });
    const students = await addStudents(inst, section, 6, [19, 30]);
    const offerings = await offer(inst, section, courses, intake, trainers, { start: i });
    await addActivity(inst, section, students, offerings, { fee: [60000, 75000], assessments: [['Project', 'Project review', 100]], attendanceDays: 6 });
  }
  await announce(inst, [['Demo day in three weeks', 'All', 'Cohort 7 presents capstone previews to hiring partners. Prepare a 5-minute walkthrough.']]);
  return inst;
}

// ---------------------------------------------------------------- run

async function guard() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data when NODE_ENV=production');
  const reset = process.argv.includes('--reset');
  const [row] = await q(`SELECT (SELECT count(*) FROM institutions) + (SELECT count(*) FROM users) AS n`);
  if (Number(row!.n) > 0 && !reset) throw new Error('Database already has data. Run "npm run db:reset" to wipe it and reseed.');
  if (reset) {
    // every tenant table references institutions or users; CASCADE empties them all
    await q('TRUNCATE institutions, institution_groups, users, email_outbox CASCADE');
    await syncRbacCatalogue(db); // the built-in roles went with the cascade
  }
}

async function seedAll() {
  await q(`SELECT set_config('app.audit', 'off', true)`); // demo data is not anyone's change
  await guard();
  hash = await bcrypt.hash(PW, 10);

  const [platform] = await makeUsers([{ institution_id: null, role: 'super_admin', email: 'superadmin@acadex.com', full_name: 'Acadex Super Admin' }]);
  await grantPrimaryRoles([platform!]);
  const [group] = await q(`INSERT INTO institution_groups (name, slug) VALUES ('Crescent Education Group', 'crescent') RETURNING id`);

  const greenwood = await seedGreenwood(group!.id);
  const sunrise = await seedSunrise(group!.id);
  const northfield = await seedNorthfield();
  const skillforge = await seedSkillforge();

  const [groupAdmin] = await makeUsers([{ institution_id: null, role: 'group_admin', email: 'group@acadex.com', full_name: 'Crescent Group Director' }]);
  await grantPrimaryRoles([{ ...groupAdmin!, scope: group!.id }]);

  const counts = await q(
    `SELECT i.slug, (SELECT count(*)::int FROM students s WHERE s.institution_id = i.id) students,
            (SELECT count(*)::int FROM teachers t WHERE t.institution_id = i.id) staff,
            (SELECT count(*)::int FROM sections s WHERE s.institution_id = i.id) sections
       FROM institutions i ORDER BY i.id`
  );
  for (const c of counts) console.log(`  ${c.slug.padEnd(11)} ${c.students} students, ${c.staff} staff, ${c.sections} sections`);
  void [greenwood, sunrise, northfield, skillforge];
  await seedReach();
  await seedModules();
  // early-warning scores for today, so Student success has something to show
  const { computeRisk } = await import('../ai/risk');
  for (const i of await q(`SELECT id, timezone FROM institutions`)) await computeRisk(i.id, todayIn(i.timezone));
  console.log(`SEED DONE. Password for all demo users: ${PW}`);
}

/** Communication demo at Greenwood: a parent–teacher meeting day (one booking), help-desk tickets and a conversation. */
async function seedReach() {
  const [g] = await q(`SELECT id, timezone FROM institutions WHERE slug = 'greenwood'`);
  const [teacher] = await q(`SELECT id, ref_id, full_name FROM users WHERE email = 'ali.sheikh.t0@greenwood.edu'`);
  const [parent] = await q(`SELECT id FROM users WHERE email = 'parent1@greenwood.edu'`);
  const [admin] = await q(`SELECT id FROM users WHERE email = 'admin@greenwood.edu'`);
  const [student] = await q(
    `SELECT st.id, st.section_id, u.id AS user_id FROM guardians gd JOIN guardianships gs ON gs.guardian_id = gd.id JOIN students st ON st.id = gs.student_id
       JOIN users u ON u.ref_id = st.id AND u.role = 'student' WHERE gd.user_id = $1 ORDER BY st.id LIMIT 1`,
    [parent!.id]
  );
  if (!g || !teacher || !parent || !student) return;
  // the meeting day covers the child's class; slots for every teacher of it
  const sections = [student.section_id];
  const teachers = await q(
    `SELECT DISTINCT u.id FROM section_staff ss JOIN users u ON u.ref_id = ss.teacher_id AND u.role = 'teacher' WHERE ss.section_id = ANY($1::int[])`,
    [sections]
  );
  const [ev] = await q(
    `INSERT INTO ptm_events (institution_id, title, date, start_time, end_time, slot_minutes, mode, location, section_ids, created_by)
     VALUES ($1,'Term 1 parent–teacher meetings', CURRENT_DATE + 10, '09:00', '12:00', 10, 'in_person', 'Main hall', $2, $3) RETURNING id`,
    [g.id, sections, admin!.id]
  );
  await q(
    `INSERT INTO ptm_slots (institution_id, event_id, teacher_user_id, starts_at, ends_at)
     SELECT $1, $2, t.uid, gs, gs + interval '10 minutes' FROM unnest($3::int[]) AS t(uid),
            generate_series(((CURRENT_DATE + 10) + time '09:00') AT TIME ZONE $4, ((CURRENT_DATE + 10) + time '11:50') AT TIME ZONE $4, interval '10 minutes') AS gs`,
    [g.id, ev!.id, teachers.map((t) => t.id), g.timezone]
  );
  await q(
    `UPDATE ptm_slots SET status = 'booked', booked_by = $2, student_id = $3, note = 'Maths progress', booked_at = now()
      WHERE id = (SELECT id FROM ptm_slots WHERE event_id = $1 AND teacher_user_id = $4 ORDER BY starts_at OFFSET 2 LIMIT 1)`,
    [ev!.id, parent!.id, student.id, teacher.id]
  );
  // tickets
  await q(
    `INSERT INTO tickets (institution_id, raised_by, student_id, category, subject, body, status, priority, assigned_to, due_at)
     VALUES ($1,$2,$3,'fees','Sibling discount not applied','The sibling discount is missing on this month''s voucher.','in_progress','normal',$4, now() + interval '3 days'),
            ($1,$5,NULL,'facilities','Water cooler on the first floor','The water cooler near Class 9 has not worked since Monday.','open','high',NULL, now() + interval '1 day')`,
    [g.id, parent!.id, student.id, admin!.id, student.user_id]
  );
  await q(`UPDATE tickets SET anonymous = true WHERE institution_id = $1 AND category = 'facilities'`, [g.id]);
  // a conversation between the teacher and the parent
  const [c] = await q(`INSERT INTO conversations (institution_id, kind, created_by, last_message_at) VALUES ($1,'direct',$2, now()) RETURNING id`, [g.id, teacher.id]);
  await q(`INSERT INTO conversation_members (conversation_id, user_id, institution_id) VALUES ($1,$2,$3),($1,$4,$3)`, [c!.id, teacher.id, g.id, parent!.id]);
  await q(
    `INSERT INTO messages (institution_id, conversation_id, sender_id, body, created_at) VALUES
       ($1,$2,$3,'Assalam o Alaikum — your child did very well in this week''s algebra quiz. Please encourage the daily practice sheets.', now() - interval '1 day'),
       ($1,$2,$4,'Thank you! We will keep at it. Is there extra material for fractions?', now() - interval '20 hours')`,
    [g.id, c!.id, teacher.id, parent!.id]
  );
}

/** Platform and modules demo at Greenwood (Pro plan): library, HR & payroll and transport switched on with a little data. */
async function seedModules() {
  const [g] = await q(`SELECT id FROM institutions WHERE slug = 'greenwood'`);
  if (!g) return;
  await q(`UPDATE institutions SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{modules}', '{"library": true, "hr": true, "transport": true, "visitors": true}'::jsonb) WHERE id = $1`, [g.id]);
  const books: [string, string, string][] = [
    ['Things Fall Apart', 'Chinua Achebe', 'Fiction'],
    ['A Brief History of Time', 'Stephen Hawking', 'Science'],
    ['Oxford Mathematics for Class 9', 'Oxford University Press', 'Textbook'],
    ['The Alchemist', 'Paulo Coelho', 'Fiction'],
    ['Pakistan Studies', 'Ikram Rabbani', 'Textbook'],
  ];
  for (const [i, [title, authors, category]] of books.entries()) {
    const [b] = await q(`INSERT INTO library_books (institution_id, title, authors, category, shelf) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [g.id, title, authors, category, `S-${i + 1}`]);
    await q(`INSERT INTO library_copies (institution_id, book_id, barcode) VALUES ($1,$2,$3),($1,$2,$4)`, [g.id, b!.id, `GW-${1001 + i * 2}`, `GW-${1002 + i * 2}`]);
  }
  const [student] = await q(`SELECT id FROM users WHERE email = 'ali.butt.s0@greenwood.edu'`);
  const [copy] = await q(`SELECT id FROM library_copies WHERE institution_id = $1 AND barcode = 'GW-1001'`, [g.id]);
  if (student && copy) {
    await q(`INSERT INTO library_loans (institution_id, copy_id, borrower_id, due_on) VALUES ($1,$2,$3, CURRENT_DATE + 10)`, [g.id, copy.id, student.id]);
    await q(`UPDATE library_copies SET status = 'issued' WHERE id = $1`, [copy.id]);
  }
  const [st] = await q(
    `INSERT INTO salary_structures (institution_id, name, components) VALUES ($1, 'Teaching staff', $2) RETURNING id`,
    [g.id, JSON.stringify([{ name: 'House rent', kind: 'earning', calc: 'percent_of_basic', value: 45 }, { name: 'Medical', kind: 'earning', calc: 'fixed', value: 3000 }, { name: 'Provident fund', kind: 'deduction', calc: 'percent_of_basic', value: 5 }])]
  );
  await q(
    `INSERT INTO staff_salaries (institution_id, teacher_id, structure_id, basic, effective_from)
     SELECT $1, t.id, $2, 60000 + (row_number() OVER (ORDER BY t.id) % 5) * 5000, date_trunc('year', CURRENT_DATE)::date FROM teachers t WHERE t.institution_id = $1`,
    [g.id, st!.id]
  );
  const [v] = await q(`INSERT INTO vehicles (institution_id, registration, capacity, driver_name, driver_phone) VALUES ($1, 'LEB-4521', 30, 'Rashid Mehmood', '+923001234500') RETURNING id`, [g.id]);
  const [r] = await q(
    `INSERT INTO transport_routes (institution_id, name, vehicle_id, fee, stops) VALUES ($1, 'Route 1 — Model Town', $2, 4500, $3) RETURNING id`,
    [g.id, v!.id, JSON.stringify([{ name: 'Model Town Park', time: '07:05' }, { name: 'Faisal Town', time: '07:20' }, { name: 'School gate', time: '07:40' }])]
  );
  await q(
    `INSERT INTO transport_assignments (institution_id, student_id, route_id, stop, from_date)
     SELECT $1, s.id, $2, 'Model Town Park', date_trunc('year', CURRENT_DATE)::date FROM students s WHERE s.institution_id = $1 ORDER BY s.id LIMIT 8`,
    [g.id, r!.id]
  );
}

(async () => {
  try {
    await runAsSystem(seedAll);
    await pool.end();
  } catch (e) {
    console.error('❌ Seed failed:', (e as Error).message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
