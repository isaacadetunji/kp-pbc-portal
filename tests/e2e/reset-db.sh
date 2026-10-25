#!/usr/bin/env bash
# Recreates the throwaway Postgres cluster from scratch and applies, in order:
#   1. tests/e2e/sql/platform_bootstrap.sql   roles, schemas, Supabase default privileges
#   2. GoTrue's own migrations (`auth migrate`) into the real `auth` schema
#   3. supabase/tests/supabase_stubs.sql       (no-ops for auth.users; adds storage.buckets)
#   4. supabase/migrations/*.sql               in filename order
#   5. supabase/seed.sql
# Also clears the mail and storage directories. Services that hold DB connections
# (GoTrue, PostgREST) are stopped first; start-stack.sh brings them back.
# Leaves Postgres running.
set -euo pipefail
source "$(dirname "$0")/config.sh"

[ -x "$GOTRUE_DIR/auth" ] || die "GoTrue missing; run tests/e2e/setup.sh first"

stop_bg gotrue
stop_bg postgrest
if pg_running; then
  log "stopping Postgres"
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA_DIR" stop -m immediate >/dev/null 2>&1 || true
fi
port_open "$PG_PORT" && die "port $PG_PORT is in use by another process (set PG_PORT)"

mkdir -p "$KP_E2E_STATE" "$LOG_DIR" "$PID_DIR"
chmod 755 "$KP_E2E_STATE"
rm -rf "$PGDATA_DIR" "$PG_SOCKET_DIR" "$MAIL_DIR" "$STORAGE_DIR"
mkdir -p "$PGDATA_DIR" "$PG_SOCKET_DIR" "$MAIL_DIR" "$STORAGE_DIR"
if [ "$(id -u)" = "0" ]; then
  id "$PG_OS_USER" >/dev/null 2>&1 || useradd -M "$PG_OS_USER"
  chown "$PG_OS_USER" "$PGDATA_DIR" "$PG_SOCKET_DIR"
  touch "$LOG_DIR/postgres.log" && chown "$PG_OS_USER" "$LOG_DIR/postgres.log"
fi
chmod 700 "$PGDATA_DIR"

log "initdb"
"${RUNAS[@]}" "$PGBIN/initdb" -D "$PGDATA_DIR" -U postgres -A trust --no-sync >/dev/null
log "starting Postgres on 127.0.0.1:$PG_PORT"
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA_DIR" -w -t 30 -l "$LOG_DIR/postgres.log" \
  -o "-p $PG_PORT -k $PG_SOCKET_DIR -h 127.0.0.1 -c timezone=UTC -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200" \
  start >/dev/null

log "platform bootstrap"
"${PSQL[@]}" -f "$E2E_DIR/sql/platform_bootstrap.sql"

log "GoTrue migrations (auth schema)"
(
  cd "$GOTRUE_DIR"
  GOTRUE_DB_DRIVER=postgres DATABASE_URL="$GOTRUE_DATABASE_URL" GOTRUE_DB_NAMESPACE=auth \
    GOTRUE_DB_MIGRATIONS_PATH="$GOTRUE_DIR/migrations" GOTRUE_JWT_SECRET="$JWT_SECRET" \
    GOTRUE_SITE_URL="$APP_URL" API_EXTERNAL_URL="$SUPABASE_URL/auth/v1" \
    ./auth migrate >"$LOG_DIR/gotrue-migrate.log" 2>&1
) || { tail -30 "$LOG_DIR/gotrue-migrate.log"; die "GoTrue migrations failed"; }

log "supabase_stubs.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/supabase_stubs.sql"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  log "migration $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
log "seed.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/seed.sql"
log "database ready"
