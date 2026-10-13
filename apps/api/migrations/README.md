# Legacy migrations (frozen)

The four SQL files in `legacy/` built the schema before Drizzle was introduced (Phase 0A).
They are kept only so that databases created back then can be brought up to date: the
runner applies any of them that such a database is missing, then records Drizzle's
`0000_baseline` as already applied (it describes the same schema).

New databases skip them and start from `../drizzle/0000_baseline.sql`.
**Never edit these files** — their checksums are recorded in existing databases.
New schema changes go in `src/db/schema/` + `npm run db:generate`.
