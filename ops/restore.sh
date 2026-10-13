#!/usr/bin/env bash
# Restore an Acadex backup into a database.
#
#   TARGET_DATABASE_URL=postgres://... ops/restore.sh backups/acadex-20261013T020000Z.dump[.enc]
#
# Refuses to restore into a database that already has Acadex tables unless --replace is
# given (then existing objects are dropped first). Encrypted backups (.enc) need
# BACKUP_ENCRYPTION_KEY. Verifies the checksum when a .sha256 file sits next to the backup.
set -euo pipefail

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
FILE="${1:?usage: restore.sh <backup file> [--replace]}"
REPLACE="${2:-}"

if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum --check --status "$(basename "$FILE").sha256") || { echo "Checksum mismatch: $FILE" >&2; exit 1; }
fi

DUMP="$FILE"
if [[ "$FILE" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required for encrypted backups}"
  DUMP="$(mktemp)"
  trap 'rm -f "$DUMP"' EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$DUMP" -pass env:BACKUP_ENCRYPTION_KEY
fi

EXISTING="$(psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='schools'")"
if [[ "$EXISTING" != "0" && "$REPLACE" != "--replace" ]]; then
  echo "Target already contains Acadex data. Re-run with --replace to overwrite it." >&2
  exit 2
fi

ARGS=(--no-owner --no-privileges --exit-on-error)
[[ "$REPLACE" == "--replace" ]] && ARGS+=(--clean --if-exists)
echo "Restoring $FILE…" >&2
pg_restore "${ARGS[@]}" --dbname="$TARGET_DATABASE_URL" "$DUMP"
echo "Restore complete." >&2
