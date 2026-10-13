// OpenAPI 3.1 description of the API, generated from the same Zod schemas the routes
// validate with. Every route must be listed here (tests/openapi.test.ts checks it).
import { z } from 'zod';
import {
  acceptInviteBody,
  announcementBody,
  assignRoleBody,
  assignmentBody,
  attendanceBody,
  changePasswordBody,
  collectFeeBody,
  createClassBody,
  createRoleBody,
  createSchoolBody,
  createStudentBody,
  createTeacherBody,
  gradesBody,
  loginBody,
  mfaCode,
  mfaDisableBody,
  mfaEnableBody,
  mfaVerifyBody,
  pageQuery,
  passwordResetBody,
  passwordResetRequestBody,
  rosterQuery,
  studentSearchQuery,
  submissionBody,
  updateRoleBody,
  updateSchoolBody,
  verifyEmailBody,
  type Permission,
} from '@acadex/shared';

type Method = 'get' | 'post' | 'patch' | 'delete';
type Auth = 'public' | 'session' | 'incomplete' | 'cookie';

export interface RouteDoc {
  method: Method;
  path: string; // Express style (/schools/:id)
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
  r('get', '/api/auth/me', 'Auth', 'The signed-in user and school', 'incomplete'),
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
  r('get', '/api/platform/stats', 'Platform', 'Platform KPIs', 'session', { permission: 'platform.schools.read' }),
  r('get', '/api/platform/schools', 'Platform', 'All schools', 'session', { permission: 'platform.schools.read', query: page, paginated: true }),
  r('post', '/api/platform/schools', 'Platform', 'Register a school (invites its administrator)', 'session', { permission: 'platform.schools.manage', body: createSchoolBody }),
  r('patch', '/api/platform/schools/:id', 'Platform', 'Change plan, status or locale', 'session', { permission: 'platform.schools.manage', body: updateSchoolBody }),
  r('get', '/api/platform/audit', 'Platform', 'Platform audit log', 'session', { permission: 'platform.audit.read', query: page, paginated: true }),

  // ---------- school office ----------
  r('get', '/api/school/dashboard', 'School', 'Dashboard', 'session', { permission: 'school.dashboard.read' }),
  r('get', '/api/school/students', 'School', 'Student directory', 'session', { permission: 'students.read', query: page.extend(studentSearchQuery.shape), paginated: true }),
  r('post', '/api/school/students', 'School', 'Admit a student (emails an invitation)', 'session', { permission: 'students.manage', body: createStudentBody }),
  r('get', '/api/school/teachers', 'School', 'Staff directory', 'session', { permission: 'staff.read', query: page, paginated: true }),
  r('post', '/api/school/teachers', 'School', 'Add a teacher (emails an invitation)', 'session', { permission: 'staff.manage', body: createTeacherBody }),
  r('post', '/api/school/users/:userId/invite', 'School', 'Send a new invitation', 'session', { permission: 'staff.manage' }),
  r('get', '/api/school/classes', 'School', 'Classes', 'session', { permission: 'classes.read', query: page, paginated: true }),
  r('post', '/api/school/classes', 'School', 'Create a class', 'session', { permission: 'classes.manage', body: createClassBody }),
  r('get', '/api/school/fees', 'School', 'Fee records', 'session', { permission: 'fees.read', query: page, paginated: true }),
  r('get', '/api/school/fees/summary', 'School', 'Fee totals', 'session', { permission: 'fees.read' }),
  r('post', '/api/school/fees', 'School', 'Record a fee payment', 'session', { permission: 'fees.manage', body: collectFeeBody }),
  r('get', '/api/school/grades', 'School', 'All grades', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/school/attendance', 'School', 'All attendance', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/school/timetable', 'School', 'Timetable', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/school/exams', 'School', 'Exam schedule', 'session', { permission: 'academics.read', query: page, paginated: true }),
  r('get', '/api/school/announcements', 'School', 'Announcements', 'session', { permission: 'announcements.read', query: page, paginated: true }),
  r('post', '/api/school/announcements', 'School', 'Publish an announcement', 'session', { permission: 'announcements.manage', body: announcementBody }),

  // ---------- roles ----------
  r('get', '/api/school/permissions', 'Roles', 'Permissions a school role can hold', 'session', { permission: 'roles.manage' }),
  r('get', '/api/school/roles', 'Roles', 'Built-in and custom roles', 'session', { permission: 'roles.manage' }),
  r('post', '/api/school/roles', 'Roles', 'Create a custom role', 'session', { permission: 'roles.manage', body: createRoleBody }),
  r('patch', '/api/school/roles/:id', 'Roles', 'Edit a custom role', 'session', { permission: 'roles.manage', body: updateRoleBody }),
  r('delete', '/api/school/roles/:id', 'Roles', 'Delete a custom role', 'session', { permission: 'roles.manage' }),
  r('get', '/api/school/users/:userId/roles', 'Roles', "A person's roles", 'session', { permission: 'roles.manage' }),
  r('post', '/api/school/users/:userId/roles', 'Roles', 'Grant a role', 'session', { permission: 'roles.manage', body: assignRoleBody }),
  r('delete', '/api/school/users/:userId/roles/:roleId', 'Roles', 'Revoke a role', 'session', { permission: 'roles.manage' }),

  // ---------- teaching ----------
  r('get', '/api/me/teacher/overview', 'Teaching', 'Teacher home', 'session', { permission: 'teaching.access' }),
  r('get', '/api/me/teacher/students', 'Teaching', 'Students in my classes', 'session', { permission: 'teaching.access' }),
  r('get', '/api/me/teacher/classes', 'Teaching', 'My classes', 'session', { permission: 'teaching.access' }),
  r('get', '/api/me/teacher/class/:classId/roster', 'Teaching', 'Class roster with the day’s attendance', 'session', { permission: 'teaching.access', query: rosterQuery }),
  r('post', '/api/me/teacher/attendance', 'Teaching', 'Save attendance for a class and day', 'session', { permission: 'attendance.mark', body: attendanceBody }),
  r('post', '/api/me/teacher/grades', 'Teaching', 'Enter grades (all or nothing)', 'session', { permission: 'grades.enter', body: gradesBody }),
  r('get', '/api/me/teacher/assignments', 'Teaching', 'My assignments', 'session', { permission: 'teaching.access', query: page, paginated: true }),
  r('post', '/api/me/teacher/assignments', 'Teaching', 'Set an assignment for a class', 'session', { permission: 'assignments.manage', body: assignmentBody }),

  // ---------- learning / family / everyone ----------
  r('get', '/api/me/student/overview', 'Learning', 'Student home', 'session', { permission: 'learner.access' }),
  r('get', '/api/me/student/assignments', 'Learning', 'My assignments', 'session', { permission: 'learner.access', query: page, paginated: true }),
  r('post', '/api/me/student/submissions', 'Learning', 'Hand in an assignment', 'session', { permission: 'submissions.create', body: submissionBody }),
  r('get', '/api/me/announcements', 'Everyone', 'Announcements addressed to me', 'session', { permission: 'announcements.view', query: page, paginated: true }),
  r('get', '/api/me/notifications', 'Everyone', 'My notifications', 'session', { query: pageQuery(20) }),
  r('post', '/api/me/notifications/read-all', 'Everyone', 'Mark all notifications read', 'session'),
  r('get', '/api/parent/children', 'Family', 'My children', 'session', { permission: 'guardian.access' }),
  r('get', '/api/parent/child/:id/overview', 'Family', "A child's overview", 'session', { permission: 'guardian.access' }),
  r('get', '/api/pdf/report-card/:studentId', 'Documents', 'Report card (PDF)', 'session'),
  r('get', '/api/pdf/fee-voucher/:feeId', 'Documents', 'Fee voucher (PDF)', 'session'),
];

const toOpenApiPath = (p: string) => p.replace(/:(\w+)/g, '{$1}');
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
