# 🎓 Acadex

> **AI-native learning platform and institute management** — one platform where institutions run admissions, teaching, attendance, grading, fees and family communication from their own secure, isolated workspace.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express%205-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RLS-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

<p align="center">
  <img src="preview.png" alt="Acadex preview" width="100%"/>
</p>

Acadex is being rebuilt in phases from a school-management app into an AI-native LMS and
institute ERP. See [CHANGELOG.md](CHANGELOG.md) for what each phase delivered.

## ✨ What's in it today

**Platform** — register institutions (each gets an invited administrator), plans, suspend /
reactivate, cross-tenant KPIs, platform audit log. **Groups** (school networks, university
systems) with a group administrator who sees every member institution.

**Any kind of institution** — school, school network, college, university, academy or
training center, each with its own words (Class / Batch / Cohort, Teacher / Instructor /
Trainer, Term / Semester / Intake…), grading (letter, percentage, GPA 4.0 / 5.0 with credit
hours, pass/fail, competency, custom bands) and term system — set up in minutes with the
onboarding guide.

**Structure** — campuses / branches → departments → programs → levels → sections, academic
years and terms, a holiday calendar that attendance and due dates respect, the course
catalog, offerings with co-teachers and TAs, open enrolment with capacity and a waitlist,
year-end promotion / graduation and archiving.

**People** — complete student records (guardians with per-guardian permissions, medical notes
behind their own permission, documents, custom fields, history), staff profiles with
teaching load, bulk import from CSV / Excel (OneRoster columns) with a dry run, bulk
invitations, ID cards with QR codes, leaving / character certificates and bonafide
letters with public verification, a recycle bin and a full audit trail.

**Institute office** — dashboards with a campus-by-campus comparison, announcements,
**custom roles & permissions** (also limited to one campus), invitations instead of shared
passwords.

**Fees & finance** — fee structures with instalments and late fines, discounts,
scholarships and automatic sibling discounts, invoices and part payments, vouchers with bank
details and a QR code, receipts, refunds and waivers; online payment with **Stripe,
JazzCash, Easypaisa and bank transfer / Raast** on each institution's own merchant account
(verified webhooks, applied once), pay links for families without an account, reminders in
the app, by email, SMS and WhatsApp, defaulters, reconciliation with the provider or a bank
statement, expenses, reports and Tally / QuickBooks exports; fees can be hidden from students.

**Exams** — secure online exams (access code, campus network only, full screen, no going
back, automatic hand-in), date sheets with a generator, seating plans, invigilation, admit
cards with eligibility, marks entry with teacher → head of department → controller approval
and moderation, published results with positions or SGPA, merit lists, result cards and a
verifiable transcript. **Outcome-based education**: CLOs, PLOs, mapping, attainment and
accreditation reports, skills transcripts.

**AI that coaches** — a tutor that answers from the course's own material with sources,
gives hints instead of answers (following each assignment's AI policy), and speaks Urdu; a
teacher copilot whose drafts (quizzes, rubrics, lesson plans, feedback, report comments,
"extend this by two days") are applied only on approval; grading suggestions kept as
drafts; evidence of how work was written instead of AI detection; nightly early-warning
scores with interventions; Ask Acadex for questions about your own data; captions; a help
assistant — with budgets, usage and cost, and off switches everywhere ([docs/ai.md](docs/ai.md)).

**Reach** — safeguarded messaging (guardians copied when a student under 18 is involved, a
review queue, reports, nothing deleted), SMS / WhatsApp / email / push with digests and
emergency broadcasts, parent–teacher meeting booking, a help desk, Zoom / Teams / Meet created
from Acadex, an installable app that works offline, low-bandwidth mode, and every screen in
Urdu and Arabic.

**Platform** — plans with limits, trials and self-serve sign-up, invoices with tax, card or
bank payment, usage and margin, white-label domains, data exports and account closing; Library,
HR & payroll, Transport, Hostel, Inventory and Visitors modules; reports with scheduled emails;
a REST API, webhooks, LTI 1.3, OneRoster and Google / Microsoft sign-in ([docs/platform.md](docs/platform.md)).

**Admissions** — branded online application forms with documents and an application fee,
an enquiry tracker with follow-ups, online or in-hall entrance tests, merit lists, offers
and a waiting list, and one-click enrolment with guardian and portal accounts.

**Courses (the LMS)** — a course space per offering: modules with drip release (by date,
after another module, or after reaching a score), rich pages with maths and code, files,
videos (YouTube / Vimeo / Loom / Drive), links, SCORM 1.2 / 2004 packages; progress and
"continue where you left off"; blueprints built once and pushed to every section.
Assignments with drafts and saved versions, group work, peer review, late policies,
extensions and accommodations, rubrics, feedback files (marked-up PDFs, audio and video
comments), draft vs released grades with a change history. Quizzes from shared question
banks (12 question types, random pools, timers, extra time), auto-marking, essay marking,
item analysis and regrading. A weighted gradebook (categories, drop lowest, excused /
missing, late penalties, overrides, lock, CSV / Excel export). Discussions with Q&A mode
and moderation, polls, anonymous course evaluations, live classes (Jitsi / Zoom / Meet /
Teams — joining marks attendance), course certificates with public verification, optional
badges and points. Import from Common Cartridge (Canvas, Blackboard, Schoology), Moodle
backups, QTI and Google Classroom; starter templates and open-resource libraries.

**Attendance & timetable** — registers per day or per class with "all present", working
offline on a phone and syncing later, rotating QR check-in, late minutes, leave requests
approved by the class teacher that mark the register, staff attendance, attendance
percentages with the exam-eligibility threshold and alerts. The bell schedule, rooms, a
timetable grid with clash checks, a generator, substitutions, and every week aware of
holidays.

**Every day** — role dashboards ("what to do today" for teachers, students, families and the
office), announcements by scope (institution, campus, section, course), my calendar with a
private feed for Google / Outlook / Apple Calendar, notifications in the app, by email and
by browser push with per-type choices and quiet hours, live updates without reloading.

**Foundation**
- 🔒 **Tenant isolation twice over** — every query is scoped in code *and* by Postgres
  row-level security, so a missed filter can't leak another institution's data
- 🔐 **Accounts** — invitations, password reset, email confirmation, authenticator-app 2FA
  with recovery codes (required for administrators in production), per-device sessions
  with rotating refresh tokens and "sign out other devices"
- 🧩 **RBAC** — permissions, built-in and custom roles; the UI shows exactly what a role may do
- 🌍 **Locale** — per-institution currency, timezone and locale; Urdu and Arabic UI with
  right-to-left layout; light / dark theme
- 📜 **API docs** generated from the same Zod schemas that validate requests (`/api/docs`)

Details: [docs/architecture.md](docs/architecture.md) · [docs/security.md](docs/security.md) ·
[docs/operations.md](docs/operations.md) · [docs/checklist.md](docs/checklist.md) (where every feature lives)

## 🚀 Getting started

Prerequisites: Node.js 22+, and PostgreSQL 16 — either a free [Neon](https://neon.tech)
database or the bundled Docker Compose stack.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL and JWT_SECRET (openssl rand -hex 32)

npm run db:migrate    # apply migrations (safe to re-run; never drops data)
npm run db:seed       # demo data (refused in production and on a non-empty database)
npm run dev           # API on http://localhost:5000, web app on http://localhost:3000
```

No Postgres at hand? `docker compose up -d` starts Postgres (with pgvector), MinIO and
Mailpit (catches every email at http://localhost:8025). Then use
`DATABASE_URL=postgres://acadex:acadex@localhost:5432/acadex`, `DATABASE_SSL=false`,
`MAIL_DRIVER=smtp`, `SMTP_URL=smtp://localhost:1025`.
`docker compose --profile app up --build` also runs the API and the web app (http://localhost:8080).

`npm run db:reset` wipes and reseeds the demo data (refused when `NODE_ENV=production`).
In development, emails (invitations, reset links) are written to the API log unless
`MAIL_DRIVER=smtp`.

### 🔑 Demo accounts (password: `Acadex@123`)
Seeded demo accounts only. People added in the app receive an invitation and choose their
own password.

Four institutions that each look native, plus the platform and a group:

| | Greenwood High School (school) | Sunrise Schools (3 branches) | Northfield University | Skillforge Academy (training) |
|---|---|---|---|---|
| Admin | `admin@greenwood.edu` | `admin@sunrise.edu` | `registrar@northfield.edu` | `admin@skillforge.edu` |
| Branch principal | | `principal.dha@sunrise.edu` (DHA only) | | |
| Teacher | `ali.sheikh.t0@greenwood.edu` | `ali.nadeem.t8@sunrise.edu` | `zainab.baig.t17@northfield.edu` | `zainab.shah.t25@skillforge.edu` |
| Student | `ali.butt.s0@greenwood.edu` | `ali.butt.s36@sunrise.edu` | `omar.baig.s88@northfield.edu` | `omar.baig.s112@skillforge.edu` |
| Parent | `parent1@greenwood.edu` | | | |

Platform admin: `superadmin@acadex.com` · Group admin (Greenwood + Sunrise): `group@acadex.com`

Try Phase 3 in the demo: sign in as `parent1@greenwood.edu` → **Fees** → **Pay** with the
**Test payment** provider (no money moves); Greenwood's public admission form is at
`/apply/greenwood/class-one-2027`; the office has a mid-term date sheet under **Exams office**
and learning outcomes for Class 9 mathematics under **Learning outcomes**.

## 🧪 Tests & checks
```bash
npm test          # API (embedded Postgres, no setup needed) and web unit tests
npm run typecheck
npm run lint
npm run build
npm run e2e       # browser tests: the full teacher → student journey on desktop and at 360 px
```
The end-to-end tests (Playwright) run against the dev servers (started automatically) and the
database in `apps/api/.env` with the demo data. First time: `npx playwright install chromium`.
Every endpoint has denial tests (cross-role, cross-teacher, cross-institution), and the
RLS suite checks isolation directly in the database as a non-superuser role. To use an
existing server instead of the embedded one, set `TEST_DATABASE_URL` to a **separate**
database. CI runs all of this plus a migrate-twice check, a backup-and-restore drill and
the Docker image builds.

## 📁 Project structure

```
apps/
  api/                 @acadex/api — Express 5 + TypeScript
    src/
      app.ts, server.ts, config.ts, openapi.ts
      auth/            sessions, refresh tokens, invitations, password reset, 2FA
      rbac/            permission catalogue, can(), requirePermission
      db/              Drizzle schema, migration runner, request context (RLS), seed
      lib/             access checks, audit, errors, mailer, pagination, locale, sentry
      middleware/      authentication
      routes/          auth, platform, institution, structure, settings, people, imports,
                       documents, yearend, records, roles, group, files, public, me, parent, pdf
      storage/         file storage drivers (local / S3), uploads, virus scanning
    drizzle/           migrations (generated, reviewed, forward-only)
    tests/             Vitest + Supertest, two-tenant fixture
  web/                 @acadex/web — React + Vite + TypeScript
    src/
      components/      design system (ui/), AppShell, dialogs
      lib/             api client, auth, i18n, formatting, theme, queries
      locales/         ur.json, ar.json
      pages/           auth, account, platform, admin, teacher, student, parent
packages/
  shared/              @acadex/shared — Zod schemas, permissions, constants, types
ops/                   backup / restore / restore-verification scripts
docs/                  architecture, security, operations
```

---

<p align="center">Built by <b>Syed Ibrahim Ali</b> — Full-Stack &amp; AI Engineer</p>
