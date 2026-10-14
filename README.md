# 🎓 Acadex

> **AI-native learning platform and institute management** — one platform where institutions run admissions, teaching, attendance, grading, fees and family communication from their own secure, isolated workspace.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express%205-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RLS%20%2B%20pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

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

**Institute office** — dashboards with a campus-by-campus comparison, fee collection with
vouchers, announcements, **custom roles & permissions** (also limited to one campus),
invitations instead of shared passwords.

**Teaching** — my classes, roster, keyboard-fast attendance (P / A / L), gradebook,
assignments. **Learning** — my grades, attendance, fees, assignments and submissions.
**Family** — linked children's progress, report cards.

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
[docs/operations.md](docs/operations.md)

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

## 🧪 Tests & checks
```bash
npm test          # API (embedded Postgres, no setup needed) and web unit tests
npm run typecheck
npm run lint
npm run build
```
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
