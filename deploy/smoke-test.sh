#!/usr/bin/env bash
# Starts a throw-away self-host stack on this machine and checks that it works: images build, migrations
# run, the web app answers over HTTPS, the worker starts with its private key, and the app connects to
# the database as the restricted (row-level-security) role. Removes everything afterwards.
#
# Needs Docker and free ports 8080/8443. Takes a few minutes the first time. Refuses to run if
# deploy/.env exists, so it can never touch a real installation.
set -euo pipefail
cd "$(dirname "$0")"
[ -e .env ] && { echo "deploy/.env exists: this test only runs on a machine without an installation." >&2; exit 1; }
compose=(docker compose -f docker-compose.yml --profile trial)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -f .env; }
trap cleanup EXIT

DOMAIN=localhost SMTP=2 HTTPS_PORT_OVERRIDE=8443 HTTP_PORT_OVERRIDE=8080 ./setup.sh >/dev/null
"${compose[@]}" up -d --build --wait

fail() { echo "FAIL: $*" >&2; "${compose[@]}" logs --tail=40 >&2; exit 1; }
[ "$(curl -sk https://localhost:8443/api/health)" = '{"ok":true}' ] || fail "health check"
code="$(curl -sk -o /dev/null -w '%{http_code}' https://localhost:8443/)"
[ "$code" = "307" ] || fail "home page should redirect to sign-in in self-host mode (got $code)"
"${compose[@]}" logs worker 2>&1 | grep -q '"worker ready"' || fail "worker did not start"
role="$("${compose[@]}" exec -T postgres psql -U triagefox -d triagefox -Atc "select rolbypassrls from pg_roles where rolname='triagefox_app'")"
[ "$role" = "f" ] || fail "runtime role must not bypass row-level security"
tables="$("${compose[@]}" exec -T postgres psql -U triagefox -d triagefox -Atc "select count(*) from pg_tables where schemaname='public' and tablename='issues'")"
[ "$tables" = "1" ] || fail "migrations did not run"
echo "Self-host smoke test passed."
