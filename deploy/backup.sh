#!/usr/bin/env bash
# Backs up the TriageFox database to deploy/backups/triagefox-<date>.sql.gz (.age or .enc when encrypted).
#
# Settings (environment variables, all optional):
#   BACKUP_AGE_RECIPIENT  encrypt with this age PUBLIC key (age1...). Best choice: the private key that
#                         restores it stays with you, never on this server. Needs `age` (apt install age).
#   BACKUP_PASSPHRASE     or encrypt with a passphrase (simpler, but it then sits on this server)
#   BACKUP_UPLOAD_URL     copy the file off this server with an HTTP PUT to <this URL><file name>, e.g.
#                         an Oracle Object Storage pre-authenticated request (write-only) for a bucket
#   BACKUP_KEEP_DAYS      delete local backups older than this many days (default 14; the uploaded
#                         copies are not touched: give the bucket its own expiry rule)
# If a step fails and SMTP_* and ALERT_EMAIL are set in deploy/.env, an email says so.
#
# The dump holds your sealed Trello/Jira tokens. They can only be opened with CRYPTO_PRIVATE_KEYS from
# deploy/.env, which is NOT in the dump: back that up separately and keep it apart from the dumps.
#
# Daily at 03:15 server time (crontab -e), with the settings in a file only you can read:
#   15 3 * * * set -a; . "$HOME/.triagefox-backup.env"; "$HOME/triagefox/deploy/backup.sh" >>"$HOME/backup.log" 2>&1
set -euo pipefail
cd "$(dirname "$0")"

# Reads one value from deploy/.env without running the file as a script.
envval() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }

alert() {
  local host port to from user pass url
  host="$(envval SMTP_HOST)"; port="$(envval SMTP_PORT)"; to="$(envval ALERT_EMAIL)"
  user="$(envval SMTP_USER)"; pass="$(envval SMTP_PASSWORD)"; from="$(envval MAIL_FROM)"
  [[ -n "$host" && -n "$to" ]] || return 0
  from="$(sed -E 's/.*<([^>]+)>.*/\1/' <<<"$from")"
  if [[ "$(envval SMTP_SECURE)" == "true" ]]; then url="smtps://$host:${port:-465}"; else url="smtp://$host:${port:-587}"; fi
  # The password goes through a config on stdin, never the command line (other users could see that).
  printf 'Subject: TriageFox backup FAILED on %s\nFrom: %s\nTo: %s\n\n%s\nSee ~/backup.log on the server.\n' \
    "$(hostname)" "$from" "$to" "$1" |
    curl -sS -m 30 --ssl-reqd --url "$url" --mail-from "$from" --mail-rcpt "$to" --upload-file - \
      -K <(printf 'user = "%s:%s"\n' "$user" "$pass") >/dev/null || echo "Could not send the alert email." >&2
}
trap 'alert "The backup stopped at line $LINENO ($(date))."' ERR

mkdir -p backups
umask 077
stamp="$(date +%Y%m%d-%H%M%S)"
out="backups/triagefox-${stamp}.sql.gz"
docker compose -f docker-compose.yml exec -T postgres pg_dump -U triagefox -d triagefox --no-owner | gzip > "$out"
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  age -r "$BACKUP_AGE_RECIPIENT" -o "${out}.age" "$out"
  rm -f "$out"; out="${out}.age"
elif [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$out" -out "${out}.enc"
  rm -f "$out"; out="${out}.enc"
fi
echo "$(date '+%F %T') Backup written to deploy/${out} ($(du -h "$out" | cut -f1))"

if [ -n "${BACKUP_UPLOAD_URL:-}" ]; then
  # The URL is a secret (it allows uploads), so it is never printed.
  curl -fsS -m 600 --retry 3 -X PUT --upload-file "$out" "${BACKUP_UPLOAD_URL}$(basename "$out")" >/dev/null
  echo "$(date '+%F %T') Copied off the server as $(basename "$out")"
else
  echo "Copy it somewhere off this server (or set BACKUP_UPLOAD_URL), and keep CRYPTO_PRIVATE_KEYS backed up separately."
fi

find backups -name 'triagefox-*.sql.gz*' -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
