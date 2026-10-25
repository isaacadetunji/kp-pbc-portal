# Shared configuration for the local E2E stack. Sourced by every script.
# Every value can be overridden from the environment before calling a script.
# shellcheck shell=bash

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../.." && pwd)"

# Versions of the downloaded binaries (cached in $KP_E2E_CACHE)
GOTRUE_VERSION="${GOTRUE_VERSION:-v2.186.0}"
POSTGREST_VERSION="${POSTGREST_VERSION:-v12.2.3}"
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.63.0}"

# Where binaries live (survives runs) and where run-time state lives (wiped by reset-db.sh).
# The state dir must be traversable by the non-root Postgres user, so it is under /tmp by default.
KP_E2E_CACHE="${KP_E2E_CACHE:-$HOME/.cache/kp-e2e}"
KP_E2E_STATE="${KP_E2E_STATE:-/tmp/kp-e2e-state}"

# Ports
PG_PORT="${PG_PORT:-54322}"
GATEWAY_PORT="${GATEWAY_PORT:-54321}"
GOTRUE_PORT="${GOTRUE_PORT:-54331}"
POSTGREST_PORT="${POSTGREST_PORT:-54332}"
STORAGE_PORT="${STORAGE_PORT:-54333}"
SMTP_PORT="${SMTP_PORT:-54325}"
APP_PORT="${APP_PORT:-3000}"

# Hostname used by the browser and by email links. Keep "localhost" (cookies are per host).
E2E_HOST="${E2E_HOST:-localhost}"
SUPABASE_URL="${SUPABASE_URL:-http://$E2E_HOST:$GATEWAY_PORT}"
APP_URL="${APP_URL:-http://$E2E_HOST:$APP_PORT}"

# HS256 secret shared by GoTrue, PostgREST and the storage mock (local only)
JWT_SECRET="${JWT_SECRET:-kp-e2e-local-jwt-secret-at-least-32-characters-long}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPass#2026}"
STORAGE_BUCKET="${SUPABASE_STORAGE_BUCKET:-pbc-files}"

# Non-root OS user that owns the Postgres cluster when the scripts run as root
PG_OS_USER="${PG_OS_USER:-pgtest}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

PGDATA_DIR="$KP_E2E_STATE/pgdata"
PG_SOCKET_DIR="$KP_E2E_STATE/pgsock"
LOG_DIR="$KP_E2E_STATE/logs"
PID_DIR="$KP_E2E_STATE/pids"
MAIL_DIR="$KP_E2E_STATE/mail"
STORAGE_DIR="$KP_E2E_STATE/storage"
KEYS_ENV="$KP_E2E_STATE/keys.env"
BIN_DIR="$KP_E2E_CACHE/bin"
GOTRUE_DIR="$KP_E2E_CACHE/gotrue-$GOTRUE_VERSION"
DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/postgres?sslmode=disable"
# GoTrue works in the auth schema (like supabase_auth_admin, whose search_path is auth)
GOTRUE_DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/postgres?sslmode=disable&search_path=auth"

# Never send local traffic through the outbound proxy
export NO_PROXY="localhost,127.0.0.1,::1${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"

RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u "$PG_OS_USER" --); fi

log() { printf '[e2e %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[e2e] ERROR: %s\n' "$*" >&2; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_port() { # wait_port PORT NAME [SECONDS]
  local p="$1" name="$2" secs="${3:-30}" i
  for ((i = 0; i < secs * 4; i++)); do port_open "$p" && return 0; sleep 0.25; done
  die "$name did not open port $p within ${secs}s (see $LOG_DIR/$name.log)"
}

wait_http() { # wait_http URL NAME [SECONDS]
  local url="$1" name="$2" secs="${3:-30}" i
  for ((i = 0; i < secs * 2; i++)); do curl -sf -o /dev/null --noproxy '*' "$url" && return 0; sleep 0.5; done
  die "$name not healthy at $url within ${secs}s (see $LOG_DIR/$name.log)"
}

# alive = exists and is not a zombie (containers often have no init to reap orphans)
proc_alive() { kill -0 "$1" 2>/dev/null && ! grep -q '^[^)]*) Z' "/proc/$1/stat" 2>/dev/null; }
pid_alive() { [ -f "$PID_DIR/$1.pid" ] && proc_alive "$(cat "$PID_DIR/$1.pid")"; }

# start_bg NAME CMD...  — detached (setsid), output to $LOG_DIR/NAME.log, pid in $PID_DIR/NAME.pid
start_bg() {
  local name="$1"; shift
  mkdir -p "$LOG_DIR" "$PID_DIR"
  if pid_alive "$name"; then log "$name already running (pid $(cat "$PID_DIR/$name.pid"))"; return 0; fi
  setsid "$@" >"$LOG_DIR/$name.log" 2>&1 < /dev/null &
  echo $! >"$PID_DIR/$name.pid"
}

# stop_bg NAME — TERM the process group recorded in the pid file, then KILL after 5s
stop_bg() {
  local name="$1" pid i
  [ -f "$PID_DIR/$name.pid" ] || return 0
  pid="$(cat "$PID_DIR/$name.pid")"
  if proc_alive "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 40; i++)); do proc_alive "$pid" || break; sleep 0.25; done
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_DIR/$name.pid"
}

pg_running() { [ -f "$PGDATA_DIR/postmaster.pid" ] && "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1; }

export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
PSQL=(psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
