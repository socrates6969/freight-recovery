#!/usr/bin/env sh
# Create the freight_owner / freight_app roles and the freight_web(_test) databases on a fresh
# PostgreSQL (CI service container). Requires psql and superuser credentials in PG* env vars:
#   PGHOST PGPORT PGUSER PGPASSWORD (PGDATABASE defaults to postgres)
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
psql -v ON_ERROR_STOP=1 --dbname "${PGDATABASE:-postgres}" -f "$here/00-roles.sql"
