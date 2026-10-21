# Contributing to Acadex

Acadex is proprietary software (see [LICENSE](LICENSE)). These guidelines are for the people who
work on it with the owner's permission.

## Setting up

Follow [Getting started](README.md#getting-started) in the README: Node.js 22 (see `.nvmrc`),
`npm install`, copy `apps/api/.env.example` to `apps/api/.env`, then `npm run db:migrate`,
`npm run db:seed` and `npm run dev`.

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`.
2. Make small commits that each do one thing and leave the tests passing.
3. Run the checks below, then open a pull request. `main` is never pushed to directly or
   force-pushed.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary` in the
imperative, lower case, no full stop — for example `fix(finance): apply a webhook only once`.
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`. Scopes are usually
`api`, `web`, `shared`, `db`, `auth`, `ai`, `finance`, `lms`, `reach`, `cloudflare` or `ci`.

## Before every commit

```bash
npm run secrets:check   # no credential, key or token may ever be committed
npm run typecheck
npm run lint
npm test
```

`npm run e2e` runs the browser journeys (desktop and 360 px); run it when a change touches a
page or a flow.

Never commit `.env` files, real credentials, database dumps or real personal data. Test values
must be obviously fake (`test-…`, `example.test`).

## Rules that keep the platform safe

- **Tenant isolation.** Every query is filtered by `institution_id`, and every id a client sends
  is checked to belong to the caller's institution. New tables with an `institution_id` get
  row-level security in their migration (`tests/rls.test.ts` fails otherwise).
- **Permissions.** Every route declares what it needs (`requirePermission(...)`), and new
  endpoints get denial tests: another role, another teacher, another institution.
- **Validation.** Request bodies are parsed with the Zod schemas in `packages/shared`, the same
  ones the web forms use.
- **Migrations.** Change `apps/api/src/db/schema/`, run `npm run db:generate -w @acadex/api`,
  review the SQL and commit it. Migrations are forward-only: never edit one that has been
  merged, and never drop data without an explicitly reviewed migration.
- **Secrets at rest.** Credentials that Acadex stores (payment keys, AI keys, two-step secrets)
  are sealed with AES-256-GCM and never sent back to the browser.
- **AI.** Every AI call goes through `apps/api/src/ai/client.ts` (budgets, redaction, logging,
  off switches). Nothing an AI suggests is saved without a person approving it.
- **API documentation.** New routes are listed in `apps/api/src/openapi.ts` or
  `openapi-lms.ts`; `tests/openapi.test.ts` checks that every route is documented.

## Code style

- TypeScript strict mode everywhere; ESLint must pass (`npm run lint`).
- Interface text is English, written through `t('key', 'English text')` so it can be translated
  later.
- Comments explain *why*, not what the next line does.
- Match the style of the code around your change.

## Pull requests

Fill in the pull request template: what changed and why, how it was tested, and anything a
reviewer should look at closely (migrations, permissions, money, personal data). Keep a pull
request focused on one change; split unrelated work into separate ones.
