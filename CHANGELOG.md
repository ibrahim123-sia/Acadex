# Changelog

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
