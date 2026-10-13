# Security model (Phase 0A)

How the API decides who may do what. Phase 0B replaces the hard-coded roles with RBAC
tables, a `can()` guard and Postgres row-level security; the rules below stay the same.

## Sessions

- Login returns a JWT (HS256, 12 h by default, `JWT_EXPIRES_IN`). It carries the user id
  and the user's `token_version`.
- On **every** request `middleware/auth.js` re-reads the user and their school. The request
  is refused when the user is missing or deactivated (401), the token's version is older
  than the user's (401), or the school is suspended (403). The role and school used for
  authorization come from the database, never from the token.
- `POST /api/auth/logout` and `POST /api/auth/change-password` bump `token_version`, which
  revokes every token issued before. (Per-device sessions come with refresh tokens in 0B.)
- Failed logins are limited to 10 per 15 minutes per IP + email; the whole API to 600
  requests per minute per IP. Unknown emails take as long as wrong passwords.

## Passwords

- Accounts created by an admin (students, teachers) or by the platform (school admins)
  get a random 16-character one-time password, shown once to the creator. The account
  can only reach `/auth/me`, `/auth/change-password` and `/auth/logout` until the user sets
  their own password (≥ 10 characters, letters and digits, not the current one).
- Only the seeded demo accounts share the documented demo password; the seed refuses to
  run when `NODE_ENV=production`.

## Who can do what

| Endpoint group | Allowed | Extra checks |
|---|---|---|
| `/api/platform/*` | super admin | — |
| `/api/school/*` | school admin | every referenced id (`student_id`, `class_id`) must belong to the admin's school |
| `/api/me/teacher/*` | teacher | the class (and subject, if given) must be assigned to the teacher in `teacher_subjects`; every `student_id` in a batch must be enrolled in that class |
| `/api/me/student/*` | student | submissions only to assignments of the student's own class, http(s) links only |
| `/api/me/announcements` | teacher, student, parent | audience filtered by role |
| `/api/me/notifications` | everyone signed in | own notifications only |
| `/api/parent/*` | parent | child must be linked to the parent in `parent_children` in the same school |
| `/api/pdf/report-card/:id` | school admin, the student, a linked parent, a teacher of the student's class | other-school ids → 404 |
| `/api/pdf/fee-voucher/:id` | school admin, the student, a linked parent | teachers → 403 |

All self-service queries filter by the caller's `school_id` in addition to `ref_id`, so an
inconsistent row (e.g. from a bad import) can't expose another school's data.
Ownership helpers live in `backend/lib/access.js`; each rule has a denial test in
`backend/tests/`.

## Input and errors

- Request bodies, params and query strings are validated with Zod (`lib/validate.js`);
  invalid input → 400 with field-level details.
- Lists are paginated (`page`, `pageSize` ≤ 100) with totals in `X-Total-Count`.
- Batch writes (attendance, grades) are all-or-nothing transactions.
- One error handler (`lib/errors.js`) maps database errors to 400/409 with generic
  messages; internals are logged server-side only. Async handler errors can't crash the
  process.

## HTTP hardening

`helmet` security headers, CORS allow-list (`CORS_ORIGINS`), 100 kb JSON body limit,
`TRUST_PROXY` for correct client IPs behind a proxy, startup refuses a missing
`DATABASE_URL` or a `JWT_SECRET` shorter than 32 characters, and the database connection
verifies TLS certificates by default (`DATABASE_SSL`).

## Database changes

`npm run db:migrate` applies `db/migrations/NNNN_*.sql` once each, in a transaction, with
checksums (an edited applied migration is an error) and an advisory lock. Migrations that
contain `DROP`/`TRUNCATE` are refused unless marked `-- acadex:reviewed-destructive`.
