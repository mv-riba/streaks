#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL, applies a Neon stub (neon_auth."user", Data API roles,
# auth.user_id()) + all migrations as the non-superuser neondb_owner, and runs the tests in
# neon/tests. Also runs 0002_import_my_data.sql with its placeholders replaced by test users.
# Requires PostgreSQL 15+ binaries. Never touches the real Neon database.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="${PG_BIN:-$(dirname "$(command -v postgres 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/postgres | tail -1)")}"
TMP="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -M pgtest
  chown -R pgtest "$TMP"
  RUN_AS="runuser -u pgtest --"
fi
cleanup() { $RUN_AS "$PG_BIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

$RUN_AS "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
$RUN_AS "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null

SUPER=(psql -h "$TMP" -p "$PORT" -U postgres -d neondb -v ON_ERROR_STOP=1 -q)
OWNER=(psql -h "$TMP" -p "$PORT" -U neondb_owner -d neondb -v ON_ERROR_STOP=1 -q)
quiet() { sed "s/^psql:[^ ]* NOTICE:  /  /"; }

# Like Neon: neondb is owned by neondb_owner, so it owns the public schema.
psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c "create role neondb_owner login" -c "create database neondb owner neondb_owner"
"${SUPER[@]}" -f neon/tests/_neon_stub.sql
echo "applying neon/migrations/0001_init.sql"
"${OWNER[@]}" -f neon/migrations/0001_init.sql
"${SUPER[@]}" -c "insert into neon_auth.\"user\" (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com')" \
  -c "insert into neon_auth.session (\"userId\") values ('11111111-1111-1111-1111-111111111111')"
"${OWNER[@]}" -o /dev/null -f neon/tests/database.test.sql 2>&1 | quiet

# 0002 is generated from a private export and kept out of git; test it when present.
if [ ! -f neon/migrations/0002_import_my_data.sql ]; then
  echo "skipping import tests: neon/migrations/0002_import_my_data.sql not present (local-only file)"
  exit 0
fi
echo "applying neon/migrations/0002_import_my_data.sql (test users)"
"${SUPER[@]}" -c "insert into neon_auth.\"user\" (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'first@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'second@example.com')"
sed -e "s/':new_user_id'/'33333333-3333-3333-3333-333333333333'/" \
    -e "s/':second_user_id'/'44444444-4444-4444-4444-444444444444'/" \
    neon/migrations/0002_import_my_data.sql > "$TMP/0002.sql"
"${OWNER[@]}" -o /dev/null -f "$TMP/0002.sql"
"${OWNER[@]}" -f "$TMP/0002.sql" -o /dev/null # re-run must be a no-op
"${OWNER[@]}" -o /dev/null -f neon/tests/import.test.sql 2>&1 | quiet
