#!/usr/bin/env bash
# Backs up the TriageFox database to deploy/backups/triagefox-<date>.sql.gz (or .sql.gz.enc).
# Set BACKUP_PASSPHRASE to encrypt the file. Copy the result OFF this server.
#
# The dump holds your sealed Trello/Jira tokens. They can only be opened with CRYPTO_PRIVATE_KEYS from
# deploy/.env, which is NOT in the dump: back that up separately and keep it apart from the dumps.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
umask 077
stamp="$(date +%Y%m%d-%H%M%S)"
out="backups/triagefox-${stamp}.sql.gz"
docker compose -f docker-compose.yml exec -T postgres pg_dump -U triagefox -d triagefox --no-owner | gzip > "$out"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$out" -out "${out}.enc"
  rm -f "$out"; out="${out}.enc"
fi
echo "Backup written to deploy/${out}"
echo "Copy it somewhere off this server, and keep CRYPTO_PRIVATE_KEYS backed up separately."
