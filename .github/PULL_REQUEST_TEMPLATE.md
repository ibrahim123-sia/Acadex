## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one. -->

## How it was tested

<!-- Tests added or updated, and anything checked by hand (which role, desktop / 360 px). -->

## Checklist

- [ ] `npm run secrets:check`, `npm run typecheck`, `npm run lint` and `npm test` pass
- [ ] New or changed routes have permission checks, denial tests and OpenAPI entries
- [ ] Schema changes come with a generated, reviewed migration (forward-only, no data loss)
- [ ] New tables with `institution_id` have row-level security
- [ ] No credentials, real personal data or `.env` files are included
- [ ] User-facing changes are in `CHANGELOG.md` (and in-app "What's new" when people will notice)

## Needs a careful look

<!-- Migrations, money, permissions, personal data, AI prompts — or "nothing special". -->
