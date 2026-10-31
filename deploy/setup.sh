#!/usr/bin/env bash
# Prepares a TriageFox self-host install: asks where it will live, generates every secret and writes
# deploy/.env (readable by you only). Secrets are never printed. Safe to run once; it refuses to
# overwrite an existing deploy/.env.
#
# Non-interactive:  DOMAIN=triage.example.com SMTP=skip ./deploy/setup.sh
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the 'docker compose' command)."
command -v openssl >/dev/null || die "openssl is needed to generate passwords."
[ -e "$ENV_FILE" ] && die "deploy/.env already exists. Edit it, or delete it to start over (this would replace your secrets)."

DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  say "Where will TriageFox live?"
  say "  Enter the domain you point at this server (for example triage.example.com),"
  say "  or just press Enter to try it on this machine at https://localhost."
  read -r -p "Domain [localhost]: " DOMAIN
  DOMAIN="${DOMAIN:-localhost}"
fi
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "That doesn't look like a domain name: $DOMAIN"

HTTP_PORT=80; HTTPS_PORT=443
if [ "$DOMAIN" = "localhost" ]; then
  APP_URL="https://localhost"
  if [ -n "${HTTPS_PORT_OVERRIDE:-}" ]; then HTTPS_PORT="$HTTPS_PORT_OVERRIDE"; HTTP_PORT="${HTTP_PORT_OVERRIDE:-8080}"; APP_URL="https://localhost:${HTTPS_PORT}"; fi
else
  APP_URL="https://${DOMAIN}"
fi

SMTP="${SMTP:-}"
if [ -z "$SMTP" ]; then
  say ""
  say "Email: TriageFox sends sign-up and invitation emails."
  say "  1) I have an SMTP provider (Resend, Postmark, your own server...)"
  say "  2) Just trying it: catch emails locally (Mailpit)"
  read -r -p "Choose 1 or 2 [2]: " SMTP
  SMTP="${SMTP:-2}"
fi

say ""
say "Building the images (the first time takes a few minutes)..."
# Plain docker commands: Compose would refuse to start before deploy/.env exists.
# With WORKER_IMAGE set (a published image) nothing is built here.
WORKER_IMAGE="${WORKER_IMAGE:-}"
if [ -n "$WORKER_IMAGE" ]; then
  docker pull -q "$WORKER_IMAGE" >/dev/null
  KEYS_IMAGE="$WORKER_IMAGE"
else
  docker build -q -f Dockerfile --target worker -t triagefox/worker:local .. >/dev/null
  KEYS_IMAGE="triagefox/worker:local"
fi

say "Generating secrets..."
SECRETS="$(docker run --rm --entrypoint node "$KEYS_IMAGE" dist/keys.js)"
[ -n "$SECRETS" ] || die "Could not generate the encryption keys."

umask 077
cp .env.example "$ENV_FILE"
set_var() { # set_var NAME VALUE  (VALUE may contain any character except newline)
  local name="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v n="$name" -v v="$value" 'BEGIN{FS=OFS="="} $1==n && !done {print n "=" v; done=1; next} {print}' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
set_var SITE_ADDRESS "$DOMAIN"
set_var APP_URL "$APP_URL"
set_var HTTP_PORT "$HTTP_PORT"
set_var HTTPS_PORT "$HTTPS_PORT"
if [ -n "$WORKER_IMAGE" ] && [ -n "${WEB_IMAGE:-}" ]; then
  set_var WORKER_IMAGE "$WORKER_IMAGE"
  set_var WEB_IMAGE "$WEB_IMAGE"
  set_var TRIAGEFOX_PULL always
fi
set_var POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_var APP_DB_PASSWORD "$(openssl rand -hex 24)"
set_var REDIS_PASSWORD "$(openssl rand -hex 24)"
while IFS= read -r line; do
  [ -n "$line" ] && set_var "${line%%=*}" "${line#*=}"
done <<< "$SECRETS"
unset SECRETS
if [ "$SMTP" = "2" ] || [ "$SMTP" = "skip" ]; then
  set_var SMTP_HOST mailpit
  set_var SMTP_PORT 1025
fi
chmod 600 "$ENV_FILE"

say ""
say "Done. deploy/.env was created (readable only by you)."
say ""
say "Next:"
say "  1. Back up CRYPTO_PRIVATE_KEYS from deploy/.env somewhere safe, apart from database backups."
say "  2. Register your own Crisp plugin, and a Trello key and/or Atlassian app, and add them to"
say "     deploy/.env. Step by step: docs/self-hosting.md"
say "  3. Set OPENAI_API_KEY (or let each workspace enter its own key in the app)."
if [ "$SMTP" = "1" ]; then
  say "  4. Fill in SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM for your email provider."
  say "  5. Start it:   docker compose -f deploy/docker-compose.yml up -d"
else
  say "  4. Start it:   docker compose -f deploy/docker-compose.yml --profile trial up -d"
  say "     Sign-up emails then appear at http://127.0.0.1:8025 on this machine."
fi
say ""
say "Then open ${APP_URL} and create the first account."
