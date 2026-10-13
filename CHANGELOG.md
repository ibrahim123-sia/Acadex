# Changelog

## Phase 0B — Foundation (2026-10-13)

The platform underneath everything that follows. The demo data was reseeded (agreed data
reset); existing databases migrate forward without loss.

### Architecture
- npm-workspaces monorepo: `apps/api`, `apps/web`, `packages/shared` (Zod schemas,
  permissions, types shared by both). Root scripts: `dev`, `build`, `test`, `lint`,
  `typecheck`, `db:migrate`, `db:seed`, `db:reset`.
- API rewritten in strict TypeScript (ESM) on Express 5; pino structured logs with request
  ids; graceful shutdown; bundled with tsup.
- Drizzle schema with generated, reviewed, forward-only migrations (checksums, advisory
  lock, destructive-statement guard); pre-0B databases adopt the baseline automatically.
- Web app rewritten in TypeScript: TanStack Query, React Hook Form with the shared
  schemas, React Router 7, a design system with light/dark themes, lazy-loaded portals.

### Security
- **Postgres row-level security** on every tenant table, driven by a per-request
  transaction that sets the caller's school and user; tests run as a non-superuser role.
- **RBAC**: permissions, built-in and custom roles, multiple roles per person, scoped role
  assignments; every route declares the permission it needs; navigation follows permissions.
- **Sessions**: 15-minute access tokens, rotating refresh tokens in an httpOnly cookie with
  reuse detection, per-device session list and revoke, sign out everywhere.
- **Invitations** replace one-time passwords: people set their own password from an
  emailed (or shared) single-use link.
- Password reset, email confirmation, authenticator-app **2FA** with recovery codes
  (required for administrators in production).
- Extra rate limits on 2FA, invitation, reset and confirmation endpoints.
- Email outbox with `log` (development) and `smtp` drivers.

### Added
- Internationalisation: Urdu and Arabic (right-to-left) for the shell, sign-in and common
  UI; language and theme switchers.
- Security page (password, 2FA, recovery codes, signed-in devices), Roles & permissions
  page, role assignment per person, resend invitation, school suspend / reactivate.
- OpenAPI 3.1 generated from the Zod schemas at `/api/openapi.json`, browsable at
  `/api/docs`; a test fails when a route is undocumented.
- `/api/ready` readiness endpoint; Sentry error reporting for API and web (no request
  bodies, cookies or tokens).
- Docker Compose (Postgres + pgvector, MinIO, Mailpit; optional API + web), Dockerfiles,
  nginx config.
- `ops/backup.sh`, `ops/restore.sh`, `ops/verify-restore.sh`; CI runs a
  backup-and-restore drill, migrate-twice + seed, web unit tests and image builds.
- Docs: `docs/architecture.md`, `docs/operations.md`, updated `docs/security.md`.
- 343 API tests, 10 web unit tests.

### Removed
- The JavaScript `backend/` and `frontend/` folders (replaced by `apps/`).

### Known gaps (carried into Phase 1)
- Sign-in, refresh-token reuse, session revocation and school changes are not yet in the
  audit log; there is no school-facing audit screen.
- One email can belong to only one institution.
- PDFs do not render Urdu / Arabic yet.
- Tables still use `school` naming; Phase 1 generalises to institutions.
- No end-to-end browser tests yet.

## Phase 0A — Security & stability (2026-10-13)

Fixes to the existing app with no big refactor. Every item has a regression test that
failed before the fix.

### Security
- **All `/api/school/*` routes now require a school admin.** Previously any signed-in user,
  including students and parents, could read the whole student directory, fees, grades
  and attendance, and post announcements.
- `/api/me/teacher/*` and `/api/me/student/*` require the matching role.
- Teachers can only read rosters of, and write attendance, grades and assignments for,
  classes (and subjects) they are assigned to.
- Every `student_id` / `class_id` in a request must belong to the class and school; batches
  are all-or-nothing. Closes cross-tenant writes (attendance, grades, fees, admissions).
- Report cards and fee vouchers are only for the school admin, the student, a linked
  parent, and (report cards only) teachers of the student's class.
- Submissions only to own-class assignments; `javascript:`/`data:` links rejected.
- All self-service queries are scoped by `school_id`, not just `ref_id`.
- Sessions are checked against the database on every request (deactivation, suspension and
  role changes apply immediately); logout revokes tokens; tokens last 12 h instead of 7 days.
- Failed-login rate limiting, API rate limit, helmet, CORS allow-list, body size limit,
  verified TLS to the database, config validated at startup.
- No more shared default password: one-time passwords + forced change at first sign-in;
  school admin passwords are random instead of `Acadex@` + 4 clock digits.
- Async route errors no longer crash the process; error responses no longer leak
  database messages.
- Dependency audit fixes (express 4.22.3, path-to-regexp, proxy-addr, qs, body-parser).

### Fixed
- `npm start` works on case-sensitive hosts (`Server.js` → `server.js`).
- `migrate` no longer drops every table: versioned, forward-only migrations.
- `seed` refuses production and non-empty databases unless `--reset`.
- Currency, timezone and locale are per school (was hard-coded PKR / UTC dates);
  platform revenue is reported per currency.
- DATE columns no longer shift by a day between server and school timezones.
- Lists are paginated instead of silently cut at 30/50/60/100 rows; unread notification
  count is correct beyond 30.
- Parents were sent back to the login page after signing in.
- Fee totals on the Fees page covered only the loaded rows.

### Added
- `npm run db:migrate | db:seed | db:reset | test | lint`; `.env.example` files.
- Change-password page; one-time credentials notice with copy button.
- Vitest + Supertest suite (275 tests) on an embedded Postgres; ESLint; GitHub Actions CI.
- `docs/security.md`.

### Removed
- Unused dependencies (mssql, msnodesqlv8, tedious, body-parser, multer).
- Legacy SQL Server backup and query files; Create React App leftovers.
