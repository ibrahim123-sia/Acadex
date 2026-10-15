# Changelog

## Phase 2 — The LMS core (2026-10-15)

A teacher can build a course, set work, collect it, grade it and release the grades, and a
student can work through the course and hand everything in — on a computer or a phone.
The old assignments, marks, day attendance and free-text timetable were moved into the new
model by migration 0011 (nothing was lost; the old tables were dropped afterwards).

### Course space
- Modules with drip release: on a date, after finishing another module, or after reaching a
  score in it; students see why something is locked.
- Rich pages (headings, lists, links, quotes, code, maths with KaTeX), files (PDF viewer,
  images, audio, video), videos from YouTube / Vimeo / Loom / Google Drive, links, SCORM
  1.2 / 2004 packages and live classes. Everything is sanitised on the server.
- Progress per item ("opens it" or "marks it done"), a progress bar, "continue where you
  left off", previous / next.
- Blueprints: build a course once (or copy one), copy it into many sections, push later
  changes — what a section changed itself is kept.
- Starter templates (weekly course, school units, bootcamp) and a list of open educational
  resource libraries.

### Work and grading
- Assignments, quizzes, exams, projects and participation, with points, open / due / close
  dates (a due date on a holiday is refused with the next open day suggested), categories,
  rubrics, group work, peer review, an AI-help policy, and "release grades when I say" or
  "as soon as each is graded".
- Hand-in as text, files, links, audio or video; drafts; every save kept as a version;
  resubmission up to the allowed attempts; late work allowed, penalised per day or refused;
  per-student or per-group extensions; standing accommodations (extra time).
- Grading one student after another with the rubric, points, feedback, feedback files
  (marked-up PDFs, audio and video comments) and annotations; drafts stay hidden until
  released; changing a released grade needs a reason and is kept in the history; "mark
  missing work".
- Question banks shared by every section of a course; 12 question types (one answer,
  several answers, true/false, short answer, numeric with tolerance, formula with values per
  student, essay, matching, ordering, fill in the blanks, file upload, audio); random pools
  by tag; shuffling; time limits with extra time; attempts; answers saved as you go; focus
  changes reported to the teacher; essay marking; item analysis; regrade (rescore or full
  marks).
- Gradebook: weighted categories (scaled when they don't add up to 100), drop lowest,
  excused and missing work, late penalties, course grade on the student's grading scheme,
  hand-set overrides with a reason, locking (only an administrator unlocks), CSV and Excel
  export. Students and parents see released grades only. Report cards use it.

### Attendance and timetable
- Registers for the whole day (schools) or per class (colleges), one tap per student,
  "all present", late minutes, offline queue on the phone that sends itself when back
  online, rotating QR check-in (the code changes every 20 seconds), joining a live class
  marks the student present.
- Leave requests from students, parents and staff; the class teacher (or the office)
  approves; approved leave shows on the register and replaces absences; staff leave marks
  staff attendance.
- Attendance percentage (present and late count; excused and leave don't), the threshold
  (75% unless the institution sets another), per-course eligibility, alerts to the student,
  guardians and class teacher, and a same-day note to guardians when a child is absent.
- Bell schedule, rooms, the timetable grid with clash checks in plain words (section,
  teacher, room), teacher unavailability, an automatic generator (spreads a course over the
  week), substitutions with a list of free teachers, and weeks that hide holidays.

### Communication
- Role dashboards: what to do today for teachers (classes, registers, marking), students
  (due work, classes, progress), families (each child's day, attendance, grades, fees) and
  the office (registers taken, low attendance, leave waiting).
- Discussions with Q&A mode (answer first, then see the others), replies, hiding posts,
  locking and pinning; quick polls; anonymous surveys and course evaluations (no breakdown
  under three answers).
- Announcements to the whole institution, a campus, a section or a course.
- Notifications in the app, by email and by browser push, chosen per type, with quiet
  hours; delivery is logged; open tabs update live.
- My calendar (work due, live classes, holidays) and a private feed link for Google,
  Outlook and Apple calendars.
- Course certificates issued automatically when progress and grade conditions are met,
  verifiable by QR; optional badges, points and a course leaderboard.

### Content import
- IMS Common Cartridge (Canvas, Blackboard, Schoology exports), Moodle backups (.mbz), QTI
  1.2 / 2.x question files, Google Classroom (behind a provider; needs the institution's
  Google Workspace connection — a fake provider is used in tests). Imported content arrives
  unpublished.
- SCORM packages play sandboxed; a minimal xAPI statement store.

### Platform
- Background jobs on pg-boss (in PostgreSQL; queued in the same transaction as the work);
  a separate worker process is optional. The recycle bin now empties itself after 30 days.
- Live events over PostgreSQL LISTEN / NOTIFY and server-sent events.
- New permissions: `courses.manage_any`, `blueprints.manage`, `attendance.manage`,
  `leave.request`, `leave.approve`, `timetable.manage`, `surveys.manage`,
  `gamification.manage`, `content.import`.
- Fixed: editing a record with only some fields (PATCH) could reset fields that have a
  default (e.g. a campus address when renaming it).

### Known gaps
- Exams-office features (secure exam mode, paper exams, results and transcripts, outcomes)
  come in Phase 3.
- The rich-text editor is a light contentEditable editor, not a block editor; tables and
  images are kept when imported or pasted but can't be inserted from the toolbar yet.
- Annotations are stored and listed; drawing them on a PDF in the browser comes later.
- Video uploads are kept as files; there is no transcoding or streaming provider yet.
- Google Classroom needs OAuth with the institution's Google Workspace (not configured).
- QR scanning uses the browser's built-in barcode detector (Chrome, Edge, Android);
  elsewhere students type the code.
- Pages are slow against a far-away database (~0.25 s per round trip to Neon); deploy the
  API next to the database.

## Phase 1 — Universal structure & people (2026-10-14)

Acadex now fits any kind of institution. The four demo tenants each look native: a school,
a three-branch school network, a university and a training academy. Existing data was
migrated in place (classes → sections, subjects → courses + offerings, parent links →
guardians).

### Institutions and structure
- Institution types (school, network, college, university, academy, training center) with
  smart defaults: terminology, grading, term system and program templates; an onboarding
  guide applies them.
- Groups → institutions → campuses / branches → departments → programs → levels → sections.
  Academic years and terms (annual, semester, trimester, quarter, rolling), one current
  year, archived years read-only.
- Holiday calendar per institution or campus; attendance and due dates refuse closed days
  (with the next open day suggested) and honour working days.
- Course catalog with credit hours; offerings per term for a whole section or open
  enrolment with capacity and an automatic waitlist; teachers, co-teachers and TAs.
- Grading schemes: percentage, letter, GPA 4.0 / 5.0 (credit-weighted), pass/fail,
  competency, custom bands; one default, per-program override; report cards use them.
- Terminology packs with per-institution overrides, used across the web app.
- Year end: promotion preview, next year's classes created automatically, promote / repeat
  / graduate / leave in one transaction, batches move up a level, archive the year.

### People
- Student records: profile, photo, multiple guardians with per-guardian permissions (grades,
  fees, messages; the parent portal and PDFs obey them), medical notes behind their own
  permission, documents, custom fields, enrolments, promotion history, change history.
- Staff profiles: teaching / non-teaching, designation, campus, department, employment,
  documents, and teaching load (courses, credit hours, periods, class-teacher duties).
- Bulk import of students, staff, guardians, courses and enrolments from CSV / Excel
  (OneRoster column names work), dry run row by row, all-or-nothing or skip bad rows,
  upserts, templates; bulk invitations.
- ID cards (students and staff) printable on A4 sheets with photo and QR; leaving /
  character certificates and bonafide letters from editable templates with serial
  numbers; public verification by QR with a masked name only; revocation.
- Soft delete with a recycle bin (restore, or delete permanently with confirmation) and a
  full audit trail of who changed what (database trigger), now also covering sign-ins,
  failed sign-ins, token reuse, session revocation and password changes.

### Platform
- Campus-scoped roles (e.g. a branch principal sees and runs one branch); the dashboard
  compares campuses side by side; group administrators see every institution of their group.
- File storage behind local / S3 drivers: content-checked uploads, size limits, image
  re-encoding (EXIF stripped), ClamAV hook, per-institution quota, permission-checked
  downloads.
- `schools` → `institutions` throughout (API under /api/institution); a schema-drift test
  keeps the TypeScript schema and the migrations identical.
- Faster requests: the dashboard is one query; attendance and grade batches are single
  statements.

### Tests
426 API tests (75 new, with denial tests for roles, campuses and institutions), 8 shared,
12 web; migration backfill tested from the old shape.

### Known gaps (carried forward)
- The timetable does not yet hide holidays (timetable is rebuilt in Phase 2).
- Term-by-term CGPA and transcripts come with results in Phase 3.
- Recycle-bin entries are not purged automatically after 30 days yet (needs the job runner,
  Phase 2); purging is manual.
- Excel import is implemented but only CSV is covered by tests.
- One email can belong to only one institution; PDFs do not render Urdu / Arabic yet.
- Subdomain / custom-domain tenant resolution is Phase 6. No browser end-to-end tests yet.
- Requests from far away are slow (several sequential round trips per request); deploy the
  API next to the database.

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
