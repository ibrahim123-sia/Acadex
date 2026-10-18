# Section 4 checklist — where each feature lives

The brief's master feature list (Section 4), walked line by line after Phase 6. **Done** means
built, tested and reachable in the UI; **Later (by design)** means the brief itself defers it and the
code leaves a hook. Paths are relative to the repository root; `api/` = `apps/api/src`,
`web/` = `apps/web/src`, `shared/` = `packages/shared/src`.

Items that were partial or missing in the walk-through were closed on this branch; they are marked
*(closed in the walk-through)*. Tests for them: `apps/api/tests/checklist-gaps.test.ts`.

## 4.1 Platform (the SaaS owner)

| Feature | Status | Where |
|---|---|---|
| Self-serve sign-up with trial, manual onboarding | Done | `api/routes/site.ts` (`/site/signup`), `api/routes/platform.ts`, `web/pages/site/Site.tsx` |
| Plans, feature flags per plan and per tenant, add-on modules | Done | `plans` table, `institutions.feature_overrides`, `api/lib/platform.ts` (`entitlements`, `assertFeature`, `assertModule`) |
| SaaS billing: Stripe + bank transfer / manual, multi-currency, tax, invoices, dunning, up/downgrade, AI add-on | Done | `api/lib/platform.ts` (`invoiceInstitution`, `dunningJob`, `stripeCheckout`), `api/routes/billing-webhook.ts`, `web/pages/office/Platform.tsx` (Billing) |
| Usage metering with cost and margin; AI usage by institution / feature / model / day with filters and CSV | Done | `usage_snapshots`, `api/lib/platform.ts` (`usageJob`, `costReport`), `web/pages/platform/Saas.tsx` |
| Tenant health, impersonation with audit + tenant consent, platform audit log, announcements | Done | `api/routes/platform-saas.ts` (`/impersonate` refuses without `support_access`), `web/pages/platform/Saas.tsx` |
| In-app changelog | Done *(closed in the walk-through)* | `shared/changelog.ts`, `web/pages/office/Extras.tsx` (`WhatsNewPage`, header `WhatsNewLink`) |
| Full ZIP export, deletion with grace period | Done | `api/lib/platform.ts` (`buildExport`, `tenantCleanupJob`), `api/lib/zip.ts` |
| White-label: logo, colours, custom domain, branded emails and PWA | Done | `api/routes/tenant-saas.ts` (branding, domains), `api/routes/site.ts` (manifest), `api/lib/mailer.ts` (`brandedHtml`) |

## 4.2 Institution setup & structure

| Feature | Status | Where |
|---|---|---|
| Institution types with smart defaults | Done | `shared/academics.ts` (`INSTITUTION_TYPES`), `web/pages/admin/Onboarding.tsx` |
| Groups → campuses → departments → programs → levels → sections | Done | `api/routes/structure.ts`, `api/routes/group.ts`, `web/pages/admin/Structure.tsx` |
| Years, terms (all kinds), calendar with holidays respected by attendance, due dates, timetable | Done | `api/routes/structure.ts`, `api/routes/assessments.ts` (holiday due dates refused), `web/pages/admin/Calendar.tsx` |
| Catalog, offerings, co-teachers / TAs, capacity, waitlists | Done | `api/routes/courses.ts`, `web/pages/admin/Courses.tsx` |
| Grading schemes incl. GPA/CGPA, mastery, per-program override | Done | `api/lib/grading.ts`, `programs.grading_scheme_id` |
| Terminology packs with overrides | Done | `shared/academics.ts`, `web/pages/admin/Settings.tsx` |
| Year-end: promote, graduate, alumni, archive terms | Done | `api/routes/yearend.ts`, `web/pages/admin/YearEnd.tsx` |
| Bulk import (CSV/Excel, OneRoster) with dry run; bulk update; bulk invite | Done | `api/routes/imports.ts`, `api/lib/import-parse.ts`, `web/pages/admin/Imports.tsx` |

## 4.3 People & identity

| Feature | Status | Where |
|---|---|---|
| Student profile, guardians, documents, restricted medical notes, custom fields | Done | `api/routes/people.ts`, `api/lib/custom-fields.ts`, `web/pages/admin/StudentProfile.tsx` |
| Staff profile, workload | Done | `web/pages/admin/StaffProfile.tsx` |
| Guardians with several children, per-guardian permissions (fees, grades, messages) | Done *(messages permission enforced in the walk-through)* | `guardianships.can_view_grades / can_view_fees / can_message`, `api/lib/conversations.ts` |
| Student and staff ID cards (PDF, QR) | Done | `id_cards`, `api/routes/documents.ts` |
| Leaving / character / bonafide certificates | Done | `api/lib/documents.ts`, `web/pages/admin/Documents.tsx` |
| Soft delete + recycle bin, audit trail | Done | `api/lib/soft-delete.ts`, `acadex_audit()` triggers, `web/pages/admin/Records.tsx` |

## 4.4 Admissions & enquiries

| Feature | Status | Where |
|---|---|---|
| Branded online form with documents and fee payment | Done | `api/routes/apply.ts`, `web/pages/public/Apply.tsx` |
| Enquiry CRM | Done | `api/routes/admissions.ts`, `web/pages/office/Admissions.tsx` |
| Entrance tests, merit list, offers, convert to student + guardian | Done | `api/lib/admissions.ts` |

## 4.5 Teaching & learning

| Feature | Status | Where |
|---|---|---|
| Course space, modules, rich pages (math, code), files, video, links, embeds, drip release | Done (H5P later by design) | `api/routes/courses.ts`, `web/components/RichText.tsx`, `web/pages/lms/Courses.tsx` |
| Blueprints with push updates | Done | `web/pages/admin/Blueprints.tsx` |
| Progress, mark as done, resume | Done | `content_progress`, `web/pages/lms/ItemView.tsx` |
| Assignments: versions, groups, peer review, late policy, extensions, accommodations, rubrics, annotation, A/V feedback, draft vs released | Done | `api/routes/assessments.ts`, `web/pages/lms/Work.tsx` |
| Quizzes: shared bank, 12 question types, pools, timer, attempts, auto + manual grading, item analysis, regrade | Done | `shared/quiz.ts`, `api/routes/quizzes.ts`, `web/pages/lms/Quiz.tsx` |
| Secure exam mode (no webcam in v1; hook documented) | Done | `api/routes/quizzes.ts` (windows, IP ranges, access code, focus log) |
| Paper exams: timetable, seating, admit cards, invigilators, marks grid, moderation, results, transcripts | Done | `api/routes/exams.ts`, `api/lib/exams/`, `web/pages/office/Exams.tsx` |
| Gradebook | Done | `api/routes/gradebook.ts`, `web/pages/lms/Gradebook.tsx` |
| OBE: CLO/PLO, mapping, attainment, accreditation reports | Done | `api/routes/outcomes.ts`, `web/pages/office/Outcomes.tsx` |
| Mastery view, skills transcript | Done | `api/routes/outcomes.ts` |
| Discussions (Q&A mode), announcements, polls | Done | `api/routes/engage.ts`, `web/pages/lms/Discussions.tsx` |
| Calendar with ICS feed | Done | `api/routes/engage.ts` (ICS), `api/routes/public.ts` |
| Live classes (Zoom / Meet / Teams / Jitsi), join-log attendance, recordings | Done | `api/lib/live.ts`, `api/routes/integrations.ts` |
| Certificates with QR verification and revoke | Done | `web/pages/public/Verify.tsx` |
| Gamification (switchable) | Done | `api/lib/lms/rewards.ts` |
| Evaluation surveys and forms | Done | `api/routes/engage.ts` (surveys) |
| Imports: Google Classroom, Moodle .mbz, Common Cartridge, QTI; SCORM + xAPI; starter templates; OER | Done | `api/lib/lms/packages.ts`, `api/lib/lms/templates.ts`, `api/routes/content.ts` |

## 4.6 Attendance & timetable

| Feature | Status | Where |
|---|---|---|
| Per-session attendance, all statuses, all-present, offline sync | Done | `api/routes/attendance.ts`, `web/pages/lms/Attendance.tsx`, `web/public/sw.js` |
| QR self check-in, rotating code, optional geofence | Done *(geofence closed in the walk-through)* | `api/routes/attendance.ts` (`/attendance/checkin`), Settings → QR check-in only on campus |
| Staff attendance, leave with approval | Done | `teacher_attendance`, `leave_requests`, `api/routes/attendance.ts` |
| Timetable builder, automatic generation, substitutions | Done | `api/routes/timetable.ts`, `web/pages/lms/Timetable.tsx` |
| Rooms / resources booking | Done *(closed in the walk-through)* | `api/routes/bookings.ts`, `room_bookings` (migration 0021), `web/pages/office/Extras.tsx` (`BookingsPage`) |
| Thresholds with alerts and exam eligibility | Done | `api/routes/attendance.ts`, `api/lib/exams/results.ts` |

## 4.7 Fees & finance

| Feature | Status | Where |
|---|---|---|
| Structures, installments, fines, discounts, scholarships, waivers, refunds | Done | `api/lib/finance/`, `web/pages/office/FinanceSetup.tsx` |
| Challans (PDF + QR), receipts, ledger, partial payments | Done | `api/lib/finance/ledger.ts`, `api/routes/pdf.ts` |
| Stripe, JazzCash, Easypaisa, Raast / bank; idempotent webhooks; reconciliation | Done | `api/lib/finance/providers.ts`, `api/routes/payments.ts` |
| Reminders before / after due date; defaulters | Done | `api/lib/notify.ts`, `api/routes/finance.ts` |
| Expenses, income/expense report, Tally / QuickBooks CSV | Done | `api/routes/finance.ts` |
| Fee visibility rules | Done | `show_fees_to_students`, `can_view_fees` |

## 4.8 Optional modules

| Feature | Status | Where |
|---|---|---|
| Library (catalog, issue/return, fines, barcode) — full | Done | `api/routes/modules.ts`, `web/pages/modules/Modules.tsx` |
| HR & payroll (structures, payslips, leave balance) — full | Done | same |
| Transport, hostel (fee link), inventory, visitors / gate pass | Done | same; `module_charges` links fees |

## 4.9 Communication & safety

| Feature | Status | Where |
|---|---|---|
| In-app, web push, email, WhatsApp, SMS; preferences, quiet hours, digests, delivery logs, retry | Done | `api/lib/notify.ts`, `api/lib/messaging.ts`, `api/lib/push.ts` |
| Messaging with safeguarding for minors, guardian CC, reporting, profanity filter | Done | `api/lib/conversations.ts`, `api/lib/profanity.ts`, `web/pages/reach/Messages.tsx` |
| Parent–teacher meetings, tickets | Done | `api/routes/reach.ts`, `web/pages/reach/Desk.tsx` |
| Emergency broadcast | Done | `api/routes/reach.ts`, `web/pages/reach/Office.tsx` |

## 4.10 AI

| Feature | Status | Where |
|---|---|---|
| Foundation: providers (Gemini, Groq), usage, quotas, kill-switches, transparency page; models chosen only by the platform owner (API management) — institutions' own keys removed by decision | Done | `api/ai/client.ts`, `api/ai/providers.ts`, `web/pages/ai/OfficeAi.tsx`, `api/ai/catalog.ts`, `api/routes/platform-ai.ts`, `web/pages/platform/Ai.tsx` |
| Course knowledge base | Done | `api/ai/kb.ts` |
| Tutor (coach, cites, AI policy, under-18 mode, streaming, stuck points; replies in English) | Done | `api/ai/tutor.ts`, `web/pages/ai/CourseAi.tsx` |
| Teacher copilot (approve before apply) | Done | `api/ai/copilot.ts` |
| Grading assistant (human in the loop, `ai_assisted`) | Done | `api/routes/ai.ts` |
| Learning-process evidence, similarity in class, mini-viva | Done | `api/ai/evidence.ts` |
| Early warning with explainable factors | Done *(teachers now see it on the dashboard)* | `api/ai/risk.ts`, `api/routes/me.ts` (`at_risk`) |
| Ask Acadex over safe views | Done | `api/ai/ask.ts` |
| AI helpdesk | Done | `api/routes/ai.ts` |
| Smart timetable + captions / translation | Done | `api/routes/timetable.ts`, `api/routes/reach.ts` |
| Safety: moderation, jailbreak / leak tests, ≥100-case eval suite in CI, "AI-generated" labels | Done | `api/ai/guard.ts`, `api/ai/evals.ts`, `apps/api/tests/ai-evals.test.ts` |

## 4.11 Analytics & reports

| Feature | Status | Where |
|---|---|---|
| Role dashboards (teacher: to-grade, today, at-risk; student: due, progress, streak; guardian; admin KPIs) | Done *(streak and at-risk closed in the walk-through)* | `api/routes/me.ts` (`/me/dashboard`), `web/pages/lms/Dashboards.tsx` |
| Reports with filters, charts, PDF / Excel, scheduled emails | Done | `api/lib/reports.ts`, `web/pages/office/Platform.tsx` (Reports) |
| Cross-campus comparison | Done | `api/routes/group.ts`, `web/pages/group/index.tsx` |

## 4.12 Integrations & API

| Feature | Status | Where |
|---|---|---|
| LTI 1.3 launches (tool provider later by design) | Done | `api/lib/lti.ts`, `api/routes/lti-launch.ts` |
| OneRoster in / out, Google Classroom import | Done | `api/routes/imports.ts`, `api/routes/tenant-saas.ts`, `api/lib/lms/templates.ts` |
| Google / Microsoft SSO | Done | `api/lib/sso.ts`, `api/routes/sso.ts` |
| Drive / OneDrive file picker | Done *(closed in the walk-through)* | `web/components/CloudPicker.tsx` (link items; needs `VITE_GOOGLE_*` / `VITE_ONEDRIVE_CLIENT_ID`) |
| Zoom / Meet, calendar feeds | Done | `api/lib/live.ts`, ICS feed |
| REST API with scoped keys, webhooks, OpenAPI page | Done | `api/routes/api-v1.ts`, `api/lib/webhooks.ts`, `api/openapi-lms.ts` |

## 4.13 Privacy, compliance & legal

| Feature | Status | Where |
|---|---|---|
| Field-level visibility for medical and fees | Done | `api/routes/people.ts`, fee visibility settings |
| Consents (guardian, AI), cookie notice | Done | `consents`, `web/pages/account/Privacy.tsx`, `web/pages/site/Site.tsx` |
| Access / export / delete requests; retention per tenant | Done | `api/lib/privacy.ts`, `api/routes/tenant-saas.ts` |
| GDPR / COPPA / FERPA / Pakistan notes, DPA, privacy, terms, sub-processors | Done | `/legal/*` in `web/pages/site/Site.tsx`, `docs/security.md` |
| Data region later | Later (by design) | storage region via `S3_REGION`, database via `DATABASE_URL` per deployment |
| OWASP list, dependency + secret scanning in CI, encrypted backups, admin 2FA, audit of sensitive reads | Done *(medical shown in the profile now audited too)* | `.github/workflows/ci.yml`, `.gitleaks.toml`, `scripts/leak-scan.mjs`, `ops/backup.sh`, `docs/security.md` |

## 4.14 Accessibility, language & devices

| Feature | Status | Where |
|---|---|---|
| WCAG 2.2 AA | Done | `e2e/a11y.spec.ts` (axe-core) |
| Interface language | English only (product decision, 2026-10-18); Urdu and Arabic were built and removed — see [future-gaps.md](future-gaps.md) | `web/lib/i18n.ts`, `web/locales/en.json` |
| Country → currency, timezone, formats, week start, payment gateways | Done | `shared/countries.ts`, `api/lib/country.ts`, `web/components/CountrySelect.tsx` |
| Intl formats; tenant timezone | Done | `web/lib/format.ts` |
| Per-tenant week start | Done *(closed in the walk-through)* | `settings.week_start`, `web/lib/format.ts` (`weekStart`), `web/pages/admin/Calendar.tsx` |
| PWA, web push, offline, low-bandwidth mode | Done | `web/public/sw.js`, `web/lib/device.ts` |
| 360 px phones | Done | every E2E journey runs at 360 px (`playwright.config.ts`) |

## 4.15 Support & onboarding

| Feature | Status | Where |
|---|---|---|
| Setup wizard per type | Done | `web/pages/admin/Onboarding.tsx` |
| Sample data toggle | Done *(the switch is now in the setup wizard)* | `api/routes/tenant-saas.ts`, `web/pages/office/Extras.tsx` (`SampleDataCard`) |
| Guided tours per role | Done | `web/components/PlatformExtras.tsx` (`ProductTour`) |
| Contextual help links | Done *(closed in the walk-through)* | `web/pages/office/Extras.tsx` (`HelpLink` in the header) |
| Help center, feedback widget, AI helpdesk, video tutorials | Done | `shared/help.ts`, `api/routes/site.ts` (`/tutorials`), `web/components/PlatformExtras.tsx` |
| Landing, pricing, demo booking | Done | `web/pages/site/Site.tsx` |
