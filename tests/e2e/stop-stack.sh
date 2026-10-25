#!/usr/bin/env bash
# Stops everything start-stack.sh / run.sh started (by pid file, never by pattern),
# then Postgres, and restores a hand-written .env.local that start-stack.sh moved aside.
#   KEEP_DB=1 bash tests/e2e/stop-stack.sh   leave Postgres running
set -euo pipefail
source "$(dirname "$0")/config.sh"

for s in next postgrest gotrue gateway storage smtp; do
  if pid_alive "$s"; then log "stopping $s"; fi
  stop_bg "$s"
done
if [ "${KEEP_DB:-0}" != 1 ] && pg_running; then
  log "stopping Postgres"
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA_DIR" stop -m fast >/dev/null 2>&1 || true
fi

ENV_LOCAL="$REPO_ROOT/.env.local"
if [ -f "$ENV_LOCAL.e2e-backup" ]; then
  mv -f "$ENV_LOCAL.e2e-backup" "$ENV_LOCAL"
  log "restored your .env.local"
fi
log "stack stopped"
