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
