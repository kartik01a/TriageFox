#!/bin/bash
# Creates the restricted runtime role and extensions.
# The owner (POSTGRES_USER) runs migrations and bypasses RLS. The app role does NOT own tables,
# so row-level security policies always apply to it.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE triagefox_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO triagefox_app;
GRANT USAGE ON SCHEMA public TO triagefox_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO triagefox_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO triagefox_app;
SQL
