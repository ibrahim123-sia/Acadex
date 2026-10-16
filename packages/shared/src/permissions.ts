/**
 * Permission catalogue. Permissions are granted through roles; a role assignment has a
 * scope (platform or an institution today; group / campus / department / section later).
 * Resource rules that depend on relationships (a teacher's own sections, a parent's own
 * children) are enforced on top of these by the API's access checks.
 */
export const PERMISSIONS = {
  // platform (SaaS owner)
  'platform.institutions.read': 'View all institutions on the platform',
  'platform.institutions.manage': 'Register, suspend and change the plan of institutions',
  'platform.audit.read': 'View the platform audit log',

  // institution groups (school chains, university systems)
  'group.read': 'View every institution in your group',

  // institution administration
  'institution.dashboard.read': 'View the institution dashboard',
  'students.read': 'View the student directory',
  'students.manage': 'Admit and edit students',
  'staff.read': 'View the staff directory',
  'staff.manage': 'Add and edit staff',
  'sections.read': 'View sections',
  'sections.manage': 'Create and edit sections',
  'fees.read': 'View fees and receipts',
  'fees.manage': 'Record fee payments',
  'academics.read': 'View institution-wide grades, attendance, timetable and exams',
  'announcements.read': 'View all announcements of the institution',
  'announcements.manage': 'Publish announcements',
  'roles.manage': 'Create custom roles and assign roles to people',
  'settings.manage': 'Change institution settings, terminology, grading schemes and custom fields',
  'structure.read': 'View campuses, departments, programs, the calendar and the course catalog',
  'structure.manage': 'Set up campuses, departments, programs, levels, academic years, terms, holidays and courses',
  'enrollments.manage': 'Enrol students in courses and manage waitlists',
  'guardians.read': 'View guardians and their links to students',
  'guardians.manage': 'Add and edit guardians and what each may see',
  'students.medical.read': 'View medical and emergency information',
  'students.medical.manage': 'Edit medical and emergency information',
  'documents.issue': 'Issue ID cards, certificates and letters',
  'imports.run': 'Bulk import and update people, courses and enrolments',
  'year_end.manage': 'Promote, graduate and archive at the end of the year',
  'recycle_bin.manage': 'Restore or permanently delete deleted records',
  'records.read_any': "Download any student's report card or fee voucher in the institution",
  'audit.read': "View the institution's audit log",
  'courses.manage_any': 'Build, grade and run any course (not only courses you teach)',
  'blueprints.manage': 'Create course blueprints and push them to sections',
  'attendance.manage': 'Correct any attendance register and staff attendance',
  'leave.approve': 'Approve or reject leave requests of students and staff',
  'timetable.manage': 'Set up rooms, the bell schedule and the timetable; arrange substitutions',
  'surveys.manage': 'Run course evaluations, surveys and forms',
  'gamification.manage': 'Turn badges and points on and set them up',
  'fees.setup': 'Set up fee structures, discounts and scholarships; generate and adjust invoices',
  'fees.refund': 'Refund payments and waive fees',
  'finance.reports': 'View finance reports, defaulters and reconciliation; export to Excel, Tally and QuickBooks',
  'finance.expenses': 'Record expenses',
  'payments.configure': 'Connect payment providers and the bank account shown on vouchers',
  'exams.manage': 'Run the exams office: series, papers, seating, invigilation and admit cards',
  'exams.moderate': 'Approve and moderate marks as head of department',
  'exams.publish': 'Approve marks as exam controller and publish results',
  'outcomes.manage': 'Set up program and course learning outcomes (PLO / CLO) and their mapping',
  'admissions.manage': 'Run admissions: forms, applications, entrance tests, merit lists and offers',
  'enquiries.manage': 'Track admission enquiries and follow-ups',

  // teaching (limited to the teacher's own sections)
  'teaching.access': 'Use the teacher workspace for assigned sections',
  'attendance.mark': 'Mark attendance for assigned sections',
  'grades.enter': 'Enter grades for assigned sections',
  'assignments.manage': 'Create assignments for assigned sections',
  'content.import': 'Import course content (Common Cartridge, Moodle, QTI, SCORM)',

  // learners and families
  'learner.access': 'Use the student workspace',
  'submissions.create': 'Submit assignments',
  'guardian.access': 'View linked children',
  'leave.request': 'Request leave (for yourself, or for a linked child)',

  // everyone signed in to an institution
  'announcements.view': 'View announcements addressed to you',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Permissions an institution may put into its own custom roles (never platform ones). */
export const INSTITUTION_ASSIGNABLE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !p.startsWith('platform.') && !p.startsWith('group.'));

/** Where a role can be granted: platform-wide, a group of institutions, or an institution (or one of its campuses). */
export type ScopeType = 'platform' | 'group' | 'institution';

export interface SystemRoleDef {
  key: string;
  name: string;
  scope: ScopeType;
  permissions: Permission[];
}

const INSTITUTION_ADMIN: Permission[] = [
  'institution.dashboard.read',
  'students.read',
  'students.manage',
  'staff.read',
  'staff.manage',
  'sections.read',
  'sections.manage',
  'fees.read',
  'fees.manage',
  'academics.read',
  'announcements.read',
  'announcements.manage',
  'roles.manage',
  'records.read_any',
  'audit.read',
  'settings.manage',
  'structure.read',
  'structure.manage',
  'enrollments.manage',
  'guardians.read',
  'guardians.manage',
  'students.medical.read',
  'students.medical.manage',
  'documents.issue',
  'imports.run',
  'year_end.manage',
  'recycle_bin.manage',
  'courses.manage_any',
  'blueprints.manage',
  'attendance.manage',
  'leave.approve',
  'timetable.manage',
  'surveys.manage',
  'gamification.manage',
  'content.import',
  'fees.setup',
  'fees.refund',
  'finance.reports',
  'finance.expenses',
  'payments.configure',
  'exams.manage',
  'exams.moderate',
  'exams.publish',
  'outcomes.manage',
  'admissions.manage',
  'enquiries.manage',
];

/** Built-in roles. Their keys match the users.role "primary role" values. */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: 'super_admin',
    name: 'Platform administrator',
    scope: 'platform',
    permissions: ['platform.institutions.read', 'platform.institutions.manage', 'platform.audit.read'],
  },
  { key: 'group_admin', name: 'Group administrator', scope: 'group', permissions: ['group.read'] },
  { key: 'institution_admin', name: 'Institution administrator', scope: 'institution', permissions: INSTITUTION_ADMIN },
  {
    key: 'teacher',
    name: 'Teacher',
    scope: 'institution',
    permissions: ['teaching.access', 'attendance.mark', 'grades.enter', 'assignments.manage', 'announcements.view', 'structure.read', 'content.import', 'leave.request'],
  },
  { key: 'student', name: 'Student', scope: 'institution', permissions: ['learner.access', 'submissions.create', 'announcements.view', 'leave.request'] },
  { key: 'parent', name: 'Parent / guardian', scope: 'institution', permissions: ['guardian.access', 'announcements.view', 'leave.request'] },
];
