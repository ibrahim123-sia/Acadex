<h1 align="center">Acadex</h1>

<p align="center">
  <b>The AI-native platform for running schools, colleges and universities</b><br>
  Admissions, teaching, attendance, exams, fees and family communication — for every kind of
  institution, each in its own secure, isolated workspace.
</p>

<p align="center">
  <a href="https://github.com/ibrahim123-sia/Acadex/actions/workflows/ci.yml"><img src="https://github.com/ibrahim123-sia/Acadex/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/PostgreSQL-row--level%20security-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL with row-level security">
  <img src="https://img.shields.io/badge/license-proprietary-lightgrey" alt="Proprietary license">
</p>

<p align="center">
  <img src=".github/assets/preview.png" alt="The Acadex dashboard" width="100%">
</p>

## Contents

- [Overview](#overview)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Testing and quality](#testing-and-quality)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Overview

Acadex is one platform for the whole life of an institution: from the first enquiry and the
admission form, through courses, attendance, exams and fees, to results, transcripts and
messages to families. It adapts to the kind of institution — a school speaks of classes and
terms, a university of programs, semesters and GPA, a training center of batches and
cohorts — and to its country, which sets the currency, time zone, number format and payment
methods.

AI is built in where it saves people time, always with a person in control: a tutor that
answers from the course's own material, a teacher copilot whose drafts are applied only on
approval, and early warnings for students who need help.

It serves five kinds of users — platform owner, institution or group administrators,
teachers, students and parents — each with their own dashboard and permissions.

## Features

| Area | What it covers |
| --- | --- |
| **Institutions** | Schools, school networks, colleges, universities, academies and training centers, each with its own vocabulary, grading (letter, percentage, GPA with credit hours, pass/fail, competency) and term system; groups that oversee several institutions; guided onboarding. |
| **Structure & people** | Campuses, departments, programs, levels and sections; academic years, terms and holidays; complete student records with guardians, medical notes and documents; staff profiles; bulk CSV / Excel import with a dry run; ID cards and certificates with QR verification; recycle bin and full audit trail. |
| **Courses (LMS)** | Modules with drip release, rich pages, files, video, SCORM 1.2 / 2004; assignments with versions, group work, peer review, rubrics and feedback; quizzes from question banks (12 question types, pools, timers, item analysis); a weighted gradebook; discussions, live classes and certificates; import from Common Cartridge, Moodle, QTI and Google Classroom. |
| **Attendance & timetable** | Registers by day or by class, offline on a phone; rotating QR check-in; leave requests; exam-eligibility thresholds and alerts; timetable generator with clash checks, rooms, substitutions and room bookings. |
| **Exams** | Secure online exams, date sheets, seating plans, admit cards, marks entry with approval and moderation, published results, merit lists, result cards and verifiable transcripts; outcome-based education (CLOs, PLOs, attainment). |
| **Fees & finance** | Fee structures with instalments, fines and discounts; invoices, vouchers and receipts; online payment on each institution's own merchant account — JazzCash and Easypaisa in Pakistan, Stripe elsewhere, bank transfer everywhere — with verified, idempotent webhooks; pay links for families without an account; reminders; reconciliation; expenses; Tally / QuickBooks export. |
| **Admissions** | Branded online application forms with documents and an application fee, an enquiry tracker, entrance tests, merit lists, offers and one-click enrollment. |
| **Communication** | Safeguarded messaging (guardians copied for students under 18), notifications in the app, by email and by browser push with quiet hours and digests, emergency broadcasts that also reach guardians without an account by email, parent–teacher meeting booking, a help desk and Zoom / Teams / Meet integration. |
| **AI** | Course-grounded tutor with citations, teacher copilot (quizzes, rubrics, lesson plans, feedback) applied only on approval, grading suggestions as drafts, writing-process evidence instead of AI detection, nightly early-warning scores, questions over your own data, captions — with budgets, usage and cost reporting and off switches at every level. The platform owner chooses the models (Gemini or Groq). |
| **Platform & modules** | Plans with limits, trials and self-serve sign-up; invoices with tax; usage and margin; white-label domains; data export and account closure; Library, HR & payroll, Transport, Hostel, Inventory and Visitors modules; scheduled reports. |
| **Integrations** | REST API with scoped keys, signed webhooks, LTI 1.3, OneRoster, Google and Microsoft sign-in, calendar feeds, OpenAPI documentation at `/api/docs`. |
| **Every day** | Role dashboards, announcements by scope, a personal calendar, live updates, an installable app that works offline, low-bandwidth mode, light and dark themes. |

## Tech stack

| Layer | Technology |
| --- | --- |
| API | Node.js 22, Express 5, TypeScript (strict), Zod, Drizzle ORM and SQL, pg-boss background jobs, Pino logging |
| Database | PostgreSQL 16 with row-level security on every tenant table |
| Web | React 18, Vite, Tailwind CSS 4, TanStack Query, React Router, React Hook Form |
| Shared | `@acadex/shared` — Zod schemas, permissions and types used by both the API and the web app |
| AI | Gemini and Groq behind one gateway with budgets, redaction and usage logging |
| Storage & email | Local disk, S3 or Cloudflare R2; SMTP (Mailpit in development) |
| Testing | Vitest and Supertest with embedded PostgreSQL, Playwright (desktop and 360 px), axe accessibility checks |
| Delivery | GitHub Actions, Docker, Cloudflare Workers and Containers |

## Getting started

**Prerequisites:** Node.js 22 (see `.nvmrc`) and PostgreSQL 16 — a free [Neon](https://neon.tech)
database or the Docker Compose stack in this repository.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL and JWT_SECRET (openssl rand -hex 32)

npm run db:migrate    # apply migrations (safe to re-run; never drops data)
npm run db:seed       # demo data (refused in production and on a non-empty database)
npm run dev           # API on http://localhost:5000, web app on http://localhost:3000
```

**With Docker:** `docker compose up -d` starts PostgreSQL, MinIO (S3-compatible storage) and
Mailpit (catches every email at http://localhost:8025). Then set
`DATABASE_URL=postgres://acadex:acadex@localhost:5432/acadex`, `DATABASE_SSL=false`,
`MAIL_DRIVER=smtp` and `SMTP_URL=smtp://localhost:1025`.
`docker compose --profile app up --build` also runs the API and the web app on
http://localhost:8080.

`npm run db:reset` wipes and reseeds the demo data (refused when `NODE_ENV=production`). In
development, emails are written to the API log unless `MAIL_DRIVER=smtp`.

### Demo accounts

Created by `npm run db:seed` for local development only; the password of every demo account is
`Acadex@123`. People added through the app receive an invitation and choose their own password.

| | Greenwood High School | Sunrise Schools (3 branches) | Northfield University | Skillforge Academy |
| --- | --- | --- | --- | --- |
| Admin | `admin@greenwood.edu` | `admin@sunrise.edu` | `registrar@northfield.edu` | `admin@skillforge.edu` |
| Branch principal | | `principal.dha@sunrise.edu` | | |
| Teacher | `ali.sheikh.t0@greenwood.edu` | `ali.nadeem.t8@sunrise.edu` | `zainab.baig.t17@northfield.edu` | `zainab.shah.t25@skillforge.edu` |
| Student | `ali.butt.s0@greenwood.edu` | `ali.butt.s36@sunrise.edu` | `omar.baig.s88@northfield.edu` | `omar.baig.s112@skillforge.edu` |
| Parent | `parent1@greenwood.edu` | | | |

Platform owner: `superadmin@acadex.com` · Group admin (Greenwood and Sunrise): `group@acadex.com`

To see online payments without moving money, sign in as `parent1@greenwood.edu`, open **Fees**
and pay with the **Test payment** provider. Greenwood's public admission form is at
`/apply/greenwood/class-one-2027`.

## Testing and quality

```bash
npm test              # API tests (embedded PostgreSQL, no setup needed) and web unit tests
npm run typecheck
npm run lint
npm run build
npm run e2e           # browser journeys on desktop and at 360 px (first: npx playwright install chromium)
npm run secrets:check # scan for credentials before committing
```

- Every endpoint has denial tests (another role, another teacher, another institution), and a
  row-level security suite checks isolation directly in the database as a non-superuser role.
- The end-to-end tests run against the dev servers and the database in `apps/api/.env` with the
  demo data. To run the API tests against your own server instead of the embedded one, set
  `TEST_DATABASE_URL` to a **separate** database.
- CI runs lint, typecheck, tests and build for every package, applies the migrations twice on an
  empty database, rehearses a backup and restore, smoke-tests the built server, builds the Docker
  images, validates the Cloudflare Worker, and runs gitleaks and `npm audit`.

## Deployment

- **Cloudflare** — a Worker serves the web app and forwards `/api` to the API running in a
  Cloudflare Container; files go to R2 and the database is PostgreSQL (for example Neon).
  Deploys run only by hand from GitHub Actions (**Deploy to Cloudflare**). Application secrets
  are set with `wrangler secret put` and never stored in the repository.
- **Search and link previews** — the build writes every public page (home, pricing, help
  articles, legal pages) as its own HTML file with its title, description, Open Graph and Twitter
  tags and structured data, so search engines and link previews (LinkedIn, WhatsApp, Slack) see
  them without running JavaScript. Set `SITE_URL` (for example `https://acadex.app`; a repository
  variable for the deploy workflow) to make canonical links and preview images absolute and to
  generate `sitemap.xml`. Pages behind sign-in are marked `noindex`.
- **Docker** — `apps/api/Dockerfile` and `apps/web/Dockerfile` build production images; the
  Compose `app` profile shows how they fit together.
- **Backups** — `ops/backup.sh` writes encrypted, checksummed database backups, and
  `ops/verify-restore.sh` proves a backup restores with matching row counts.

Migrations are applied on start-up, are forward-only and refuse destructive statements unless
they have been explicitly reviewed.

## Project structure

```
.
├── apps/
│   ├── api/                 @acadex/api — Express 5 + TypeScript
│   │   ├── src/
│   │   │   ├── ai/          AI gateway, model catalog, providers, prompts, tutor, knowledge base
│   │   │   ├── auth/        sessions, refresh tokens, invitations, two-step verification, SSO
│   │   │   ├── db/          Drizzle schema, migration runner, request context (RLS), seed
│   │   │   ├── jobs/        background job queue and registry
│   │   │   ├── lib/         domain logic: ledger, payments, notifications, webhooks, LTI, reports
│   │   │   ├── middleware/  authentication and permissions
│   │   │   ├── rbac/        permission catalog
│   │   │   ├── routes/      one router per area (institution, people, lms, finance, exams, ai …)
│   │   │   └── storage/     file storage drivers (local, S3, R2) and virus scanning
│   │   ├── drizzle/         generated, reviewed, forward-only migrations
│   │   └── tests/           Vitest + Supertest with a two-institution fixture
│   └── web/                 @acadex/web — React + Vite + TypeScript
│       └── src/
│           ├── components/  design system and application shell
│           ├── lib/         API client, auth, formatting, theme, queries
│           └── pages/       one folder per area and role
├── packages/
│   └── shared/              @acadex/shared — Zod schemas, permissions, constants, types
├── e2e/                     Playwright end-to-end tests
├── cloudflare/              Cloudflare Worker and wrangler configuration
├── ops/                     backup, restore and restore-verification scripts
├── scripts/                 repository tooling (credential scan)
└── .github/                 CI and deploy workflows, templates, code owners
```

## Security

Tenant isolation in code and in the database, bcrypt password hashing, rotating refresh tokens,
two-step verification (authenticator app or emailed code, required for administrators in
production), encrypted secrets at rest and credential scanning on every commit. To report a
vulnerability, see [SECURITY.md](SECURITY.md) — please do not open a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, commit conventions and the rules that
keep tenants' data safe. Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

Proprietary — copyright © 2024–2026 Syed Ibrahim Ali. All rights reserved. No use, copying or
distribution without written permission; see [LICENSE](LICENSE).

<p align="center"><sub>Built by <b>Syed Ibrahim Ali</b> — Full-Stack &amp; AI Engineer</sub></p>
