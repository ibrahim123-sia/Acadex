# Architecture

## Overview

```
                 ┌────────────── browser ──────────────┐
                 │  @acadex/web  (React + TS, Vite)    │
                 │  access token in memory             │
                 └───────┬─────────────────────────────┘
                         │ /api  (same origin; refresh cookie is first-party)
                 ┌───────▼─────────────────────────────┐
                 │  @acadex/api  (Express 5 + TS)      │
                 │  auth → permission → route          │
                 │  one DB transaction per request     │──▶ email outbox → SMTP
                 └───────┬─────────────────────────────┘──▶ Sentry (errors only)
                         │ SET LOCAL app.school_id / app.user_id
                 ┌───────▼─────────────────────────────┐
                 │  PostgreSQL 16 (Neon) + RLS         │
                 │  pgvector available for Phase 3     │
                 └─────────────────────────────────────┘
```

An npm-workspaces monorepo:

| Package | What |
|---|---|
| `apps/api` (`@acadex/api`) | REST API. TypeScript (strict, ESM), Express 5, `pg` + Drizzle schema, pino logs |
| `apps/web` (`@acadex/web`) | Single-page app. React 18, React Router 7, TanStack Query, React Hook Form, Tailwind 4, i18next |
| `packages/shared` (`@acadex/shared`) | Zod schemas, permission catalogue, constants and types used by both |

The shared Zod schemas are the single source of truth for request shapes: the API
validates with them, the web forms validate with them (`zodResolver`), and the OpenAPI
document (`/api/openapi.json`, rendered at `/api/docs`) is generated from them.

## Request lifecycle (API)

1. `pino-http` assigns a request id (or keeps `X-Request-Id` from the proxy).
2. helmet, CORS, JSON body limit, rate limits.
3. `dbContext` opens a transaction on a pooled connection and sets
   `app.school_id`, `app.user_id` for the rest of the request (RLS reads these). Before
   authentication it runs in the context the token claims; `authenticate` then verifies
   the user, session and school against the database and refuses a mismatch.
4. `requirePermission(...)` checks the caller's roles (cached per request).
5. The route validates input with Zod, applies relationship checks (`lib/access.ts`) and
   queries through `req.db`.
6. The transaction commits before the response is sent; any error status rolls it back.
   `withTransaction` inside a route becomes a savepoint.

Background work (email outbox flushing, permission sync after migrate) runs with
`runAsSystem` / `runAsTenant`, never with a request's context.

## Data model

Tenants: `institution_groups` → `institutions` (type, settings, terminology overrides) →
`campuses`. Every tenant table has `institution_id` and an RLS policy.

Academic structure: `departments`, `programs` (optional own grading scheme) →
`program_levels` (in promotion order); `academic_years` → `terms`; `holidays`;
`grading_schemes`; `sections` (a class / batch / cohort: one level, one campus, one year);
`courses` (catalog) → `course_offerings` (a course in a term, for a whole section or open
with capacity) → `section_staff` (teacher / co-teacher / TA) and `enrollments` (with a
waitlist); `student_promotions` (year-end history).

People: `users` (one primary role), `students`, `teachers` (all staff, teaching or not),
`guardians` + `guardianships` (relationship and per-guardian permissions),
`student_medical` (restricted), `custom_fields` (values in each person's `custom_data`),
`files`, `person_documents`, `id_cards`, `document_templates`, `issued_documents`,
`import_jobs`.

Teaching and office (reworked in Phases 2–3): `student_attendance`, `teacher_attendance`,
`grades`, `assignments`, `submissions`, `tuition_fee`, `timetable`, `exam_schedule`,
`announcements`, `notifications`, `audit_log`.

Terminology, grading presets, institution-type defaults and the grading maths
(`gradeFor`, credit-weighted `gpa`) live in `packages/shared/src/academics.ts`.

Auth: `sessions`, `refresh_tokens`, `email_tokens` (invite / reset / verify, hashed),
`mfa_totp`, `mfa_recovery_codes`, `email_outbox`.

RBAC: `permissions`, `roles` (system or per-school custom), `role_permissions`,
`user_roles` (scope `platform` or `school`). Every tenant table has `school_id` and an RLS
policy.

The schema lives in `apps/api/src/db/schema/*.ts`. `npm run db:generate -w @acadex/api`
produces a new SQL migration in `apps/api/drizzle/`, which is reviewed and committed;
`npm run db:migrate` applies it (see [security.md](security.md#database-changes)).
Databases created before the TypeScript rewrite have the baseline recorded instead of run.

## Web app

- `lib/api.ts`: fetch wrapper; the access token lives in memory only. A 401 triggers one
  shared refresh (the `acadex_rt` cookie) and a single retry; a failed refresh ends the
  session in every tab (BroadcastChannel).
- `lib/auth.tsx`: session state, permission helper `can()`; navigation and routes are
  filtered by permission, so custom roles see exactly the pages they can use.
- `lib/queries.ts`: TanStack Query hooks; `usePagedList` follows the API's pagination headers.
- `components/ui/`: the design system (buttons, fields, dialogs, data tables with loading,
  empty and error states, toasts). Semantic colour tokens with light/dark themes; logical
  CSS properties so right-to-left languages lay out correctly.
- Portals are lazy-loaded (`pages/platform|admin|teacher|student|parent`); charts load only
  with the dashboards.
- i18n: English strings are the defaults in code; `locales/ur.json` and `ar.json`
  translate the shell, sign-in and common UI. Money and dates are formatted with `Intl` in
  the institution's currency and timezone.

## Configuration

All settings are environment variables validated at startup (`apps/api/src/config.ts`);
see `apps/api/.env.example` and `apps/web/.env.example`. External providers sit behind
interfaces with a development driver (mail: `log` / `smtp`).

## Deployment

- API image: `apps/api/Dockerfile` (runs pending migrations, then serves; health check
  `/api/health`, readiness `/api/ready`).
- Web image: `apps/web/Dockerfile` (static files on nginx, which proxies `/api`).
- Put the API in the same region as the database: every request is one transaction and
  each round trip to a distant database adds latency.
- See [operations.md](operations.md) for backups and restores.
