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

The LMS (Phase 2; `schema/lms.ts`, `schedule.ts`, `engagement.ts`):
- Course space: `modules` (of an offering, or of a `course_blueprints` template; drip release
  by `unlock_at`, `prerequisite_module_id`, `mastery_percent`) → `content_items` (page, file,
  link, video, assessment, live, scorm; a completion rule) → `content_progress` per student.
  Copies keep `source_*_id` so blueprint updates can be pushed; `locally_modified` protects
  a course's own edits.
- Assessment: `assessments` (kind, points, dates, late policy, group set, peer review,
  rubric, AI policy, quiz settings, release mode), `assessment_extensions`,
  `accommodations`, `submissions` (per student or group, per attempt) →
  `submission_versions` → `submission_annotations`; `peer_reviews`; `rubrics` →
  `rubric_criteria`; `group_sets` → `student_groups` → `group_members`.
- Quizzes: `question_banks` (per course) → `questions`; `assessment_questions` (fixed or
  "N from this bank/tag"); `quiz_attempts` (the student's own layout, deadline) →
  `attempt_answers`, `attempt_events` (integrity signals).
- Gradebook: `grade_categories` (weight, drop lowest), `grades` (points, excused, missing,
  late penalty, feedback, rubric scores, draft / released) → `grade_history`;
  `final_grade_overrides`; `course_offerings.gradebook_locked_at`.
- Time: `attendance_sessions` (a day register or one class) → `attendance_records`
  (present / absent / late / excused / leave, how it was taken); `leave_requests`;
  `teacher_attendance`; `rooms`, `periods` (bell schedule), `timetable_slots` (unique
  per section, teacher and room per period), `teacher_unavailability`, `substitutions`;
  `live_sessions` → `live_joins`.
- Engagement: `discussions` → `discussion_posts`, `polls` → `poll_votes`, `surveys` →
  `survey_responses` (anonymous ones keep only a hash to stop double answers),
  `announcements` (scoped to a campus, section or course), `certificate_templates` →
  `certificates`, `badges` → `badge_awards`, `points_ledger`; `scorm_packages` →
  `scorm_attempts`, `xapi_statements`, `content_imports`.
- Notifications: `notifications` (in-app, optional dedupe key), `notification_preferences`,
  `push_subscriptions`, `delivery_logs`, `calendar_feeds`.

Finance (Phase 3; `schema/finance.ts`): `fee_structures` → `fee_structure_items`,
`fee_installments`; `discounts` → `student_discounts`; `invoices` (a student's, or an
applicant's) → `invoice_items` (fees, discounts, fines with the day they were charged for,
waivers), `payments` (unique per provider reference) → `refunds`; `checkout_sessions`
(our reference for an online payment), `payment_provider_events` (one row per provider event
id — the idempotency key; platform-only RLS), `payment_accounts` (an institution's merchant
account; secrets sealed with AES-GCM), `reconciliations`, `invoice_reminders`, `expenses`.
Money moves only through `lib/finance/ledger.ts` (totals, generation, payments, refunds,
provider events, fines, reconciliation); providers sit behind one interface in
`lib/finance/providers.ts` (Stripe, JazzCash, Easypaisa, bank, fake).

Exams and outcomes (`schema/exams.ts`): `exam_series` → `exam_sessions` (a paper; its
gradebook column once published) → `exam_seats`, `invigilator_duties`, `exam_marks`
(marks, absent, moderation adjustment), `exam_moderations` (every step of the approval
chain); `admit_cards`; `learning_outcomes` (PLO / CLO), `outcome_mappings`,
`outcome_alignments` (a question, rubric criterion, assessment or paper measuring a CLO).
Secure exam settings are `assessments.secure`; `quiz_attempts.position` enforces one
question at a time. Results are computed in `lib/exams/results.ts`, attainment in
`lib/outcomes.ts`.

Admissions (`schema/admissions.ts`): `admission_forms` (public slug, questions, documents,
fee, online test), `applications` (a hashed private token, status, test, merit, offer) →
`application_documents`; `enquiries` → `enquiry_followups`. Public endpoints live in
`routes/apply.ts` and `routes/payments.ts`, looked up only by unguessable tokens.

`audit_log` records every change to money, exams, outcomes and admissions (triggers).

AI (Phase 4; `schema/ai.ts`, code in `src/ai/`, see [ai.md](ai.md)): `ai_usage` (every call,
tokens and cost), `ai_provider_keys` (sealed), `kb_chunks` (course material and help, with
`real[]` embeddings and a full-text index), `ai_conversations` → `ai_messages`, `ai_actions`
(copilot proposals), `submission_activity`, `viva_sessions`, `risk_scores`, `interventions`,
`media_transcripts`, `report_comments`; the read-only `ask_*` views for Ask Acadex.

Reach (Phase 5; `schema/reach.ts`): `conversations` → `conversation_members` (member / cc) →
`messages` → `message_reports`; `tickets` → `ticket_comments`; `ptm_events` → `ptm_slots`;
`broadcasts`; `integration_accounts` (Zoom / Teams / Meet, sealed). Routes:
`routes/messages.ts`, `routes/reach.ts`, `routes/integrations.ts` (webhooks). The web app's
device layer (`lib/device.ts`, `public/sw.js`) handles low-bandwidth mode, offline copies and
smaller uploads.

Platform (Phase 6; `schema/platform.ts`, `schema/modules.ts`, see [platform.md](platform.md)):
`plans`, `platform_invoices`, `usage_snapshots`, `platform_settings`,
`platform_announcements`, `custom_domains`, `data_exports`, `api_keys`,
`webhook_endpoints` → `webhook_deliveries`, `lti_tools` → `lti_launches`, `consents`,
`privacy_requests`, `report_schedules`, `demo_requests`, `product_feedback`; modules:
`library_*`, `salary_structures`, `staff_salaries`, `payroll_runs` → `payslips`,
`staff_leaves`, `vehicles`, `transport_*`, `hostel_*`, `module_charges`,
`inventory_items` → `stock_movements`, `visitor_logs`.

Who may do what in a course is decided in one place, `lib/lms/access.ts`: staff (assigned
teachers, or holders of `courses.manage_any`), students (the roster: the whole section, or
enrolled for open courses) and guardians (linked to a student on the roster; released
grades only). Grade arithmetic (late penalties, weighted categories, drop lowest) is in
`lib/lms/gradebook.ts`; question types and auto-marking in `packages/shared/src/quiz.ts`.

Rich text (pages, instructions, feedback, posts) is sanitised on the server
(`lib/html.ts`: an allow-list with KaTeX markup and video embeds from a few hosts) and again
in the browser. SCORM packages run in a sandboxed iframe (an opaque origin with no access
to Acadex or the session); a small runtime injected into each package page reports the data
model to the player, which saves it with the person's own session.

## Background jobs and live updates

`src/jobs/queue.ts` runs jobs on pg-boss (schema `pgboss` in the same database); a job
queued in a request is inserted in the request's transaction, so it exists only if the work
commits. Workers run in the API process (`JOBS_WORKER=true`) or separately
(`npm run worker -w @acadex/api`). Jobs: notification delivery (email through the outbox,
web push with VAPID keys, honouring preferences and quiet hours, logged in
`delivery_logs`), due-date reminders (hourly), attendance alerts (daily), and emptying the
recycle bin after 30 days (nightly). Tests use `JOBS_DRIVER=inline` and run jobs with
`drainJobs()` / `runJob()`.

Live updates: `publish()` sends a PostgreSQL NOTIFY (delivered on commit); each API
process LISTENs on one direct connection (`DATABASE_DIRECT_URL`, derived for Neon) and
writes server-sent events to `GET /api/events` streams, which the web app reads with
`fetch` (the access token goes in the header) and reconnects with a fresh token.

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
  CSS properties (so a right-to-left language could be added later).
- Portals are lazy-loaded (`pages/platform|admin|teacher|student|parent`); charts load only
  with the dashboards. The LMS pages (`pages/lms`) serve every role: `/teach/courses/…` and
  `/learn/courses/…` are the same pages, and the person's role in the course decides what
  each shows. `/attendance`, `/timetable`, `/calendar`, `/announcements`, `/notifications`
  and `/surveys` are shared too.
- `lib/lms.ts`: the live-event stream and the offline queue for registers taken without a
  connection (localStorage; sent when the browser is back online).
- `components/RichText.tsx`: a light rich-text editor and the viewer (KaTeX for `$…$`).
- i18n: English strings are the defaults in code; `locales/ur.json` and `ar.json`
  translate the shell, sign-in and common UI. Money and dates are formatted with `Intl` in
  the institution's currency and timezone.

## Configuration

All settings are environment variables validated at startup (`apps/api/src/config.ts`);
see `apps/api/.env.example` and `apps/web/.env.example`. External providers sit behind
interfaces with a development driver (mail: `log` / `smtp`; jobs: `pgboss` / `inline`;
push: `none` / `webpush` / `fake`; Google Classroom import: `CLASSROOM_DRIVER` `none` /
`fake` until the institution connects Google Workspace).

## Deployment

- API image: `apps/api/Dockerfile` (runs pending migrations, then serves; health check
  `/api/health`, readiness `/api/ready`).
- Web image: `apps/web/Dockerfile` (static files on nginx, which proxies `/api`).
- Put the API in the same region as the database: every request is one transaction and
  each round trip to a distant database adds latency.
- See [operations.md](operations.md) for backups and restores.
