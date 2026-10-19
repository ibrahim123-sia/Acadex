# Operations

## Health

| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /api/health` | process up, database answers | liveness probe |
| `GET /api/ready` | database answers **and** every migration in this build is applied | readiness probe / deploy gate |

Logs are JSON (pino) with a request id on every line; set `LOG_PRETTY=true` locally.
Server errors go to Sentry when `SENTRY_DSN` (API) / `VITE_SENTRY_DSN` (web) are set.

## Migrations

```bash
npm run db:migrate            # applies pending migrations; safe to run on every deploy
```
The API image runs this before starting. Migrations are forward-only; a migration that
drops or truncates must be marked `-- acadex:reviewed-destructive` after review.

## Backups

Neon keeps point-in-time history (restore to any moment in the retention window from the
Neon console — the first thing to reach for after a bad change). In addition, take
logical backups you own:

```bash
DATABASE_URL=postgres://… BACKUP_ENCRYPTION_KEY=… BACKUP_S3_URI=s3://bucket/acadex \
  ops/backup.sh ./backups
```
- `pg_dump` custom format, AES-256 encrypted when `BACKUP_ENCRYPTION_KEY` is set, with a
  SHA-256 checksum file; uploaded with the AWS CLI when `BACKUP_S3_URI` is set (R2 / MinIO
  via `AWS_ENDPOINT_URL`).
- Needs `pg_dump` / `psql` of the same major version as the server (16).
- Suggested schedule: daily, keep 14 daily + 8 weekly; store the encryption key outside
  the bucket.

## Restore

```bash
TARGET_DATABASE_URL=postgres://… BACKUP_ENCRYPTION_KEY=… ops/restore.sh backups/acadex-….dump.enc
```
Refuses a target that already has Acadex tables unless `--replace` is passed. Restore into
a new Neon branch first, check it, then point the app at it.

## Restore drill

```bash
DATABASE_URL=postgres://…  SCRATCH_DATABASE_URL=postgres://…/empty_db  ops/verify-restore.sh
```
Backs up, restores into the scratch database and compares every table's row count. CI runs
this on every push against a freshly migrated and seeded database; run it monthly against
production into a throwaway Neon branch.

## File storage

`STORAGE_DRIVER=local` keeps uploads in `STORAGE_LOCAL_DIR` (back it up with the database);
`s3` uses any S3-compatible store (`S3_BUCKET`, `S3_ENDPOINT`, keys). Database backups do not
contain file bytes: back up the bucket separately (versioning or replication on R2 / S3).
Quotas come from the plan (seeded: free 1 GB, pro 50 GB, enterprise unlimited; editable in
Platform → Business → Plans; 500 MB when a plan sets none), and the institution setting
`storage_quota_mb` overrides. `VIRUS_SCAN=clamav` streams every upload to clamd.

## Hosting on Cloudflare

Worker + static assets + the API as a Cloudflare Container + R2 for files, with Neon as the database:
the full setup and how each part works is in [cloudflare.md](cloudflare.md).

## Local services

`docker compose up -d`: Postgres 16 + pgvector (5432), MinIO (9000, console 9001, bucket
`acadex-files`), Mailpit (SMTP 1025, inbox http://localhost:8025).
`docker compose --profile app up --build` adds the API (5000) and the web app (8080).

## Secrets

Never committed. Required in production: `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars),
`MFA_ENCRYPTION_KEY` (32 bytes). Rotating `JWT_SECRET` invalidates current
access tokens and pending 2FA sign-ins; refresh tokens are not JWTs, so the web app
silently obtains new access tokens and nobody is signed out. Rotating `MFA_ENCRYPTION_KEY` requires
users to re-enrol 2FA.

## Background jobs

Jobs (notification delivery, due reminders, attendance alerts, the nightly recycle-bin purge)
run on pg-boss in the `pgboss` schema of the same database; the schema is created on first
start. By default the API process runs the workers (`JOBS_WORKER=true`). To scale them
separately, set `JOBS_WORKER=false` on the web processes and run `npm run worker -w @acadex/api`
(or `node dist/worker.js` from the build) as its own process. Failed jobs are retried three
times with backoff; their state is in `pgboss.job`.

Live updates and the job queue use a **direct** (not pooled) database connection:
`DATABASE_DIRECT_URL`, or the pooled `DATABASE_URL` with Neon's `-pooler` removed from the
host. Behind PgBouncer in transaction mode, set `DATABASE_DIRECT_URL` explicitly.

Schedules: pg-boss runs the cron schedules itself (`JOBS_SCHEDULE=internal`, the default). Where the API
may sleep between requests (Cloudflare Containers), set `JOBS_SCHEDULE=external` and `CRON_SECRET`;
an outside scheduler then calls `POST /api/internal/cron` every few minutes — see
[cloudflare.md](cloudflare.md#how-scheduled-jobs-work).

## Push notifications

Browser push needs a VAPID key pair: `npx web-push generate-vapid-keys`, then
`PUSH_DRIVER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
(a `mailto:` address). Without them push is off and people still get in-app and email
notifications. Every delivery attempt is recorded in `delivery_logs`; subscriptions the
browser reports as gone are removed.

## Payments

Each institution connects its own merchant accounts in **Finance → Settings → Payment
methods** (keys are encrypted with `MFA_ENCRYPTION_KEY` and never shown again). Use the
providers' sandbox keys first. Providers send results to
`API_PUBLIC_URL/payments/webhook/<provider>/<account id>` (shown next to each account):
- **Stripe**: add that URL as a webhook endpoint for `checkout.session.completed`,
  `checkout.session.async_payment_succeeded` / `_failed`, `checkout.session.expired` and
  `charge.refunded`; paste the endpoint's signing secret as `webhook_secret`.
- **JazzCash**: merchant id, password and integrity salt; the return URL is sent with each
  payment (the payer's browser comes back through it).
- **Easypaisa**: store id and hash key for checkout; the API username / password and account
  number let Acadex confirm each payment with Easypaisa's inquiry API (the postback is not
  signed, so it is never trusted on its own).
- **Bank / Raast**: the bank, account title, IBAN and Raast ID printed on vouchers; payments
  are recorded at the counter or matched from the bank statement in reconciliation.

Every callback is stored in `payment_provider_events` once per provider event id; replays
are acknowledged and ignored. Run **Reconciliation** regularly: matched payments are marked
reconciled, and anything received but not recorded (or the reverse) is listed. The test
provider is refused in production.

## WhatsApp (optional)

There is no SMS: it is charged per message, so it was removed. Notifications go in the app, by
email and by web push, which cost nothing. WhatsApp is also charged per message by the provider,
so it is off by default.

`WHATSAPP_DRIVER`: `none` (the default), `log` (printed), `twilio` (needs
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`) or `meta` (the WhatsApp Cloud API: `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_ID`
and an approved template `META_WHATSAPP_TEMPLATE` with one text parameter). Local numbers
(03xx…) are sent as +92. Every attempt is in `delivery_logs`.

Once it is on, people can also get notifications by WhatsApp when their institution turns on
"notifications by phone" (Communication → Messaging rules) — the institution pays for the
messages. Emergency broadcasts use every channel that is on. A failed message is retried
automatically (5, 20 and 40 minutes later) and can be retried from Communication → Delivery.
The `notify.digest` job (every hour, at :10) sends daily (18:00 local) and weekly (Mondays)
digests.

The `fees.daily` job (03:00 UTC) charges late fines and sends the day's reminders for every
institution, each once per invoice, step and channel.

## Platform billing and sign-in

Card payments of the platform's own invoices: `BILLING_STRIPE_SECRET_KEY` and
`BILLING_STRIPE_WEBHOOK_SECRET` (webhook `API_PUBLIC_URL/billing/stripe/webhook`, event
`checkout.session.completed`). Google / Microsoft sign-in: `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` /
`MICROSOFT_TENANT`, redirect URIs `API_PUBLIC_URL/auth/sso/<provider>/callback`. Jobs:
`usage.daily` (00:20 UTC), `billing.monthly` (1st, 04:00), `billing.dunning` (04:30),
`tenants.cleanup` (03:45), `privacy.retention` (02:15), `reports.scheduled` (hourly, :05),
`library.overdue` (06:00). Load test: see [platform.md](platform.md#load-test).

## Secrets

Never commit credentials. `npm run secrets:check` scans the staged changes (connection strings
with passwords, API keys, tokens, private keys, passwords in config) and is run before every
commit; CI runs gitleaks on every push (`.gitleaks.toml` allows only throwaway test values and
the public demo password).

## Live classes

Each institution connects its own Zoom (Server-to-Server OAuth app, scope `meeting:write`),
Microsoft Teams (Entra app with `OnlineMeetings.ReadWrite.All` and an application access
policy for the organizer) or Google Meet (service account with domain-wide delegation for
`calendar.events`) under Communication → Live classes; secrets are sealed like payment keys.
Zoom sends joins and recordings to `API_PUBLIC_URL/integrations/zoom/webhook/<institution
id>` (signature checked with the app's secret token). `LIVE_DRIVER=fake` is for tests only.

## Installable app and offline

`apps/web/public/sw.js` caches the app shell and the build's hashed assets, keeps the last good
copy of dashboards, course lists, notifications and conversations, and serves what people
saved for offline. Signing out clears the cached data. The service worker is registered in
production builds only; after a deploy, the new version takes over on the next visit.

## AI

Save the Gemini and/or Groq key in **Platform → API management** (or set `GEMINI_API_KEY` /
`GROQ_API_KEY`) and pick the model of each feature there — see [ai.md](ai.md). Search
embeddings use Gemini and captions use Whisper on Groq; without keys the built-in test provider
answers and search uses local embeddings. (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` only keep older
setups working.) `AI_DISABLED=true`
turns every AI feature off. Budgets: `AI_BUDGET_FREE_USD`, `AI_BUDGET_PRO_USD`,
`AI_BUDGET_ENTERPRISE_USD` (per month; institutions can set a lower cap). Spend is in
`ai_usage`. The `risk.nightly` job (01:30 UTC) scores students for early warning.

## End-to-end tests

`npm run e2e` runs the Playwright journeys against the dev servers and the database in
`apps/api/.env` with demo data (`npm run db:seed`). Each run adds a module, a page and an
assignment named `E2E …` to a Greenwood course, and the Phase 3 journeys pay one of the demo
guardian's invoices with the test provider and publish an `E2E exam …` series; reseed to
clear them.
