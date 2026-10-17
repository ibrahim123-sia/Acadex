# The platform and the ecosystem (Phase 6)

## Plans, limits and modules

Plans live in the `plans` table (created with Free, Pro and Enterprise by migration 0020) and
are edited by the platform owner under **Business → Plans**: prices per currency, limits
(students, staff, storage, AI spend, SMS / WhatsApp a month — `null` is unlimited), features
(`api`, `sso`, `white_label`, `custom_domain`, `lti`) and the modules a plan includes.
`lib/platform.ts` `entitlements()` combines the plan with per-institution overrides
(`institutions.feature_overrides`, set by the platform) and the modules the institution has
switched on (Settings → Modules). Limits are enforced where they bite: adding students,
uploading files, sending text messages, AI calls.

Modules (`routes/modules.ts`): **Library** (catalogue, copies with barcodes, issue / return,
fines, renewals, overdue reminders), **HR & payroll** (salary structures, salaries, monthly
payroll with unpaid days, approval, payslip PDFs, staff leave with balances), **Transport**
(vehicles, routes with stops, riders, monthly invoices), **Hostel** (rooms, residents, monthly
invoices), **Inventory & assets** and **Visitors** (gate passes).

## Billing

- `billing.monthly` (1st of each month, 04:00 UTC) invoices each paying institution: the plan,
  extra students above the limit last month, AI spend above the included budget (with the
  `ai_markup`), tax by country (`tax_rates`, Pakistan 16% by default). Trials are not invoiced.
- Institutions pay under **Billing**: by card (Stripe Checkout on the platform's own account,
  `BILLING_STRIPE_SECRET_KEY`, webhook `API_PUBLIC_URL/billing/stripe/webhook` with
  `BILLING_STRIPE_WEBHOOK_SECRET`) or by bank transfer, which the platform marks paid.
- `billing.dunning` (daily): overdue invoices get reminders on day 1 and 7; after
  `suspend_after_days` (21) the workspace is paused, and it reopens as soon as it is paid.
- `usage.daily` records students, storage, AI cost, messages and active users per institution;
  **Business → Usage & margin** shows cost (from `unit_costs`) against revenue.

## Tenant tools

- **White-label**: logo, colour, app name and email footer (branded HTML emails), and a custom
  domain verified with a DNS TXT record `_acadex.<domain>`; the sign-in page and the app
  manifest take the institution's brand on its domain (`/api/public/brand`,
  `/api/public/manifest.webmanifest`).
- **Exports and deletion**: a full ZIP (every table as CSV without secrets, every file),
  kept 7 days; closing the account erases everything after 30 days (cancellable).
- **Support sign-in**: only when the institution allows it (Data & privacy → Retention &
  support), one hour, recorded in both audit logs, with a red banner for the whole session.

## Integrations

- **Public API** `/api/v1` with keys (`acx_…`, stored hashed, scopes such as `students:read`),
  read-only and paginated, 120 requests a minute per key.
- **Webhooks**: `student.created`, `student.enrolled`, `grade.released`, `payment.received`,
  `attendance.marked`, `application.submitted`, `invoice.issued`; signed
  `Acadex-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`, retried with back-off for about 8
  hours, switched off after 20 failures in a row.
- **LTI 1.3**: Acadex launches external tools (OIDC third-party login, RS256 id_token, keys at
  `/api/lti/jwks`); names and emails are shared only if the tool is allowed to have them.
- **OneRoster 1.1** CSV export (import was already there), **Google / Microsoft sign-in** for
  existing accounts on plans with SSO (`GOOGLE_CLIENT_ID`… in `.env`).

## Privacy and compliance

Consents (guardians for their children: data processing, photos, AI features, messaging,
marketing), people's requests (a copy of their data as a ZIP, correction, deletion — the
account is closed and contact details removed), retention periods per institution (messages,
AI conversations, audit log, visitor log; `privacy.retention` daily), an audit entry for every
sensitive read (medical notes, transcripts, exports), and the public legal pages: privacy
policy, terms, data processing agreement, sub-processors and compliance (GDPR, COPPA, FERPA,
Pakistan). Data region: the database and storage are configured by environment, so a
deployment per region is possible.

## Reports

Eight reports (attendance, results, fee collection, defaulters, teacher workload, course
engagement, OBE attainment, admissions funnel) on screen and as CSV / Excel / PDF; schedules
email a signed download link at 07:00 local time (weekly on Mondays, monthly on the 1st).

## Load test

`npx tsx scripts/load-test.ts --url http://localhost:5000/api --users 50 --seconds 60` — virtual
users sign in with the demo accounts and browse dashboards, courses, notifications, the
timetable and fees; it prints requests per second, p50 / p95 / p99 and errors per endpoint and
fails above the budgets (`--max-p95 800 --max-errors 1`).
