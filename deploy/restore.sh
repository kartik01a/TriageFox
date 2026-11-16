#!/usr/bin/env bash
# Restores a backup made by backup.sh into the running database. This REPLACES the current data.
# Usage: ./deploy/restore.sh deploy/backups/triagefox-<date>.sql.gz[.age|.enc]
#   .age: set BACKUP_AGE_IDENTITY to the file holding the age PRIVATE key (AGE-SECRET-KEY-1...)
#   .enc: set BACKUP_PASSPHRASE
set -euo pipefail
cd "$(dirname "$0")"
file="${1:-}"; [ -f "$file" ] || [ -f "../$file" ] || { echo "Usage: restore.sh <backup file>" >&2; exit 1; }
[ -f "$file" ] || file="../$file"
if [[ "$file" == *.age ]]; then
  [ -f "${BACKUP_AGE_IDENTITY:-}" ] || { echo "Set BACKUP_AGE_IDENTITY to your age private key file." >&2; exit 1; }
  # Check the key opens this file before anything is deleted.
  age -d -i "$BACKUP_AGE_IDENTITY" "$file" | gunzip -t || { echo "That key cannot open this backup." >&2; exit 1; }
fi
read -r -p "This replaces ALL current data with the backup. Type 'restore' to continue: " ok
[ "$ok" = "restore" ] || { echo "Cancelled."; exit 1; }
compose=(docker compose -f docker-compose.yml)
"${compose[@]}" stop web worker
"${compose[@]}" exec -T postgres psql -U triagefox -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS triagefox WITH (FORCE)" -c "CREATE DATABASE triagefox"
"${compose[@]}" exec -T postgres psql -U triagefox -d triagefox -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
if [[ "$file" == *.age ]]; then
  age -d -i "$BACKUP_AGE_IDENTITY" "$file" | gunzip
elif [[ "$file" == *.enc ]]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" | gunzip
else
  gunzip -c "$file"
fi | "${compose[@]}" exec -T postgres psql -U triagefox -d triagefox -v ON_ERROR_STOP=1 >/dev/null
# The restricted runtime role keeps its rights through the database defaults; re-grant to be sure.
"${compose[@]}" exec -T postgres psql -U triagefox -d triagefox -v ON_ERROR_STOP=1 -c \
  "GRANT USAGE ON SCHEMA public TO triagefox_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO triagefox_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO triagefox_app; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO triagefox_app;"
"${compose[@]}" up -d web worker
echo "Restored."
