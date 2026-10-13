/**
 * Permission catalogue. Permissions are granted through roles; a role assignment has a
 * scope (platform or a school today; group / campus / department / section later).
 * Resource rules that depend on relationships (a teacher's own classes, a parent's own
 * children) are enforced on top of these by the API's access checks.
 */
export const PERMISSIONS = {
  // platform (SaaS owner)
  'platform.schools.read': 'View all schools on the platform',
  'platform.schools.manage': 'Register, suspend and change the plan of schools',
  'platform.audit.read': 'View the platform audit log',

  // school administration
  'school.dashboard.read': 'View the school dashboard',
  'students.read': 'View the student directory',
  'students.manage': 'Admit and edit students',
  'staff.read': 'View the staff directory',
  'staff.manage': 'Add and edit staff',
  'classes.read': 'View classes',
  'classes.manage': 'Create and edit classes',
  'fees.read': 'View fees and receipts',
  'fees.manage': 'Record fee payments',
  'academics.read': 'View school-wide grades, attendance, timetable and exams',
  'announcements.read': 'View all announcements of the school',
  'announcements.manage': 'Publish announcements',
  'roles.manage': 'Create custom roles and assign roles to people',
  'records.read_any': "Download any student's report card or fee voucher in the school",
  'audit.read': "View the school's audit log",

  // teaching (limited to the teacher's own classes)
  'teaching.access': 'Use the teacher workspace for assigned classes',
  'attendance.mark': 'Mark attendance for assigned classes',
  'grades.enter': 'Enter grades for assigned classes',
  'assignments.manage': 'Create assignments for assigned classes',

  // learners and families
  'learner.access': 'Use the student workspace',
  'submissions.create': 'Submit assignments',
  'guardian.access': 'View linked children',

  // everyone signed in to a school
  'announcements.view': 'View announcements addressed to you',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Permissions a school may put into its own custom roles (never platform ones). */
export const SCHOOL_ASSIGNABLE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !p.startsWith('platform.'));

export type ScopeType = 'platform' | 'school';

export interface SystemRoleDef {
  key: string;
  name: string;
  scope: ScopeType;
  permissions: Permission[];
}

const SCHOOL_ADMIN: Permission[] = [
  'school.dashboard.read',
  'students.read',
  'students.manage',
  'staff.read',
  'staff.manage',
  'classes.read',
  'classes.manage',
  'fees.read',
  'fees.manage',
  'academics.read',
  'announcements.read',
  'announcements.manage',
  'roles.manage',
  'records.read_any',
  'audit.read',
];

/** Built-in roles. Their keys match the users.role "primary role" values. */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: 'super_admin',
    name: 'Platform administrator',
    scope: 'platform',
    permissions: ['platform.schools.read', 'platform.schools.manage', 'platform.audit.read'],
  },
  { key: 'school_admin', name: 'School administrator', scope: 'school', permissions: SCHOOL_ADMIN },
  {
    key: 'teacher',
    name: 'Teacher',
    scope: 'school',
    permissions: ['teaching.access', 'attendance.mark', 'grades.enter', 'assignments.manage', 'announcements.view'],
  },
  { key: 'student', name: 'Student', scope: 'school', permissions: ['learner.access', 'submissions.create', 'announcements.view'] },
  { key: 'parent', name: 'Parent / guardian', scope: 'school', permissions: ['guardian.access', 'announcements.view'] },
];
