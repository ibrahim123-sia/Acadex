# 🎓 Acadex

> **A multi-tenant School Management SaaS** — one platform where a super admin onboards schools, and each school runs admissions, attendance, grading, fees and analytics from its own secure, isolated workspace.

![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![JWT](https://img.shields.io/badge/Auth-JWT%20%2B%20bcrypt-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)

**Acadex** is a full-stack, multi-tenant SaaS for schools. A **Super Admin** registers schools onto the platform; each school then gets its own **School Admin, Teacher and Student** portals with fully isolated data (row-level `school_id` scoping). Built on PostgreSQL with a secure, parameterized data layer, JWT + bcrypt authentication, and real-time analytics dashboards.

<p align="center">
  <img src="preview.png" alt="Acadex preview" width="100%"/>
</p>

## ✨ Features

**Platform (Super Admin)**
- Onboard/register new schools (tenants) with branding, plan (Free / Pro / Enterprise) and status
- Cross-tenant KPIs: total schools, students, teachers, revenue collected
- Suspend / reactivate schools; platform-wide audit log

**School Admin**
- Dashboard with live KPIs, fee-status donut chart, students-by-class bar chart, and recent admissions
- Student directory with instant search; faculty directory; class sections with enrolment counts
- Fee management — collected vs outstanding, per-student receipts and payment status
- Announcements targeted to All / Teachers / Students

**Teacher & Student portals**
- Teacher: assigned classes/subjects, student roster, role-targeted announcements
- Student: personal grades, attendance percentage, and fee status at a glance

**Parent portal**
- Linked children with grades, attendance and fee status; report-card PDF

**Platform-wide**
- 🔒 **Multi-tenancy** — every record carries a `school_id`, and every query is scoped to the caller's school
- 🔐 **Security** — role checks on every route, ownership checks on every id a client sends, revocable sessions, one-time passwords for new accounts, login rate limiting, validated input (Zod) and parameterized SQL. See [docs/security.md](docs/security.md)
- 🌍 **Per-school locale** — currency, timezone and locale per school (fees, PDFs and "today" follow the school, not the server)

## 🏗️ Architecture

```
Super Admin ──registers──▶ School (tenant)
                              ├── School Admin ──▶ students, teachers, classes, fees, announcements
                              ├── Teacher       ──▶ own classes: roster, attendance, grades, assignments
                              ├── Student       ──▶ own grades, attendance, fees, submissions
                              └── Parent        ──▶ linked children only
```
Shared PostgreSQL database with isolation via `school_id` (cost-efficient on serverless Postgres such as Neon).

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, Tailwind CSS 4, Recharts, Axios, lucide-react |
| Backend | Node.js, Express 4, `pg` (parameterized queries), Zod, helmet, express-rate-limit, PDFKit |
| Database | PostgreSQL (Neon serverless), versioned forward-only migrations |
| Auth | JWT (12 h, revocable via `token_version`) + bcrypt, role-based middleware |
| Quality | Vitest + Supertest (embedded Postgres), ESLint, GitHub Actions |

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ (22 recommended)
- A PostgreSQL database. The easiest free option is **[Neon](https://neon.tech)** — create a project and copy the connection string.

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env      # then set DATABASE_URL and JWT_SECRET (openssl rand -hex 32)

npm run db:migrate        # apply migrations (safe to re-run; never drops data)
npm run db:seed           # demo data — refuses if the database already has data
npm run dev               # API on http://localhost:5000 (npm start in production)
```
`npm run db:reset` wipes the tenant tables and reseeds the demo data (refused when `NODE_ENV=production`).

### 2. Frontend
```bash
cd frontend
npm install
npm run dev               # app on http://localhost:3000
# optional: VITE_API_URL=http://localhost:5000/api (see .env.example)
```

### 🔑 Demo accounts (password: `Acadex@123`)
Seeded demo accounts only. Accounts created in the app get a one-time password and must choose their own at first sign-in.

| Role | Email |
|---|---|
| Super Admin | `superadmin@acadex.com` |
| School Admin | `admin@greenwood.edu` (second school: `admin@sunrise.edu`) |
| Teacher | `ali.sheikh.t0@greenwood.edu` |
| Student | `ali.butt.s0@greenwood.edu` |
| Parent | `parent1@greenwood.edu` |

## 🧪 Tests & checks
```bash
cd backend
npm test          # API tests; starts a throwaway embedded Postgres (no setup needed)
npm run lint
cd ../frontend && npm run lint && npm run build
```
Every access rule has a denial test (cross-role, cross-teacher and cross-school). To run the tests against an existing server instead, set `TEST_DATABASE_URL` to a **separate** database — the tests refuse to run against `DATABASE_URL`. CI runs all of this on every push and pull request.

## 📁 Project Structure

```
backend/
  app.js              # builds the Express app (security middleware, routes, error handler)
  server.js           # validates config, starts the server
  config.js           # environment schema (fails fast on unsafe settings)
  db/
    migrations/       # NNNN_name.sql, applied once each, in order
    migrate.js        # forward-only migration runner (checksums, advisory lock)
    seed.js           # demo data (guarded)
    pool.js, tx.js    # pg pool, transaction helper
  lib/
    access.js         # ownership checks (teaches class, can view student, ...)
    errors.js         # HttpError + central error handler
    validate.js       # shared Zod schemas
    pagination.js     # page/pageSize + X-Total-Count
    passwords.js      # one-time passwords, password policy
    locale.js         # school timezone / currency formatting
    router.js         # async-safe express.Router
  middleware/auth.js  # JWT verify + live user/school check + requireRole
  routes/             # auth, platform, school, me, parent, pdf
  tests/              # Vitest + Supertest suites, two-tenant fixture
frontend/
  src/
    ui.jsx            # Layout, shared components, usePaged + Pager
    api.js            # axios instance + auth helpers
    format.js         # money/date formatting in the school's locale
    Login.jsx, ChangePassword.jsx
    pages/            # platform / admin / teacher / student / parent
docs/security.md      # access rules and security model
CHANGELOG.md
```

## 🗺️ Roadmap
Acadex is being rebuilt into an AI-native LMS + institute platform in phases. Phase 0A (security & stability) is complete; see [CHANGELOG.md](CHANGELOG.md). Next: Phase 0B — TypeScript monorepo, Drizzle migrations, refresh tokens, invites, 2FA, RBAC with row-level security, i18n/RTL.

---

<p align="center">Built by <b>Syed Ibrahim Ali</b> — Full-Stack &amp; AI Engineer</p>
