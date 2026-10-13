#!/usr/bin/env bash
# Logical backup of the Acadex database (complements Neon's built-in point-in-time restore).
#
#   DATABASE_URL=postgres://... ops/backup.sh [output-dir]
#
# Writes acadex-<UTC timestamp>.dump (pg_dump custom format). If BACKUP_ENCRYPTION_KEY is set
# the file is encrypted with AES-256 (openssl) and gets a .enc suffix; if BACKUP_S3_URI is set
# (e.g. s3://my-bucket/acadex) it is uploaded with the AWS CLI (works with R2/MinIO via
# AWS_ENDPOINT_URL). Prints the path of the backup file on the last line.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/acadex-$STAMP.dump"

echo "Dumping database…" >&2
pg_dump --format=custom --no-owner --no-privileges --compress=6 --file="$FILE" "$DATABASE_URL"

if [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_ENCRYPTION_KEY
  rm -f "$FILE"
  FILE="$FILE.enc"
fi

sha256sum "$FILE" > "$FILE.sha256"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  echo "Uploading to $BACKUP_S3_URI…" >&2
  aws s3 cp "$FILE" "$BACKUP_S3_URI/" --only-show-errors
  aws s3 cp "$FILE.sha256" "$BACKUP_S3_URI/" --only-show-errors
fi

echo "Backup written: $FILE" >&2
echo "$FILE"
