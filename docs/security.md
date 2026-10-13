# Security model

How the API decides who may do what, and the layers that back each decision up.

## Tenant isolation (two layers)

1. **In code.** Every query filters by the caller's `school_id`, and every id a client sends
   (`student_id`, `class_id`, `fee_id`, …) is checked to belong to that school — and, for
   teachers, parents and students, to their own classes / children / records
   (`apps/api/src/lib/access.ts`). Client-supplied tenant ids are never trusted.
2. **In Postgres.** Row-level security is enabled and **forced** on every tenant table.
   Policies compare `school_id` with `app_school_id()`, which reads the transaction-local
   setting `app.school_id`. Each request runs in its own transaction
   (`apps/api/src/db/context.ts`) that sets `app.school_id` / `app.user_id` from the
   verified session before any route code runs. A query that forgets its `school_id`
   filter therefore still sees only the caller's rows.
   - Platform operations and sign-in run in an explicit system context
     (`asSystem` / `runAsSystem`, setting `app.bypass_rls`), which is used only in audited
     places.
   - The app must connect as a role **without** `SUPERUSER` or `BYPASSRLS`; the test suite
     runs as such a role (`acadex_app`) and `tests/rls.test.ts` checks isolation directly in
     SQL.

## Sessions

- `POST /api/auth/login` returns a **15-minute access token** (JWT, HS256, audience
  `acadex:access`, claims: user id, token version, session id, school id) and sets the
  **refresh cookie** `acadex_rt` (httpOnly, `SameSite=Strict`, `Secure` in production,
  path `/api/auth`). The web app keeps the access token only in memory.
- `POST /api/auth/refresh` rotates the refresh token. Presenting an already-rotated token
  (a stolen copy) **revokes the whole session**. Refresh and logout also require the
  header `X-Acadex-Client: web`, which a cross-site form cannot send.
- Each session is a row in `sessions` (device, IP, last use); users see and revoke them on
  the Security page. Sessions expire after `SESSION_MAX_AGE_DAYS` regardless of use.
- On every request the user, their session and their school are re-read: a deactivated
  user, a revoked session, an old token version or a suspended school is refused
  immediately. Roles and school come from the database, never from the token.
- Password change, password reset and "sign out everywhere" revoke all other sessions.

## Accounts and passwords

- Nobody receives a password from someone else. Administrators **invite** people
  (single-use, 7-day link by email, also copyable to share by WhatsApp or print); the
  person sets their own password when accepting.
- Password reset and email confirmation use single-use, short-lived tokens stored only as
  SHA-256 hashes. Reset requests answer the same way whether or not the email exists.
- Password policy: at least 10 characters with letters and digits, bcrypt-hashed.
- **2FA** (authenticator app, TOTP) with 10 single-use recovery codes. Secrets are
  encrypted with `MFA_ENCRYPTION_KEY` (AES-256-GCM). With `ADMIN_MFA=required` (the
  production default), administrators can't use the app until they enrol
  (`MFA_ENROLLMENT_REQUIRED`).
- Seeded demo accounts share the documented demo password; seeding is refused when
  `NODE_ENV=production`.

## Permissions (RBAC)

Permissions (`packages/shared/src/permissions.ts`) are granted through roles. Built-in
roles (platform administrator, school administrator, teacher, student, parent) can't be
edited; schools can create **custom roles** from any non-platform permission and assign
several roles to a person. A school always keeps at least one administrator.

Routes declare `requirePermission('…')`. Relationship rules sit on top of permissions:

| Endpoint group | Permission | Extra checks |
|---|---|---|
| `/api/platform/*` | `platform.*` | — |
| `/api/school/*` | per route (`students.read`, `fees.manage`, …) | every referenced id must belong to the school |
| `/api/school/roles`, `/users/:id/roles` | `roles.manage` | only school roles; last-admin guard |
| `/api/me/teacher/*` | `teaching.access`, `attendance.mark`, `grades.enter`, `assignments.manage` | class (and subject) must be assigned to the teacher; every student must be enrolled in that class |
| `/api/me/student/*` | `learner.access`, `submissions.create` | own class's assignments only; http(s) links only |
| `/api/parent/*` | `guardian.access` | child must be linked to the parent |
| `/api/pdf/report-card/:id` | — | `records.read_any`, the student, a linked parent, or a teacher of the student's class |
| `/api/pdf/fee-voucher/:id` | — | `records.read_any`, the student, or a linked parent (not teachers) |

Every rule has a denial test (cross-role, cross-teacher, cross-school) in `apps/api/tests/`.

## Input, output and errors

- Bodies, params and query strings are validated with the shared Zod schemas; invalid
  input → 400 with field-level details. The same schemas generate the OpenAPI document.
- Every list is paginated (`page`, `pageSize` ≤ 100; total in `X-Total-Count`).
- Batch writes (attendance, grades) are all-or-nothing. A request's transaction is rolled
  back whenever the response is an error.
- One error handler maps database errors to generic 400/409 messages; internals go to the
  log (and Sentry, if configured — without bodies, cookies or auth headers).

## Rate limits

| What | Limit |
|---|---|
| Whole API | `API_RATE_LIMIT` per IP per minute (600) |
| Failed logins, 2FA codes, invitation accepts, reset confirms | `LOGIN_RATE_LIMIT` per IP + email per 15 min (10) |
| Password-reset requests | 5 per IP + email per 15 min |
| Email confirmation | 10 per IP per 15 min |

Unknown emails take as long to reject as wrong passwords.

## HTTP hardening

`helmet` headers, CORS allow-list (`CORS_ORIGINS`), 100 kB JSON limit, `TRUST_PROXY` for
real client IPs behind a proxy, verified TLS to the database (`DATABASE_SSL`), and startup
refuses unsafe configuration (missing `DATABASE_URL`, short `JWT_SECRET`, missing
`MFA_ENCRYPTION_KEY` in production). The API docs page has its own narrow CSP and loads a
pinned script with Subresource Integrity.

## Audit

Written to `audit_log` (actor, school, action, entity, time): accepting an invitation,
password reset, 2FA enabled / disabled, recovery-code use and regeneration; school
registration; admissions, new staff, re-sent invitations, classes, fee payments; custom
role create / edit / delete, role grants and revocations. Requests are additionally logged
with their request id.

## Database changes

Migrations live in `apps/api/drizzle/` and are applied once each by
`npm run db:migrate`, in a transaction, with checksums (editing an applied migration is an
error) and an advisory lock. Statements containing `DROP`/`TRUNCATE` are refused unless the
file is marked `-- acadex:reviewed-destructive`.

## Known gaps

- `users.email` is unique across the platform, so one person can't yet belong to two
  institutions with the same email (Phase 1).
- Not yet audited: sign-in and failed sign-in, refresh-token reuse, session revocation,
  password change, school plan/status changes. There is no school-facing audit log screen
  yet (the `audit.read` permission is reserved for it). Both are planned for Phase 1.
