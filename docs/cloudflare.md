# Acadex on Cloudflare

This guide explains how Acadex runs on Cloudflare, what was added to the code for it, and the
exact steps to put it live. Everything Cloudflare-specific lives in [`cloudflare/`](../cloudflare)
plus one manual GitHub workflow; the app itself is unchanged and still runs anywhere else
(Docker Compose, a VPS) exactly as before.

## Mukhtasar (Roman Urdu)

- **Kya bana hai:** ek Cloudflare **Worker** sab se aage hai. Web app ke pages (React build) Worker
  ke **static assets** se aate hain. `/api/...` wali har request Worker aage **API container** ko
  bhejta hai — yeh wahi `apps/api/Dockerfile` hai jo pehle se tha, bas ab Cloudflare Containers
  par chalta hai. Database **Neon** hi rahega. Files (uploads, PDFs) **R2** mein jayengi (S3 driver
  ke zariye). Har 5 minute Worker ka **cron trigger** API ko jagata hai aur scheduled jobs
  (reminders, billing, reports) chalwata hai.
- **Connect kaise hua:** code aur config main ne repo mein tayyar kiye (`cloudflare/wrangler.jsonc`,
  `cloudflare/src/index.ts`, deploy workflow). Aap ke Cloudflare account mein main ne **kuch nahi
  banaya aur deploy nahi kiya** — woh qadam neeche "One-time setup" mein hain: `wrangler login`,
  R2 bucket, secrets (`wrangler secret put`), phir `wrangler deploy` ya GitHub par "Deploy to
  Cloudflare" button.
- **Secrets** kabhi repo mein nahi: sirf `npx wrangler secret put NAME` (app ke secrets) aur GitHub
  repository secrets (sirf `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
- **Cloudflare ke baghair** kuch nahi badalta: naye settings default mein band hain.

## What runs where

| Part | Runs on | From |
|---|---|---|
| Web app (React, the PWA, service worker) | Worker static assets, served from Cloudflare's edge | `apps/web/dist` (built by `npm run build:web`) |
| Front door: routing, client IP, cron | Cloudflare Worker `acadex` | `cloudflare/src/index.ts` |
| API (Express, jobs, PDFs, AI calls) | Cloudflare Container `AcadexApi` (a Durable Object owns each instance) | `apps/api/Dockerfile` |
| Database | Neon PostgreSQL (unchanged) | `DATABASE_URL`, `DATABASE_DIRECT_URL` |
| Files: uploads, submissions, exports, PDFs | Cloudflare R2 bucket `acadex-files` | the API's S3 driver (`STORAGE_DRIVER=s3`) |
| Scheduled jobs (nightly purge, reminders, billing, reports, early-warning) | Worker cron trigger every 5 minutes → API | `POST /api/internal/cron` |
| Live updates in open tabs | API (server-sent events through PostgreSQL NOTIFY) | `apps/api/src/lib/events.ts` |

```
 browser ──HTTPS──► Cloudflare edge
                      │
                      ├── /, /login, /teach/… ─► static assets (index.html for any app path)
                      │
                      └── /api/* ─► Worker ─► AcadexApi container :5000 ─► Neon (SQL)
                                                     │                   └► R2 (files, S3 API)
 cron */5 ─► Worker.scheduled ─► POST /api/internal/cron (secret header) ─► pg-boss queue
```

## How a request travels

1. The browser asks for `https://your-domain/teach`. No Worker code runs: Cloudflare finds no file
   called `teach`, and because `not_found_handling` is `single-page-application` it returns
   `index.html`; React then draws the page.
2. The page calls `/api/me/dashboard`. `run_worker_first: ["/api/*"]` sends this to the Worker.
3. The Worker (`toApi` in `cloudflare/src/index.ts`):
   - refuses `/api/internal/*` from the internet (404);
   - removes `X-Forwarded-*` and `x-acadex-cron` headers a browser might have set;
   - adds `X-Forwarded-For` (the real client IP from `CF-Connecting-IP`), `-Proto` and `-Host`;
   - forwards the request to the container. The API trusts exactly one proxy (`TRUST_PROXY=true`, one hop), so
     rate limits and audit logs see the real client IP.
4. If the container is asleep, Cloudflare starts it first (a cold start of a few seconds; the image
   runs `node dist/db/migrate.js` before serving, and migrations are protected by an advisory lock).
5. The container answers; after `sleepAfter` (15 minutes) without requests it stops. The 5-minute
   cron tick counts as a request, so in practice the API stays warm; raise the tick interval or
   lower `sleepAfter` to save cost on a quiet test site.

## How scheduled jobs work

pg-boss normally runs the cron schedules inside the API process. A container that may sleep would
miss them, so on Cloudflare:

- The Worker passes `JOBS_SCHEDULE=external` to the container whenever `CRON_SECRET` is set. The API
  then does not register pg-boss schedules (and removes ones saved by an earlier run).
- Every 5 minutes the Worker's `scheduled()` handler calls `POST /api/internal/cron` with the header
  `x-acadex-cron: <CRON_SECRET>` and the tick time. The API checks every job's cron expression
  against the last 5 minutes (`apps/api/src/lib/cron.ts`) and queues the due ones with a
  per-minute key, so a retried tick never runs a job twice.
- The queued jobs, like every other job (emails, push, webhooks), are run by the pg-boss workers in
  the container.
- Without `CRON_SECRET` the endpoint does not exist (404) and pg-boss keeps its own schedules —
  that is the behaviour everywhere except Cloudflare.

## How files work

R2 speaks the S3 API, so the existing S3 driver is used as is: `S3_ENDPOINT` points at
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`, path-style URLs. The client
only adds the SDK's optional extra checksums when a store requires them (some S3-compatible stores
reject them). Files never touch the container's disk, which is temporary.

## Files added for Cloudflare

| File | What it does |
|---|---|
| `cloudflare/wrangler.jsonc` | The Worker's configuration: assets, the container (image, size, max instances), the cron trigger, plain variables. Values marked `REPLACE-ME` are yours. No secrets. |
| `cloudflare/src/index.ts` | The Worker: `AcadexApi` container class (port, sleep, environment), request routing, the cron tick. |
| `cloudflare/package.json`, `package-lock.json`, `tsconfig.json` | Its own small package (wrangler, `@cloudflare/containers`), outside the npm workspaces so it never affects the API and web builds or their Docker images. |
| `cloudflare/.dev.vars.example` | Names of the secrets for a local `wrangler dev`; copy to `.dev.vars` (git-ignored). |
| `.github/workflows/deploy-cloudflare.yml` | Manual deploy from GitHub Actions ("Run workflow" only — pushes never deploy). |
| `.github/workflows/ci.yml` → job `cloudflare` | Typechecks the Worker and validates the config with a dry run on every push (deploys nothing). |
| `apps/api/src/routes/internal.ts`, `apps/api/src/lib/cron.ts` | The cron endpoint and the cron matcher (inactive without `CRON_SECRET`). |
| `apps/api/src/config.ts` | `JOBS_SCHEDULE` (internal / external) and `CRON_SECRET`. |

## One-time setup

You need: a Cloudflare account on the **Workers Paid** plan (Containers require it), **Docker
Desktop** running on the computer that deploys (wrangler builds the API image), Node 22, and the
Neon database you already use.

### 1. Sign in to Cloudflare

```sh
cd cloudflare
npm ci
npx wrangler login          # opens the browser; approve access for wrangler
npx wrangler whoami         # shows your account id — you need it below
```

### 2. Create the R2 bucket and its keys

```sh
npx wrangler r2 bucket create acadex-files
```

Then in the dashboard: **R2 → Manage R2 API tokens → Create API token**, permission **Object Read
& Write**, limited to the bucket `acadex-files`. Keep the **Access Key ID** and **Secret Access
Key** for step 4. In `cloudflare/wrangler.jsonc` replace `REPLACE-ME-ACCOUNT-ID` in `S3_ENDPOINT`
with your account id.

### 3. Fill in the plain settings

In `cloudflare/wrangler.jsonc` → `vars`, set `APP_URL` and `CORS_ORIGINS` to the address people
will use (first deploy: `https://acadex.<your-subdomain>.workers.dev`; later your own domain) and
`MAIL_FROM`. Any other API setting from [`apps/api/.env.example`](../apps/api/.env.example) can be
added here the same way (for example `SMS_DRIVER`, `PUSH_DRIVER`).

### 4. Put in the secrets

Each command asks for the value and stores it encrypted in Cloudflare; it is never written to a
file or the repository.

```sh
npx wrangler secret put DATABASE_URL          # Neon: the pooled connection string (…-pooler…)
npx wrangler secret put DATABASE_DIRECT_URL   # Neon: the direct one (jobs use LISTEN/NOTIFY)
npx wrangler secret put JWT_SECRET            # openssl rand -hex 32
npx wrangler secret put MFA_ENCRYPTION_KEY    # openssl rand -hex 32  (keep the one you already use!)
npx wrangler secret put S3_ACCESS_KEY_ID      # from step 2
npx wrangler secret put S3_SECRET_ACCESS_KEY  # from step 2
npx wrangler secret put SMTP_URL              # smtp://user:pass@smtp.provider.com:587
npx wrangler secret put CRON_SECRET           # openssl rand -hex 32
# only the ones you use:
npx wrangler secret put GEMINI_API_KEY        # or save the AI keys later in Platform → API management
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put BILLING_STRIPE_SECRET_KEY
npx wrangler secret put BILLING_STRIPE_WEBHOOK_SECRET
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put VAPID_PRIVATE_KEY
```

If you move an existing installation, reuse its `MFA_ENCRYPTION_KEY`: sealed values (two-factor
secrets, payment and provider keys) can only be opened with the key that sealed them.
`npx wrangler secret list` shows which names are set (never their values).

### 5. Deploy

```sh
npm run build:web           # builds apps/web/dist
npx wrangler deploy         # uploads the Worker and assets, builds and pushes the API image
```

The first deploy takes a few minutes (the image is built and uploaded). Open the `workers.dev`
address it prints; the first API request starts the container and runs any pending migrations.

Demo data: as before, `npm run db:seed` from your computer against the demo database only.

### 6. Your domain

Add the domain to Cloudflare (**Websites → Add a site**, then change the nameservers at your
registrar). In `wrangler.jsonc` uncomment `routes` with your hostname and `"custom_domain": true`,
update `APP_URL` and `CORS_ORIGINS`, and deploy again. Cloudflare issues the certificate.

Institutions' own white-label domains (`custom_domains` in Acadex) use **Cloudflare for SaaS**:
in your zone enable **SSL/TLS → Custom Hostnames**, set a fallback origin (your Acadex hostname),
and add each verified institution domain as a custom hostname; the institution points a CNAME at
your fallback hostname. Acadex already verifies ownership by DNS before using the domain.

### 7. Deploy from GitHub instead (optional)

Create an API token (**My Profile → API Tokens → Create Token**): start from the **Edit Cloudflare
Workers** template and make sure it can also edit **Containers** (the permission names in the
dashboard change from time to time — the deploy log says which one is missing). Add two repository secrets:
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Then **Actions → Deploy to Cloudflare → Run
workflow** builds the web app and deploys the chosen branch. The app's own secrets stay in
Cloudflare (step 4); GitHub never sees them.

## Day-to-day operations

| Task | How |
|---|---|
| Live logs (Worker and container) | `npx wrangler tail`, or the dashboard: **Workers & Pages → acadex → Observability** |
| Roll back a bad deploy | `npx wrangler deployments list`, then `npx wrangler rollback <version-id>` |
| Change a setting | edit `vars` and deploy, or `npx wrangler secret put NAME` (takes effect when the container restarts — deploy, or wait for it to sleep) |
| Rotate a secret | `wrangler secret put` the new value; for `JWT_SECRET`, access tokens are reissued silently on the next refresh (nobody is signed out) |
| More capacity | raise `API_INSTANCES` (requests are spread over that many containers) and `max_instances`; or a bigger `instance_type` |
| Backups | Neon's point-in-time restore, plus `ops/backup.sh` (encrypted dumps) as before; R2 keeps files durably — enable bucket versioning if you want older copies |
| Health | `https://your-domain/api/health` |

Several API containers are safe: live updates go through PostgreSQL NOTIFY, jobs through the shared
pg-boss queue, migrations take an advisory lock. Rate limits are counted per container.

## Costs to keep in mind

Check Cloudflare's current pricing for Workers Paid, Containers (billed while a container runs, by
instance size), R2 (storage and operations; no egress fees) and Neon separately. The biggest lever is
how long the API container runs: with the 5-minute tick and `sleepAfter = '15m'` it effectively runs
all the time, which is what a school using it daily wants.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `wrangler deploy`: "The Docker CLI is needed" | start Docker Desktop (the API image is built locally) |
| Pages load, every `/api` call fails with 500 | a required secret is missing — `npx wrangler tail` shows the API's startup message listing what is wrong (`DATABASE_URL`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY` in production) |
| Uploads fail | `S3_ENDPOINT` still has `REPLACE-ME`, or the R2 token is not limited to / allowed on `acadex-files` |
| Sign-in works but you are signed out on refresh | `APP_URL` / `CORS_ORIGINS` don't match the address in the browser, or `COOKIE_SECURE` is not `true` on HTTPS |
| Reminders and nightly jobs never run | `CRON_SECRET` not set (the tick does nothing without it) — check **Triggers** in the dashboard and `wrangler tail` around a multiple of 5 minutes |
| Every first request of the morning is slow | the container slept; keep the tick, or raise `sleepAfter` |
| Emails don't arrive | use your provider's SMTP on port 587 or 465 (port 25 is blocked) and check `MAIL_FROM` is a sender your provider allows |
