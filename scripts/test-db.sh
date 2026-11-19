#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL, applies a Supabase auth stub + all migrations,
# and runs supabase/tests/database.test.sql. Requires PostgreSQL 15+ binaries.
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

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/_auth_stub.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -o /dev/null -f supabase/tests/database.test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"
