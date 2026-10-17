// The configurable academic engine: institution types and their defaults, terminology packs,
// grading schemes (with the maths), and term systems. Used by the API (onboarding, seed,
// report cards) and the web app (labels, previews).
import { z } from 'zod';
import { feeSettingsBody } from './schemas/finance';
import { aiSettingsBody } from './schemas/ai';
import { messagingSettingsBody } from './schemas/reach';

export const INSTITUTION_TYPES = ['school', 'chain', 'college', 'university', 'academy', 'training_center'] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const TERM_KINDS = ['annual', 'semester', 'trimester', 'quarter', 'rolling', 'custom'] as const;
export type TermKind = (typeof TERM_KINDS)[number];

export const GRADING_KINDS = ['percentage', 'letter', 'gpa', 'pass_fail', 'competency', 'custom'] as const;
export type GradingKind = (typeof GRADING_KINDS)[number];

export const STUDENT_STATUSES = ['active', 'inactive', 'graduated', 'left'] as const;
export const GUARDIAN_RELATIONSHIPS = ['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'] as const;
export const SECTION_STAFF_ROLES = ['teacher', 'co_teacher', 'ta'] as const;
export const HOLIDAY_KINDS = ['holiday', 'break', 'exam_period', 'event'] as const;

// ---------------------------------------------------------------- terminology

/** Words the UI uses for the academic structure; every institution type has its own. */
export const TERM_KEYS = [
  'institution',
  'campus',
  'department',
  'program',
  'level',
  'section',
  'course',
  'teacher',
  'student',
  'guardian',
  'term',
  'academicYear',
] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export interface TermWord {
  one: string;
  other: string;
}
export type Terminology = Record<TermKey, TermWord>;

const w = (one: string, other = `${one}s`): TermWord => ({ one, other });

const SCHOOL: Terminology = {
  institution: w('School'),
  campus: w('Campus', 'Campuses'),
  department: w('Department'),
  program: w('Stage'),
  level: w('Grade'),
  section: w('Class', 'Classes'),
  course: w('Subject'),
  teacher: w('Teacher'),
  student: w('Student'),
  guardian: w('Parent'),
  term: w('Term'),
  academicYear: w('Session'),
};

export const TERMINOLOGY_PACKS: Record<InstitutionType, Terminology> = {
  school: SCHOOL,
  chain: { ...SCHOOL, institution: w('School network'), campus: w('Branch', 'Branches') },
  college: {
    ...SCHOOL,
    institution: w('College'),
    program: w('Program'),
    level: w('Year'),
    section: w('Section'),
    teacher: w('Lecturer'),
    guardian: w('Guardian'),
  },
  university: {
    institution: w('University', 'Universities'),
    campus: w('Campus', 'Campuses'),
    department: w('Department'),
    program: w('Degree program'),
    level: w('Level'),
    section: w('Batch', 'Batches'),
    course: w('Course'),
    teacher: w('Instructor'),
    student: w('Student'),
    guardian: w('Guardian'),
    term: w('Semester'),
    academicYear: w('Academic year'),
  },
  academy: {
    institution: w('Academy', 'Academies'),
    campus: w('Center'),
    department: w('Department'),
    program: w('Program'),
    level: w('Level'),
    section: w('Batch', 'Batches'),
    course: w('Course'),
    teacher: w('Instructor'),
    student: w('Student'),
    guardian: w('Guardian'),
    term: w('Session'),
    academicYear: w('Year'),
  },
  training_center: {
    institution: w('Training center'),
    campus: w('Location'),
    department: w('Practice'),
    program: w('Track'),
    level: w('Stage'),
    section: w('Cohort'),
    course: w('Module'),
    teacher: w('Trainer'),
    student: w('Trainee'),
    guardian: w('Emergency contact'),
    term: w('Intake'),
    academicYear: w('Year'),
  },
};

/** The type's pack with the institution's own overrides on top. */
export function resolveTerminology(type: InstitutionType, overrides: Partial<Record<TermKey, Partial<TermWord>>> = {}): Terminology {
  const pack = TERMINOLOGY_PACKS[type] ?? SCHOOL;
  const out = { ...pack };
  for (const key of TERM_KEYS) {
    const o = overrides[key];
    if (o?.one) out[key] = { one: o.one, other: o.other || `${o.one}s` };
  }
  return out;
}

// ---------------------------------------------------------------- grading

export const gradeBand = z.object({
  /** lowest percentage that earns this band */
  min: z.coerce.number().min(0).max(100),
  label: z.string().trim().min(1).max(20),
  /** grade points (GPA schemes) */
  points: z.coerce.number().min(0).max(10).nullable().optional(),
  passed: z.boolean(),
});
export type GradeBand = z.infer<typeof gradeBand>;

export const gradingSchemeBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(GRADING_KINDS),
    bands: z.array(gradeBand).min(1).max(30),
    gpa_scale: z.coerce.number().min(1).max(10).nullable().optional(),
    pass_percent: z.coerce.number().min(0).max(100).default(50),
    is_default: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    const mins = s.bands.map((b) => b.min);
    if (new Set(mins).size !== mins.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: 'Two bands start at the same percentage' });
    if (!mins.includes(0)) ctx.addIssue({ code: 'custom', path: ['bands'], message: 'One band must start at 0%' });
    if (s.kind === 'gpa') {
      if (!s.gpa_scale) ctx.addIssue({ code: 'custom', path: ['gpa_scale'], message: 'A GPA scheme needs a scale (e.g. 4.0)' });
      s.bands.forEach((b, i) => {
        if (b.points == null) ctx.addIssue({ code: 'custom', path: ['bands', i, 'points'], message: 'Every GPA band needs grade points' });
        else if (s.gpa_scale && b.points > s.gpa_scale)
          ctx.addIssue({ code: 'custom', path: ['bands', i, 'points'], message: 'Points cannot exceed the scale' });
      });
    }
  });
export type GradingSchemeBody = z.input<typeof gradingSchemeBody>;

export interface GradingScheme {
  name: string;
  kind: GradingKind;
  bands: GradeBand[];
  gpa_scale?: number | null;
  pass_percent: number;
}

const band = (min: number, label: string, passed = true, points?: number): GradeBand => ({ min, label, passed, points });

export const GRADING_PRESETS = {
  school_letter: {
    name: 'Letter grades',
    kind: 'letter',
    pass_percent: 40,
    bands: [band(90, 'A+'), band(80, 'A'), band(70, 'B'), band(60, 'C'), band(50, 'D'), band(40, 'E'), band(0, 'F', false)],
  },
  percentage: {
    name: 'Percentage',
    kind: 'percentage',
    pass_percent: 33,
    bands: [band(33, 'Pass'), band(0, 'Fail', false)],
  },
  /** HEC Pakistan-style 4.0 scale */
  gpa_4: {
    name: 'GPA (4.0)',
    kind: 'gpa',
    gpa_scale: 4,
    pass_percent: 50,
    bands: [
      band(85, 'A', true, 4),
      band(80, 'A-', true, 3.67),
      band(75, 'B+', true, 3.33),
      band(71, 'B', true, 3),
      band(68, 'B-', true, 2.67),
      band(64, 'C+', true, 2.33),
      band(61, 'C', true, 2),
      band(58, 'C-', true, 1.67),
      band(54, 'D+', true, 1.33),
      band(50, 'D', true, 1),
      band(0, 'F', false, 0),
    ],
  },
  gpa_5: {
    name: 'GPA (5.0)',
    kind: 'gpa',
    gpa_scale: 5,
    pass_percent: 50,
    bands: [band(90, 'A', true, 5), band(80, 'B', true, 4), band(70, 'C', true, 3), band(60, 'D', true, 2), band(50, 'E', true, 1), band(0, 'F', false, 0)],
  },
  pass_fail: {
    name: 'Pass / fail',
    kind: 'pass_fail',
    pass_percent: 50,
    bands: [band(50, 'Pass'), band(0, 'Fail', false)],
  },
  competency: {
    name: 'Competency',
    kind: 'competency',
    pass_percent: 70,
    bands: [band(85, 'Mastery'), band(70, 'Proficient'), band(50, 'Developing', false), band(0, 'Beginning', false)],
  },
} satisfies Record<string, GradingScheme>;
export type GradingPreset = keyof typeof GRADING_PRESETS;

export interface GradeResult {
  percent: number;
  label: string;
  points: number | null;
  passed: boolean;
}

/** Turn a percentage into the scheme's grade (bands are matched from the top). */
export function gradeFor(scheme: Pick<GradingScheme, 'bands'>, percent: number): GradeResult {
  const p = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
  const bands = [...scheme.bands].sort((a, b) => b.min - a.min);
  const hit = bands.find((b) => p >= b.min) ?? bands[bands.length - 1]!;
  return { percent: p, label: hit.label, points: hit.points ?? null, passed: hit.passed };
}

/**
 * Credit-weighted grade point average. Pass every course of a term for the term GPA, or every
 * course so far for the cumulative GPA (CGPA). Courses without credits count as 1.
 */
export function gpa(scheme: GradingScheme, results: { percent: number; credits?: number | null }[]): number | null {
  if (scheme.kind !== 'gpa' || results.length === 0) return null;
  let points = 0;
  let credits = 0;
  for (const r of results) {
    const c = r.credits && r.credits > 0 ? r.credits : 1;
    points += (gradeFor(scheme, r.percent).points ?? 0) * c;
    credits += c;
  }
  return Math.round((points / credits) * 100) / 100;
}

// ---------------------------------------------------------------- defaults per institution type

export interface ProgramTemplate {
  name: string;
  code: string;
  levels: string[];
}

export interface InstitutionDefaults {
  grading: GradingPreset;
  termKind: TermKind;
  /** term names inside one academic year, with [month, day] start and end (relative to the year start) */
  terms: { name: string; start: [number, number]; end: [number, number] | null }[];
  /** month (1–12) the academic year starts */
  yearStartMonth: number;
  programs: ProgramTemplate[];
  /** 0 = Sunday … 6 = Saturday */
  workingDays: number[];
  /** enrolment into courses: whole sections (schools) or individually (universities) */
  enrollmentMode: 'section' | 'open';
}

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix} ${from + i}`);

const SCHOOL_DEFAULTS: InstitutionDefaults = {
  grading: 'school_letter',
  termKind: 'annual',
  terms: [{ name: 'Annual', start: [8, 1], end: [7, 31] }],
  yearStartMonth: 8,
  programs: [
    { name: 'Early years', code: 'EY', levels: ['Playgroup', 'Nursery', 'Kindergarten'] },
    { name: 'Primary', code: 'PRI', levels: range('Class', 1, 5) },
    { name: 'Secondary', code: 'SEC', levels: range('Class', 6, 10) },
  ],
  workingDays: [1, 2, 3, 4, 5, 6],
  enrollmentMode: 'section',
};

export const INSTITUTION_DEFAULTS: Record<InstitutionType, InstitutionDefaults> = {
  school: SCHOOL_DEFAULTS,
  chain: SCHOOL_DEFAULTS,
  college: {
    grading: 'percentage',
    termKind: 'annual',
    terms: [{ name: 'Annual', start: [9, 1], end: [6, 30] }],
    yearStartMonth: 9,
    programs: [
      { name: 'FSc Pre-Medical', code: 'FSCM', levels: ['First year', 'Second year'] },
      { name: 'FSc Pre-Engineering', code: 'FSCE', levels: ['First year', 'Second year'] },
      { name: 'ICS', code: 'ICS', levels: ['First year', 'Second year'] },
    ],
    workingDays: [1, 2, 3, 4, 5, 6],
    enrollmentMode: 'section',
  },
  university: {
    grading: 'gpa_4',
    termKind: 'semester',
    terms: [
      { name: 'Fall', start: [9, 1], end: [1, 15] },
      { name: 'Spring', start: [2, 1], end: [6, 15] },
    ],
    yearStartMonth: 9,
    programs: [{ name: 'BS Computer Science', code: 'BSCS', levels: range('Semester', 1, 8) }],
    workingDays: [1, 2, 3, 4, 5],
    enrollmentMode: 'open',
  },
  academy: {
    grading: 'pass_fail',
    termKind: 'quarter',
    terms: [
      { name: 'Q1', start: [1, 1], end: [3, 31] },
      { name: 'Q2', start: [4, 1], end: [6, 30] },
      { name: 'Q3', start: [7, 1], end: [9, 30] },
      { name: 'Q4', start: [10, 1], end: [12, 31] },
    ],
    yearStartMonth: 1,
    programs: [{ name: 'IELTS Preparation', code: 'IELTS', levels: ['Foundation', 'Intermediate', 'Advanced'] }],
    workingDays: [1, 2, 3, 4, 5, 6],
    enrollmentMode: 'open',
  },
  training_center: {
    grading: 'competency',
    termKind: 'rolling',
    terms: [{ name: 'Rolling intake', start: [1, 1], end: null }],
    yearStartMonth: 1,
    programs: [{ name: 'Professional certificate', code: 'CERT', levels: ['Module 1', 'Module 2', 'Module 3', 'Capstone'] }],
    workingDays: [1, 2, 3, 4, 5],
    enrollmentMode: 'open',
  },
};

/**
 * The academic year containing `today` for an institution whose year starts in `startMonth`,
 * with its terms laid out as calendar dates.
 */
export function academicYearFor(defaults: Pick<InstitutionDefaults, 'yearStartMonth' | 'terms'>, today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const start = m >= defaults.yearStartMonth ? y : y - 1;
  const iso = (year: number, month: number, day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const yearOf = (month: number) => (month >= defaults.yearStartMonth ? start : start + 1);
  const endMonth = defaults.yearStartMonth === 1 ? 12 : defaults.yearStartMonth - 1;
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startsOn = iso(start, defaults.yearStartMonth, 1);
  const endsOn = iso(yearOf(endMonth), endMonth, lastDay(yearOf(endMonth), endMonth));
  const name = defaults.yearStartMonth === 1 ? String(start) : `${start}–${String(start + 1).slice(2)}`;
  return {
    name,
    startsOn,
    endsOn,
    terms: defaults.terms.map((t, i) => ({
      name: defaults.terms.length > 1 && !/\d/.test(t.name) ? `${t.name} ${yearOf(t.start[0])}` : t.name,
      sequence: i + 1,
      startsOn: iso(yearOf(t.start[0]), t.start[0], t.start[1]),
      endsOn: t.end ? iso(yearOf(t.end[0]), t.end[0], t.end[1]) : null,
    })),
  };
}

// ---------------------------------------------------------------- institution settings

export const terminologyOverrides = z
  .partialRecord(z.enum(TERM_KEYS), z.object({ one: z.string().trim().max(40), other: z.string().trim().max(40).optional() }))
  .default({});

export const institutionSettings = z.object({
  terminology: terminologyOverrides.optional(),
  working_days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** storage quota in MB (the plan's default applies when unset) */
  storage_quota_mb: z.number().int().min(10).max(1_000_000).optional(),
  /** below this attendance (percent) students, guardians and the class teacher are alerted, and exam eligibility is flagged */
  attendance_threshold: z.number().min(0).max(100).optional(),
  /** how attendance is taken: once a day per section (schools) or per class (colleges, universities) */
  attendance_mode: z.enum(['day', 'class']).optional(),
  /** badges, points and streaks (optional), and whether a course leaderboard is shown */
  gamification: z.object({ enabled: z.boolean(), leaderboard: z.boolean() }).optional(),
  /** reminders this many hours before work is due */
  due_reminder_hours: z.number().int().min(1).max(168).optional(),
  /** fee visibility and reminders */
  fees: feeSettingsBody.partial().optional(),
  /** AI features, provider and budget */
  ai: aiSettingsBody.partial().optional(),
  /** messaging and safeguarding rules */
  messaging: messagingSettingsBody.partial().optional(),
  /** notifications may also go out by SMS / WhatsApp when a person chooses it (the institution pays for messages) */
  notify_by_phone: z.boolean().optional(),
});

export const DEFAULT_ATTENDANCE_THRESHOLD = 75;

/**
 * Attendance percentage: present and late count as attended; excused and approved leave are left
 * out of the total; absent counts against. null when nothing counts yet.
 */
export function attendancePercent(c: { present?: number; late?: number; absent?: number; excused?: number; leave?: number }): number | null {
  const attended = (c.present ?? 0) + (c.late ?? 0);
  const total = attended + (c.absent ?? 0);
  return total ? Math.round((attended / total) * 1000) / 10 : null;
}
export type InstitutionSettings = z.infer<typeof institutionSettings>;
