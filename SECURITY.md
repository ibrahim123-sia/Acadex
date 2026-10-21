# Security policy

Acadex holds personal data about students, families and staff, so security reports are taken
seriously and handled first.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Include:

- what is affected (endpoint, page or file) and the impact you expect;
- the steps to reproduce it, with the smallest example that shows it;
- any logs, requests or screenshots that help — with real personal data removed.

You will get an acknowledgement within **3 working days** and an assessment within
**10 working days**. Fixes for confirmed issues are prioritised by severity; you will be told
when a fix is released and, if you wish, credited for the report.

## Scope

In scope: the API (`apps/api`), the web app (`apps/web`), the shared package
(`packages/shared`), the Cloudflare Worker (`cloudflare/`), the backup scripts (`ops/`) and the CI
workflows.

Out of scope: denial-of-service and load testing, social engineering, physical attacks, reports
from automated scanners without a demonstrated impact, and issues in third-party services
(Stripe, JazzCash, Easypaisa, Google, Microsoft, AI providers) that should go to those vendors.

## Supported versions

Only the latest version on the `main` branch receives security fixes.

## Good-faith research

Test only against your own local setup (`npm run db:seed` creates demo data). Do not access,
change or delete other people's data, and do not test against a production deployment without
written permission. Research done in good faith under this policy will not be pursued.

## How the project protects data

- Every institution's data is isolated twice: in application code and by PostgreSQL row-level
  security.
- Passwords are hashed with bcrypt; sessions use short-lived access tokens and rotating refresh
  tokens; two-step verification (authenticator app or emailed code) is required for
  administrators in production.
- Secrets (payment credentials, AI keys, two-step secrets) are encrypted at rest with
  AES-256-GCM.
- Every commit is scanned for credentials (`npm run secrets:check` locally, gitleaks in CI), and
  dependencies are audited in CI.
