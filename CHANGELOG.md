# Changelog

## Phase 5 — Reach and communication (2026-10-17)

Acadex reaches every family, on any phone, in their language — safely.

- **Messaging with safeguarding**: teachers ↔ their students and those students' guardians,
  guardians ↔ their children's teachers, staff ↔ staff, class groups. A private conversation
  between staff and a student under 18 is blocked, copied to the guardians (the default) or
  allowed — the institution decides. Bad language is masked and flagged (English, Roman
  Urdu, Urdu, Arabic), a student in distress alerts the safeguarding lead, anyone can report
  a message, and the safeguarding team reviews, hides and locks — every conversation is kept
  and every review read is recorded.
- **Notifications everywhere**: SMS and WhatsApp alongside the app, email and push (per person,
  where the institution allows it), daily or weekly email digests, emergency broadcasts that
  reach everyone at once — including guardians without an account, by SMS — and delivery
  logs with automatic and one-click retries.
- **Parent–teacher meetings**: plan a meeting day and every teacher of the chosen classes gets
  slots; families book one per teacher per child (online rooms for online days); teachers
  block slots and record outcomes. Students can book office hours where allowed.
- **Help desk**: complaints, feedback (optionally anonymous) and requests with assignment,
  internal notes, due times by priority, reopening on reply and a satisfaction rating.
- **Live classes on your own accounts**: Acadex creates the meeting on the institution's Zoom,
  Microsoft Teams or Google Meet; Zoom reports joins (attendance) and cloud recordings.
- **Works on any phone**: an installable app (PWA) that opens offline, keeps dashboards and
  saved pages / files on the device, and a low-bandwidth mode (no autoplay, media on request,
  smaller photo uploads) that turns on by itself with the browser's data saver.
- **Urdu and Arabic everywhere**: every screen translated (2,263 strings, right-to-left), the
  language kept on the account, and a test that fails on any untranslated string.
- **Accessibility**: an automated WCAG 2.2 AA audit (axe-core) of every main page in English
  and Urdu, with the issues it found fixed; captions for course videos.

## Phase 4 — The AI layer (2026-10-16)

AI that helps people learn instead of doing the work for them — every feature can be switched
off, logs its usage and cost, labels its output, and changes nothing until a person approves.
Details: [docs/ai.md](docs/ai.md).

- **Foundation**: Anthropic, OpenAI, Gemini and Groq behind one interface, a model per
  feature, an institution's own key, usage and cost per call, monthly budgets with a hard cap,
  off switches per server / institution / feature / course / assessment, an admin page that
  shows which model does what and what it costs.
- **Course knowledge base**: pages, PDFs, Word files, assessment briefs and transcripts,
  indexed incrementally for search and the tutor.
- **Coach-don't-answer tutor**: grounded in the course and cited, Socratic, follows each
  work's AI policy, safer for under-18s, answers in Urdu or Arabic too, streams; teachers see
  anonymous stuck points.
- **Teacher copilot** (approve before apply): quiz questions tagged with difficulty and CLO,
  rubrics, course outlines, lesson plans, easier / harder / translated versions, feedback
  drafts, report-card comments, guardian messages, plain-language bulk actions.
- **Grading assistant**: rubric scores with reasoning, saved only as drafts marked
  AI-assisted.
- **Learning-process evidence**: drafts, writing time, pasting, similarity within the class,
  "explain your work" mini-viva — never an AI-detection percentage.
- **Early warning**: nightly explainable risk scores, at-risk list, interventions, guardian
  alerts, suggested next steps.
- **Ask Acadex**: questions about your own data answered with a read-only query you can see.
- **Help assistant** and help center; **captions and translations** for course videos.
- **Safety**: moderation in English, Urdu and Arabic, prompt-injection and answer-leak guards,
  personal data removed before sending, and an eval suite of 116 cases in CI.
- **Fix**: course materials, submissions, feedback files and SCORM packages could not be saved
  (the files purpose check was too narrow); migration 0018.

## Phase 3 — Exams, finance and admissions (2026-10-16)

A full fee cycle (invoice → online payment → receipt → reconciliation) and a full exam cycle
(date sheet → marks → approvals → published results) work end to end, in API tests and in
the browser. The old `tuition_fee` and `exam_schedule` records were moved into invoices /
payments and exam series / papers by migration 0014 before those tables were dropped.

### Fees and finance
- Fee structures per year, campus, program and level: fee heads charged every instalment or
  once, instalments with due dates, late fines (once, or per day with a cap and grace days).
- Discounts, scholarships and waivers (percent or amount, on chosen heads); sibling
  discounts applied automatically from the n-th child of the same guardian.
- Invoices generated once per student and instalment (with a preview), one-off invoices,
  adjustments, cancellations; payments by cash, bank or cheque with receipts; part
  payments; refunds (at the provider too for online payments).
- Online payment through each institution's own merchant account: **Stripe** (checkout +
  signed webhooks), **JazzCash** (hosted checkout, secure hash on the form and the return),
  **Easypaisa** (hosted checkout, confirmed with the inquiry API), **bank transfer / Raast**
  (bank details and the invoice number as reference), and a test provider. Keys are stored
  encrypted; webhooks are verified and applied exactly once.
- Pay links for payers without an account (on vouchers, in reminders, for applicants);
  voucher PDFs with bank details and a QR code; receipt PDFs; student statements.
- Defaulters with guardians' phone numbers; reminders before and after the due date in the
  app, by email, SMS and WhatsApp (Twilio or the WhatsApp Cloud API), sent once per step;
  a daily job charges late fines and sends the day's reminders.
- Reconciliation against provider settlements or an uploaded bank statement (CSV / Excel);
  expenses; income and expense report; collections; Tally XML and QuickBooks CSV exports.
- Fee visibility: hide fees from students; guardians see them when their link allows.

### Exams
- Secure exam mode for online quizzes and exams: an access code given out in the room (kept
  as a keyed hash), a campus-network allowlist, full screen with every exit logged, copy /
  paste blocked, an automatic hand-in after leaving the exam too often, one question at a
  time with no going back (enforced by the server), and a hook for a proctoring service.
- Exam series with a date-sheet generator (one paper a day per class, shared courses on the
  same day, holidays skipped) and clash checks per student.
- Seating plans that mix papers across rooms by capacity, seating charts, invigilation duties
  (automatic: fewest duties first, never one's own subject; clash-checked).
- Admit cards with eligibility (attendance threshold, overdue fees), an office override, and
  a verification QR code.
- Marks entry grid for the paper's teacher, then head of department, then exam controller;
  grace and scaling moderation with a log; return for correction.
- Publishing into the gradebook (and withdrawing), results with class positions (board
  style) or SGPA (university style), merit lists, Excel export, result cards and a
  verifiable transcript with SGPA per term and CGPA.

### Outcome-based education
- Program (PLO) and course (CLO) outcomes with Bloom levels, the CLO → PLO matrix, and
  alignment of assessments, questions, rubric criteria and paper exams to CLOs.
- Attainment per student, class and program; accreditation reports (Excel / PDF); each
  student's mastery view and skills transcript.

### Admissions
- Public, branded application forms with custom questions, documents and an application
  fee; a private link for each applicant (status, documents, fee, test, offer).
- Entrance tests in a hall (scores entered) or online (drawn from a question bank,
  auto-marked, timed); merit lists weighting test and interview; offers with an expiry and a
  waiting list; applicants accept or decline online.
- One-click enrolment: student, guardian (an existing one is reused so siblings link) and
  portal invitations.
- Enquiries with sources, follow-ups and next follow-up dates, linked to later applications.

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
