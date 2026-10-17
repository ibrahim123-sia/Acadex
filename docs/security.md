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

## Campuses and groups

Role assignments have a scope: the platform, a group of institutions, an institution, or one
campus of it. A campus-scoped role (e.g. a branch principal) passes the permission check, and
then every list, profile and dashboard is filtered to its campuses; touching anything on
another campus — or with no campus — is refused (`lib/structure.ts`). Group administrators
read their group's institutions through an explicit, filtered system query.

## Soft delete and the recycle bin

Students, staff, guardians, sections, courses, programs, departments, campuses, documents and
files are soft-deleted. A restrictive RLS policy hides rows with `deleted_at` from every
query unless the request explicitly opts in (`withDeleted`: the recycle bin, restoring, and
the delete itself), so a forgotten filter can't resurrect deleted data. Deleting a person also
disables their sign-in; restoring re-enables it. Permanent deletion needs `recycle_bin.manage`
and an explicit confirmation, and removes the account and the files too.

## Files

Uploads are identified by their content (magic bytes), not the name or the browser's claim;
size-limited per purpose; images are re-encoded (dropping EXIF / GPS metadata); scanned when
`VIRUS_SCAN=clamav` (a scanner outage rejects uploads); counted against the institution's
quota. A file is only served to someone who may see what it belongs to (the student, a linked
guardian, a teacher of the class, or staff with the right permission and campus), with
`nosniff` and a sandboxing CSP; S3 downloads use 5-minute signed URLs.

## Public verification

`/api/public/verify/:code` (the QR code on ID cards and certificates) answers without
sign-in but only with: valid / revoked / expired, the institution, the document type and a
masked name ("Ali B."). Codes are 12 random characters; the endpoint has its own rate limit.

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

A database trigger writes every change to the important tables (institutions, campuses,
departments, programs, levels, years, terms, holidays, grading schemes, sections, courses,
offerings, staff assignments, enrolments, students, staff, guardians and their links, custom
fields, documents, ID cards, certificates, roles and grants, fees, promotions, users) to
`audit_log`: who (`app.user_id`), which request, the action, and the changed fields with
before / after values. Medical notes record only *which* fields changed; password hashes and
token versions never appear. Sign-ins, failed sign-ins (committed even though the request
fails), refresh-token reuse, session revocations, password and 2FA changes are recorded too.
Institutions read their own trail at `/api/institution/audit` (`audit.read`).

## Messaging and safeguarding

Who may message whom is decided on the server (`lib/conversations.ts`), never by the client:
teachers reach only their own students and those students' guardians; guardians only their
children's teachers (if allowed) and the office; students only their teachers (and
classmates if allowed). A private conversation between staff and one student under 18
(no birth date: schools count as minors) follows the institution's policy — blocked, copied
to the guardians (default) or allowed. Messages are never deleted: withdrawing or hiding one
removes it for members only. People with `messages.review` can read any conversation of
their institution; each read is written to the audit log. Profanity is masked and flagged;
self-harm language from a student notifies the safeguarding lead.

## Database changes

Migrations live in `apps/api/drizzle/` and are applied once each by
`npm run db:migrate`, in a transaction, with checksums (editing an applied migration is an
error) and an advisory lock. Statements containing `DROP`/`TRUNCATE` are refused unless the
file is marked `-- acadex:reviewed-destructive`.

## Platform access, API keys and secrets

Platform staff can sign in as an institution's administrator only when that institution allows
support access; the session lasts one hour, shows a banner and is written to both audit logs.
API keys are shown once and stored as SHA-256 hashes; webhook secrets and provider credentials
are sealed with AES-256-GCM and audited as "changed" without their values. Sensitive reads —
medical notes, transcripts, data exports — are audited.

A legacy commit from November 2024 (`e32c65f`, the old "Education Portal" before Acadex)
contains the password of a local SQL Server; the code was removed, but history is kept (no
force-push), so that password must be considered exposed and changed wherever it was used.

**On Cloudflare** ([cloudflare.md](cloudflare.md)) the app's secrets are stored with `wrangler secret put`
(encrypted in Cloudflare, never in `wrangler.jsonc` or the repository); GitHub holds only the deploy
token. The Worker strips `X-Forwarded-*` and `x-acadex-cron` from browser requests, sets the client IP
itself, and answers 404 for `/api/internal/*` from the internet; the cron endpoint also requires the
32+ character `CRON_SECRET` (compared in constant time) and does not exist without it.

## Known gaps

- `users.email` is unique across the platform, so one person can't yet belong to two
  institutions with the same email (Phase 1).
