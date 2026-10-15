// OpenAPI 3.1 description of the API, generated from the same Zod schemas the routes
// validate with. Every route must be listed here (tests/openapi.test.ts checks it).
import { z } from 'zod';
import {
  academicYearBody,
  auditQuery,
  calendarQuery,
  campusBody,
  courseBody,
  courseListQuery,
  customFieldBody,
  departmentBody,
  documentTemplateBody,
  enrollBody,
  gradingSchemeBody,
  guardianBody,
  holidayBody,
  institutionProfileBody,
  issueDocumentBody,
  issueIdCardsBody,
  levelBody,
  linkGuardianBody,
  medicalBody,
  offeringBody,
  offeringListQuery,
  offeringStaffBody,
  onboardingApplyBody,
  programBody,
  promotionBody,
  promotionPreviewQuery,
  reorderLevelsBody,
  revokeDocumentBody,
  termBody,
  updateAcademicYearBody,
  updateCampusBody,
  updateCourseBody,
  updateCustomFieldBody,
  updateDepartmentBody,
  updateGuardianBody,
  updateGuardianshipBody,
  updateOfferingBody,
  updateProgramBody,
  updateSectionBody,
  updateStaffBody,
  updateStudentBody,
  updateTermBody,
  acceptInviteBody,
  assignRoleBody,
  changePasswordBody,
  collectFeeBody,
  createSectionBody,
  createRoleBody,
  createInstitutionBody,
  createStudentBody,
  createTeacherBody,
  loginBody,
  mfaCode,
  mfaDisableBody,
  mfaEnableBody,
  mfaVerifyBody,
  pageQuery,
  passwordResetBody,
  passwordResetRequestBody,
  studentSearchQuery,
  updateRoleBody,
  updateInstitutionBody,
  verifyEmailBody,
  type Permission,
} from '@acadex/shared';
import { lmsRoutes } from './openapi-lms';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
type Auth = 'public' | 'session' | 'incomplete' | 'cookie';

export interface RouteDoc {
  method: Method;
  path: string; // Express style (/institutions/:id)
  tag: string;
  summary: string;
  auth: Auth;
  permission?: Permission;
  body?: z.ZodType;
  query?: z.ZodType;
  paginated?: boolean;
}

const page = pageQuery();
const r = (method: Method, path: string, tag: string, summary: string, auth: Auth, extra: Partial<RouteDoc> = {}): RouteDoc => ({
  method,
  path,
  tag,
  summary,
  auth,
  ...extra,
});

export const ROUTES: RouteDoc[] = [
  r('get', '/api/health', 'System', 'Liveness: the process is up', 'public'),
  r('get', '/api/ready', 'System', 'Readiness: database reachable and migrations applied', 'public'),

  // ---------- auth ----------
  r('post', '/api/auth/login', 'Auth', 'Sign in (returns a session, or a 2FA challenge)', 'public', { body: loginBody }),
  r('post', '/api/auth/mfa/verify', 'Auth', 'Complete sign-in with a 2FA or recovery code', 'public', { body: mfaVerifyBody }),
  r('post', '/api/auth/refresh', 'Auth', 'Exchange the refresh cookie for a new access token (rotates the cookie)', 'cookie'),
  r('post', '/api/auth/logout', 'Auth', 'Sign out this device', 'cookie'),
  r('post', '/api/auth/logout-all', 'Auth', 'Sign out on every device', 'session'),
  r('get', '/api/auth/me', 'Auth', 'The signed-in user and institution', 'incomplete'),
  r('post', '/api/auth/change-password', 'Auth', 'Change password (other devices are signed out)', 'incomplete', { body: changePasswordBody }),
  r('get', '/api/auth/sessions', 'Auth', 'Signed-in devices', 'session'),
  r('delete', '/api/auth/sessions/:id', 'Auth', 'Sign out one device', 'session'),
  r('post', '/api/auth/sessions/revoke-others', 'Auth', 'Sign out all other devices', 'session'),
  r('get', '/api/auth/invites/:token', 'Auth', 'Preview an invitation', 'public'),
  r('post', '/api/auth/invites/accept', 'Auth', 'Accept an invitation: set a password and sign in', 'public', { body: acceptInviteBody }),
  r('post', '/api/auth/password-reset/request', 'Auth', 'Email a password-reset link', 'public', { body: passwordResetRequestBody }),
  r('post', '/api/auth/password-reset/confirm', 'Auth', 'Set a new password with a reset link', 'public', { body: passwordResetBody }),
  r('post', '/api/auth/verify-email/request', 'Auth', 'Email a confirmation link', 'session'),
  r('post', '/api/auth/verify-email/confirm', 'Auth', 'Confirm an email address', 'public', { body: verifyEmailBody }),
  r('get', '/api/auth/mfa', 'Auth', '2FA status', 'session'),
  r('post', '/api/auth/mfa/totp/setup', 'Auth', 'Start authenticator-app enrolment', 'incomplete'),
  r('post', '/api/auth/mfa/totp/enable', 'Auth', 'Confirm enrolment (returns recovery codes)', 'incomplete', { body: mfaEnableBody }),
  r('post', '/api/auth/mfa/disable', 'Auth', 'Turn 2FA off', 'session', { body: mfaDisableBody }),
  r('post', '/api/auth/mfa/recovery-codes', 'Auth', 'New recovery codes', 'session', { body: z.object({ code: mfaCode }) }),

  // ---------- platform ----------
  r('get', '/api/platform/stats', 'Platform', 'Platform KPIs', 'session', { permission: 'platform.institutions.read' }),
  r('get', '/api/platform/institutions', 'Platform', 'All institutions', 'session', { permission: 'platform.institutions.read', query: page, paginated: true }),
  r('post', '/api/platform/institutions', 'Platform', 'Register an institution (invites its administrator)', 'session', { permission: 'platform.institutions.manage', body: createInstitutionBody }),
  r('patch', '/api/platform/institutions/:id', 'Platform', 'Change plan, status or locale', 'session', { permission: 'platform.institutions.manage', body: updateInstitutionBody }),
  r('get', '/api/platform/audit', 'Platform', 'Platform audit log', 'session', { permission: 'platform.audit.read', query: page, paginated: true }),

  // ---------- institution office ----------
  r('get', '/api/institution/dashboard', 'Institution', 'Dashboard', 'session', { permission: 'institution.dashboard.read' }),
  r('get', '/api/institution/students', 'Institution', 'Student directory', 'session', { permission: 'students.read', query: page.extend(studentSearchQuery.shape), paginated: true }),
  r('post', '/api/institution/students', 'Institution', 'Admit a student (emails an invitation)', 'session', { permission: 'students.manage', body: createStudentBody }),
  r('get', '/api/institution/teachers', 'Institution', 'Staff directory', 'session', { permission: 'staff.read', query: page, paginated: true }),
  r('post', '/api/institution/teachers', 'Institution', 'Add a teacher (emails an invitation)', 'session', { permission: 'staff.manage', body: createTeacherBody }),
  r('post', '/api/institution/users/:userId/invite', 'Institution', 'Send a new invitation', 'session', { permission: 'staff.manage' }),
  r('get', '/api/institution/sections', 'Institution', 'Classes', 'session', { permission: 'sections.read', query: page, paginated: true }),
  r('post', '/api/institution/sections', 'Institution', 'Create a class', 'session', { permission: 'sections.manage', body: createSectionBody }),
  r('get', '/api/institution/fees', 'Institution', 'Fee records', 'session', { permission: 'fees.read', query: page, paginated: true }),
  r('get', '/api/institution/fees/summary', 'Institution', 'Fee totals', 'session', { permission: 'fees.read' }),
  r('post', '/api/institution/fees', 'Institution', 'Record a fee payment', 'session', { permission: 'fees.manage', body: collectFeeBody }),
  r('get', '/api/institution/grades', 'Institution', 'All grades', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/institution/attendance', 'Institution', 'All attendance', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/institution/timetable', 'Institution', 'Timetable', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/institution/exams', 'Institution', 'Exam schedule', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/institution/announcements', 'Institution', 'Announcements', 'session', { permission: 'announcements.read', query: page, paginated: true }),

  // ---------- roles ----------
  r('get', '/api/institution/permissions', 'Roles', 'Permissions an institution role can hold', 'session', { permission: 'roles.manage' }),
  r('get', '/api/institution/roles', 'Roles', 'Built-in and custom roles', 'session', { permission: 'roles.manage' }),
  r('post', '/api/institution/roles', 'Roles', 'Create a custom role', 'session', { permission: 'roles.manage', body: createRoleBody }),
  r('patch', '/api/institution/roles/:id', 'Roles', 'Edit a custom role', 'session', { permission: 'roles.manage', body: updateRoleBody }),
  r('delete', '/api/institution/roles/:id', 'Roles', 'Delete a custom role', 'session', { permission: 'roles.manage' }),
  r('get', '/api/institution/users/:userId/roles', 'Roles', "A person's roles", 'session', { permission: 'roles.manage' }),
  r('post', '/api/institution/users/:userId/roles', 'Roles', 'Grant a role', 'session', { permission: 'roles.manage', body: assignRoleBody }),
  r('delete', '/api/institution/users/:userId/roles/:roleId', 'Roles', 'Revoke a role', 'session', { permission: 'roles.manage' }),

  // ---------- teaching ----------
  r('get', '/api/me/teacher/overview', 'Teaching', 'Teacher home', 'session', { permission: 'teaching.access' }),
  r('get', '/api/me/teacher/sections', 'Teaching', 'Sections I take registers for, with my courses in each', 'session', { permission: 'teaching.access' }),

  // ---------- learning / family / everyone ----------
  r('get', '/api/me/student/overview', 'Learning', 'Student home', 'session', { permission: 'learner.access' }),
  r('get', '/api/me/dashboard', 'Everyone', 'My dashboard: today’s classes, work due, grades, attendance (by role)', 'session'),
  r('get', '/api/events', 'Everyone', 'Live updates for open tabs (server-sent events; Authorization header)', 'session'),
  r('get', '/api/parent/children', 'Family', 'My children', 'session', { permission: 'guardian.access' }),
  r('get', '/api/parent/child/:id/overview', 'Family', "A child's overview", 'session', { permission: 'guardian.access' }),
  r('get', '/api/pdf/report-card/:studentId', 'Documents', 'Report card (PDF)', 'session'),
  r('get', '/api/pdf/fee-voucher/:feeId', 'Documents', 'Fee voucher (PDF)', 'session'),
  // ---------- structure ----------
  r('get', '/api/institution/structure', 'Structure', 'Campuses, departments, programs with levels, years with terms, grading schemes', 'session', { permission: 'structure.read' }),
  r('post', '/api/institution/campuses', 'Structure', 'Add a campus / branch', 'session', { permission: 'structure.manage', body: campusBody }),
  r('patch', '/api/institution/campuses/:id', 'Structure', 'Edit a campus', 'session', { permission: 'structure.manage', body: updateCampusBody }),
  r('post', '/api/institution/campuses/:id/main', 'Structure', 'Make a campus the main one', 'session', { permission: 'structure.manage' }),
  r('delete', '/api/institution/campuses/:id', 'Structure', 'Delete a campus (to the recycle bin)', 'session', { permission: 'structure.manage' }),
  r('get', '/api/institution/departments', 'Structure', 'Departments / faculties', 'session', { permission: 'structure.read' }),
  r('post', '/api/institution/departments', 'Structure', 'Add a department', 'session', { permission: 'structure.manage', body: departmentBody }),
  r('patch', '/api/institution/departments/:id', 'Structure', 'Edit a department', 'session', { permission: 'structure.manage', body: updateDepartmentBody }),
  r('delete', '/api/institution/departments/:id', 'Structure', 'Delete a department', 'session', { permission: 'structure.manage' }),
  r('post', '/api/institution/programs', 'Structure', 'Add a program with its levels', 'session', { permission: 'structure.manage', body: programBody }),
  r('patch', '/api/institution/programs/:id', 'Structure', 'Edit a program', 'session', { permission: 'structure.manage', body: updateProgramBody }),
  r('delete', '/api/institution/programs/:id', 'Structure', 'Delete a program', 'session', { permission: 'structure.manage' }),
  r('post', '/api/institution/programs/:id/levels', 'Structure', 'Add a level at the end', 'session', { permission: 'structure.manage', body: levelBody }),
  r('put', '/api/institution/programs/:id/levels/order', 'Structure', 'Reorder levels (promotion follows this order)', 'session', { permission: 'structure.manage', body: reorderLevelsBody }),
  r('patch', '/api/institution/levels/:id', 'Structure', 'Rename a level', 'session', { permission: 'structure.manage', body: levelBody }),
  r('delete', '/api/institution/levels/:id', 'Structure', 'Delete an unused level', 'session', { permission: 'structure.manage' }),
  r('post', '/api/institution/academic-years', 'Structure', 'Add an academic year with terms', 'session', { permission: 'structure.manage', body: academicYearBody }),
  r('patch', '/api/institution/academic-years/:id', 'Structure', 'Edit an academic year (or make it current)', 'session', { permission: 'structure.manage', body: updateAcademicYearBody }),
  r('post', '/api/institution/academic-years/:id/terms', 'Structure', 'Add a term', 'session', { permission: 'structure.manage', body: termBody }),
  r('patch', '/api/institution/terms/:id', 'Structure', 'Edit a term', 'session', { permission: 'structure.manage', body: updateTermBody }),
  r('delete', '/api/institution/terms/:id', 'Structure', 'Delete an unused term', 'session', { permission: 'structure.manage' }),
  r('get', '/api/institution/calendar', 'Structure', 'Holidays, terms and working days in a date range', 'session', { permission: 'structure.read', query: calendarQuery }),
  r('post', '/api/institution/holidays', 'Structure', 'Add a holiday / break / exam period', 'session', { permission: 'structure.manage', body: holidayBody }),
  r('patch', '/api/institution/holidays/:id', 'Structure', 'Edit a holiday', 'session', { permission: 'structure.manage', body: holidayBody }),
  r('delete', '/api/institution/holidays/:id', 'Structure', 'Delete a holiday', 'session', { permission: 'structure.manage' }),
  r('get', '/api/institution/sections/:id', 'Structure', 'A class / batch with its students and courses', 'session', { permission: 'sections.read' }),
  r('patch', '/api/institution/sections/:id', 'Structure', 'Edit a class / batch', 'session', { permission: 'sections.manage', body: updateSectionBody }),
  r('delete', '/api/institution/sections/:id', 'Structure', 'Delete an empty class', 'session', { permission: 'sections.manage' }),
  r('get', '/api/institution/courses', 'Structure', 'Course catalog', 'session', { permission: 'structure.read', query: page.extend(courseListQuery.shape), paginated: true }),
  r('post', '/api/institution/courses', 'Structure', 'Add a course', 'session', { permission: 'structure.manage', body: courseBody }),
  r('patch', '/api/institution/courses/:id', 'Structure', 'Edit a course', 'session', { permission: 'structure.manage', body: updateCourseBody }),
  r('delete', '/api/institution/courses/:id', 'Structure', 'Delete a course', 'session', { permission: 'structure.manage' }),
  r('get', '/api/institution/offerings', 'Structure', 'Course offerings (a course in a term, for a class or open)', 'session', { permission: 'structure.read', query: page.extend(offeringListQuery.shape), paginated: true }),
  r('post', '/api/institution/offerings', 'Structure', 'Offer a course', 'session', { permission: 'structure.manage', body: offeringBody }),
  r('get', '/api/institution/offerings/:id', 'Structure', 'A course offering', 'session', { permission: 'structure.read' }),
  r('patch', '/api/institution/offerings/:id', 'Structure', 'Edit an offering (capacity changes fill seats from the waitlist)', 'session', { permission: 'structure.manage', body: updateOfferingBody }),
  r('delete', '/api/institution/offerings/:id', 'Structure', 'Remove an offering without grades', 'session', { permission: 'structure.manage' }),
  r('post', '/api/institution/offerings/:id/staff', 'Structure', 'Assign a teacher, co-teacher or TA', 'session', { permission: 'structure.manage', body: offeringStaffBody }),
  r('delete', '/api/institution/offerings/:id/staff/:teacherId', 'Structure', 'Unassign a teacher', 'session', { permission: 'structure.manage' }),
  r('get', '/api/institution/offerings/:id/enrollments', 'Structure', 'Who takes the course (and the waitlist)', 'session', { permission: 'structure.read' }),
  r('post', '/api/institution/offerings/:id/enrollments', 'Structure', 'Enrol students (seats first, then the waitlist)', 'session', { permission: 'enrollments.manage', body: enrollBody }),
  r('delete', '/api/institution/offerings/:id/enrollments/:studentId', 'Structure', 'Drop a student (the waitlist moves up)', 'session', { permission: 'enrollments.manage' }),

  // ---------- settings ----------
  r('get', '/api/institution/terminology', 'Settings', "The institution's words (Class / Batch / Cohort, …)", 'session'),
  r('get', '/api/institution/settings', 'Settings', 'Institution profile, type and settings', 'session', { permission: 'settings.manage' }),
  r('patch', '/api/institution/settings', 'Settings', 'Change the profile, type, terminology or working days', 'session', { permission: 'settings.manage', body: institutionProfileBody }),
  r('get', '/api/institution/grading-schemes', 'Settings', 'Grading schemes and presets', 'session', { permission: 'structure.read' }),
  r('post', '/api/institution/grading-schemes', 'Settings', 'Add a grading scheme', 'session', { permission: 'settings.manage', body: gradingSchemeBody }),
  r('put', '/api/institution/grading-schemes/:id', 'Settings', 'Replace a grading scheme', 'session', { permission: 'settings.manage', body: gradingSchemeBody }),
  r('delete', '/api/institution/grading-schemes/:id', 'Settings', 'Delete an unused grading scheme', 'session', { permission: 'settings.manage' }),
  r('get', '/api/institution/custom-fields', 'Settings', 'Custom field definitions', 'session'),
  r('post', '/api/institution/custom-fields', 'Settings', 'Add a custom field', 'session', { permission: 'settings.manage', body: customFieldBody }),
  r('patch', '/api/institution/custom-fields/:id', 'Settings', 'Edit a custom field', 'session', { permission: 'settings.manage', body: updateCustomFieldBody }),
  r('delete', '/api/institution/custom-fields/:id', 'Settings', 'Remove a custom field (values are kept)', 'session', { permission: 'settings.manage' }),
  r('get', '/api/institution/onboarding', 'Settings', 'Setup progress and the defaults for every institution type', 'session', { permission: 'settings.manage' }),
  r('post', '/api/institution/onboarding/apply', 'Settings', "Apply an institution type's defaults (only creates what is missing)", 'session', { permission: 'settings.manage', body: onboardingApplyBody }),
  r('post', '/api/institution/onboarding/complete', 'Settings', 'Mark setup as done', 'session', { permission: 'settings.manage' }),

  // ---------- people ----------
  r('get', '/api/institution/students/:id', 'People', 'Student profile (guardians, enrolments, documents, history; medical with permission)', 'session', { permission: 'students.read' }),
  r('patch', '/api/institution/students/:id', 'People', 'Edit a student', 'session', { permission: 'students.manage', body: updateStudentBody }),
  r('delete', '/api/institution/students/:id', 'People', 'Delete a student (to the recycle bin; sign-in stops)', 'session', { permission: 'students.manage' }),
  r('get', '/api/institution/students/:id/medical', 'People', 'Medical and emergency information', 'session', { permission: 'students.medical.read' }),
  r('put', '/api/institution/students/:id/medical', 'People', 'Save medical and emergency information', 'session', { permission: 'students.medical.manage', body: medicalBody }),
  r('post', '/api/institution/students/:id/guardians', 'People', 'Link an existing or new guardian', 'session', { permission: 'guardians.manage', body: linkGuardianBody }),
  r('patch', '/api/institution/guardianships/:id', 'People', "Change a guardian's relationship or permissions", 'session', { permission: 'guardians.manage', body: updateGuardianshipBody }),
  r('delete', '/api/institution/guardianships/:id', 'People', 'Unlink a guardian', 'session', { permission: 'guardians.manage' }),
  r('get', '/api/institution/guardians', 'People', 'Guardians', 'session', { permission: 'guardians.read', query: page, paginated: true }),
  r('post', '/api/institution/guardians', 'People', 'Add a guardian', 'session', { permission: 'guardians.manage', body: guardianBody }),
  r('get', '/api/institution/guardians/:id', 'People', 'A guardian and their children', 'session', { permission: 'guardians.read' }),
  r('patch', '/api/institution/guardians/:id', 'People', 'Edit a guardian', 'session', { permission: 'guardians.manage', body: updateGuardianBody }),
  r('delete', '/api/institution/guardians/:id', 'People', 'Delete a guardian', 'session', { permission: 'guardians.manage' }),
  r('post', '/api/institution/guardians/:id/invite', 'People', 'Invite a guardian to the parent portal', 'session', { permission: 'guardians.manage' }),
  r('get', '/api/institution/teachers/:id', 'People', 'Staff profile with teaching load and documents', 'session', { permission: 'staff.read' }),
  r('patch', '/api/institution/teachers/:id', 'People', 'Edit a staff member', 'session', { permission: 'staff.manage', body: updateStaffBody }),
  r('delete', '/api/institution/teachers/:id', 'People', 'Delete a staff member', 'session', { permission: 'staff.manage' }),
  r('put', '/api/institution/students/:id/photo', 'People', 'Upload a student photo (multipart "file")', 'session', { permission: 'students.manage' }),
  r('delete', '/api/institution/students/:id/photo', 'People', 'Remove a student photo', 'session', { permission: 'students.manage' }),
  r('put', '/api/institution/teachers/:id/photo', 'People', 'Upload a staff photo (multipart "file")', 'session', { permission: 'staff.manage' }),
  r('delete', '/api/institution/teachers/:id/photo', 'People', 'Remove a staff photo', 'session', { permission: 'staff.manage' }),
  r('post', '/api/institution/students/:id/documents', 'People', 'Add a document (multipart "file", title, category)', 'session', { permission: 'students.manage' }),
  r('post', '/api/institution/teachers/:id/documents', 'People', 'Add a document (multipart)', 'session', { permission: 'staff.manage' }),
  r('post', '/api/institution/guardians/:id/documents', 'People', 'Add a document (multipart)', 'session', { permission: 'guardians.manage' }),
  r('delete', '/api/institution/documents/:id', 'People', 'Delete a document', 'session'),
  r('get', '/api/files/:id', 'People', 'Download a file (only for people who may see what it belongs to)', 'session'),
  r('post', '/api/files/', 'Courses', 'Upload a course, submission, feedback or package file (attach it by id afterwards)', 'session'),

  // ---------- imports ----------
  r('post', '/api/institution/imports/:entity/preview', 'Imports', 'Dry run: what a CSV / Excel import would do, row by row (multipart "file", mode)', 'session', { permission: 'imports.run' }),
  r('post', '/api/institution/imports/:entity/commit', 'Imports', 'Run the import in one transaction (skip_invalid, send_invites)', 'session', { permission: 'imports.run' }),
  r('get', '/api/institution/imports', 'Imports', 'Recent imports and their error reports', 'session', { permission: 'imports.run' }),
  r('get', '/api/institution/imports/templates/:entity', 'Imports', 'A CSV template with the right columns', 'session', { permission: 'imports.run' }),
  r('post', '/api/institution/bulk-invite', 'Imports', 'Invite everyone who has not activated an account', 'session'),

  // ---------- documents ----------
  r('post', '/api/institution/id-cards', 'Documents', 'Issue ID cards (replaces active cards)', 'session', { permission: 'documents.issue', body: issueIdCardsBody }),
  r('get', '/api/institution/id-cards', 'Documents', 'Issued ID cards', 'session', { permission: 'documents.issue' }),
  r('post', '/api/institution/id-cards/:id/revoke', 'Documents', 'Revoke an ID card', 'session', { permission: 'documents.issue' }),
  r('get', '/api/institution/id-cards/pdf', 'Documents', 'Printable sheet of ID cards (PDF, QR verification)', 'session', { permission: 'documents.issue' }),
  r('get', '/api/institution/document-templates', 'Documents', 'Certificate templates and their placeholders', 'session', { permission: 'documents.issue' }),
  r('put', '/api/institution/document-templates/:kind', 'Documents', 'Customise a certificate template', 'session', { permission: 'settings.manage', body: documentTemplateBody }),
  r('delete', '/api/institution/document-templates/:kind', 'Documents', 'Back to the default template', 'session', { permission: 'settings.manage' }),
  r('post', '/api/institution/issued-documents', 'Documents', 'Issue a leaving / character certificate or bonafide letter', 'session', { permission: 'documents.issue', body: issueDocumentBody }),
  r('get', '/api/institution/issued-documents', 'Documents', 'Issued documents', 'session', { permission: 'documents.issue' }),
  r('post', '/api/institution/issued-documents/:id/revoke', 'Documents', 'Revoke an issued document', 'session', { permission: 'documents.issue', body: revokeDocumentBody }),
  r('get', '/api/institution/issued-documents/:id/pdf', 'Documents', 'An issued document as PDF', 'session', { permission: 'documents.issue' }),
  r('get', '/api/public/verify/:code', 'Public', 'Verify an ID card, document or course certificate from its QR code (masked name only)', 'public'),
  r('get', '/api/public/calendar/:token.ics', 'Public', 'A person’s calendar for calendar apps (the secret link is the key)', 'public'),

  // ---------- year end ----------
  r('get', '/api/institution/year-end/preview', 'Year end', 'Who would be promoted where (nothing changes)', 'session', { permission: 'year_end.manage', query: promotionPreviewQuery }),
  r('post', '/api/institution/year-end/prepare-sections', 'Year end', "Create next year's classes", 'session', { permission: 'year_end.manage', body: promotionPreviewQuery }),
  r('post', '/api/institution/year-end/promote', 'Year end', 'Promote, repeat, graduate or mark leavers (all or nothing)', 'session', { permission: 'year_end.manage', body: promotionBody }),
  r('post', '/api/institution/year-end/advance-sections', 'Year end', 'Move batches up a level (universities, academies)', 'session', { permission: 'year_end.manage' }),
  r('post', '/api/institution/academic-years/:id/archive', 'Year end', 'Archive a finished year (read-only)', 'session', { permission: 'year_end.manage' }),

  // ---------- records ----------
  r('get', '/api/institution/recycle-bin', 'Records', 'Deleted records', 'session', { permission: 'recycle_bin.manage' }),
  r('post', '/api/institution/recycle-bin/:entity/:id/restore', 'Records', 'Restore a deleted record', 'session', { permission: 'recycle_bin.manage' }),
  r('delete', '/api/institution/recycle-bin/:entity/:id', 'Records', 'Delete permanently (body: { confirm: "entity/id" })', 'session', { permission: 'recycle_bin.manage' }),
  r('get', '/api/institution/audit', 'Records', 'Audit trail: who changed what', 'session', { permission: 'audit.read', query: page.extend(auditQuery.shape), paginated: true }),
  r('get', '/api/group/overview', 'Group', 'Every institution of your group side by side', 'session', { permission: 'group.read' }),
  ...lmsRoutes(r),
];

const toOpenApiPath = (p: string) => p.replace(/:(\w+)/g, '{$1}').replace(/\*(\w+)/g, '{$1}');
const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    const params = [...route.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const query = route.query
      ? Object.entries((schema(route.query) as { properties?: Record<string, unknown> }).properties ?? {}).map(([name, s]) => ({ name, in: 'query', schema: s }))
      : [];
    const security = route.auth === 'public' ? [] : route.auth === 'cookie' ? [{ refreshCookie: [] }] : [{ bearer: [] }];
    paths[toOpenApiPath(route.path)] ??= {};
    paths[toOpenApiPath(route.path)]![route.method] = {
      tags: [route.tag],
      summary: route.summary,
      description: [
        route.permission && `Requires permission \`${route.permission}\`.`,
        route.auth === 'incomplete' && 'Also available while the account must still change its password or set up 2FA.',
        route.paginated && 'Paginated: `page`, `pageSize` (max 100); totals in `X-Total-Count`.',
        route.auth === 'cookie' && 'Uses the httpOnly refresh cookie and requires the `X-Acadex-Client: web` header.',
      ]
        .filter(Boolean)
        .join(' '),
      security,
      parameters: [...params, ...query],
      ...(route.body && { requestBody: { required: true, content: { 'application/json': { schema: schema(route.body) } } } }),
      responses: {
        200: { description: 'OK' },
        400: { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ...(route.auth !== 'public' && { 401: { description: 'Not signed in or session ended' }, 403: { description: 'Not allowed' } }),
        429: { description: 'Too many requests' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Acadex API',
      version: '0.2.0',
      description:
        'Every request is scoped to the caller’s institution (and enforced again by Postgres row-level security). Errors are `{ error, code?, details? }`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: '15-minute access token from /api/auth/login or /api/auth/refresh' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'acadex_rt' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' }, code: { type: 'string' }, details: {}, request_id: { type: 'string' } },
        },
      },
    },
    paths,
  };
}

/** A small HTML page rendering the spec (Scalar, from a pinned CDN version). */
export const docsHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acadex API</title></head>
<body><script id="api-reference" data-url="/api/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0/dist/browser/standalone.js" integrity="sha384-aYYa3Qxeo6+Z48D3AmUywxDcZRSrJHutGAgpJiBtkiofix52Px1F0p8tFptEbnNX" crossorigin="anonymous"></script></body></html>`;
