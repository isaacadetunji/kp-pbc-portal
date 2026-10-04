#!/usr/bin/env bash
# Spin up a throwaway Postgres 16, apply Supabase stubs + migrations + seed,
# then run the RLS/workflow test script. Usage: bash supabase/tests/run-local.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -M pgtest
  chown -R pgtest "$DATA"; RUNAS="runuser -u pgtest --"
fi
cleanup() { $RUNAS "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
$RUNAS "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c timezone=UTC" -l "$DATA/log" start >/dev/null
sleep 1
PSQL="psql -h /tmp -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f "$HERE/supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "-> $(basename "$f")"; $PSQL -f "$f"; done
echo "-> seed.sql"; $PSQL -f "$ROOT/supabase/seed.sql"
$PSQL -f "$ROOT/supabase/seed.sql"   # re-runnable
echo "-> tests"; $PSQL -f "$HERE/rls_workflow_test.sql" >/dev/null 2>"$DATA/test.err" || { grep -v "^psql.*NOTICE:  ok" "$DATA/test.err" | tail -20; exit 1; }
grep -c "NOTICE:  ok" "$DATA/test.err" | xargs -I{} echo "{} assertions passed"
echo "ALL DATABASE TESTS PASSED"
