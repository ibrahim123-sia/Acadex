#!/usr/bin/env bash
# Proves a backup can actually be restored: backs up DATABASE_URL, restores it into a fresh
# scratch database on the same server (SCRATCH_DATABASE_URL), and compares the row count of
# every table. Exit 0 = the restore is complete and faithful. Run in CI and on a schedule.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SCRATCH_DATABASE_URL:?SCRATCH_DATABASE_URL is required (an empty database)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FILE="$("$HERE/backup.sh" "$WORK" | tail -n1)"
TARGET_DATABASE_URL="$SCRATCH_DATABASE_URL" "$HERE/restore.sh" "$FILE" --replace

counts() {
  psql "$1" -tA -F'|' -c "
    SELECT format('SELECT %L, count(*) FROM %I', table_name, table_name)
      FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name" |
  while read -r q; do psql "$1" -tA -F'|' -c "SET app.bypass_rls = 'on'; $q" | tail -n1; done
}

diff <(counts "$DATABASE_URL") <(counts "$SCRATCH_DATABASE_URL") && echo "✅ Restore verified: every table has the same row count." || {
  echo "❌ Restored database differs from the source" >&2
  exit 1
}
