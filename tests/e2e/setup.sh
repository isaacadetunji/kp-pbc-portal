#!/usr/bin/env bash
# One-time (idempotent) setup for the local E2E stack:
#   - downloads GoTrue and PostgREST release binaries into $KP_E2E_CACHE (default ~/.cache/kp-e2e)
#   - installs the harness's own node_modules (Playwright) in tests/e2e/
#   - installs the app's node_modules if they are missing
#   - makes sure the non-root Postgres OS user exists (when running as root)
set -euo pipefail
source "$(dirname "$0")/config.sh"

mkdir -p "$KP_E2E_CACHE/dl" "$BIN_DIR"

fetch() { # fetch URL DEST
  local url="$1" dest="$2"
  [ -s "$dest" ] && return 0
  log "downloading $url"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

# --- GoTrue (supabase/auth) ------------------------------------------------------
if [ ! -x "$GOTRUE_DIR/auth" ]; then
  tgz="$KP_E2E_CACHE/dl/auth-$GOTRUE_VERSION-x86.tar.gz"
  fetch "https://github.com/supabase/auth/releases/download/$GOTRUE_VERSION/auth-$GOTRUE_VERSION-x86.tar.gz" "$tgz"
  rm -rf "$GOTRUE_DIR.tmp" && mkdir -p "$GOTRUE_DIR.tmp"
  tar xzf "$tgz" -C "$GOTRUE_DIR.tmp"
  [ -x "$GOTRUE_DIR.tmp/auth" ] || die "GoTrue archive did not contain ./auth"
  rm -rf "$GOTRUE_DIR" && mv "$GOTRUE_DIR.tmp" "$GOTRUE_DIR"
fi
log "GoTrue $GOTRUE_VERSION: $GOTRUE_DIR/auth"

# --- PostgREST -------------------------------------------------------------------
if [ ! -x "$BIN_DIR/postgrest-$POSTGREST_VERSION" ]; then
  txz="$KP_E2E_CACHE/dl/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz"
  fetch "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" "$txz"
  tmp="$(mktemp -d)"
  tar xJf "$txz" -C "$tmp"
  [ -x "$tmp/postgrest" ] || die "PostgREST archive did not contain ./postgrest"
  mv "$tmp/postgrest" "$BIN_DIR/postgrest-$POSTGREST_VERSION"
  rm -rf "$tmp"
fi
log "PostgREST $POSTGREST_VERSION: $BIN_DIR/postgrest-$POSTGREST_VERSION"

# --- Postgres ----------------------------------------------------------------------
[ -x "$PGBIN/initdb" ] || die "Postgres binaries not found (set PGBIN, e.g. /usr/lib/postgresql/16/bin)"
if [ "$(id -u)" = "0" ] && ! id "$PG_OS_USER" >/dev/null 2>&1; then
  log "creating OS user $PG_OS_USER for Postgres"
  useradd -M "$PG_OS_USER"
fi

# --- Node dependencies ---------------------------------------------------------------
if [ ! -d "$REPO_ROOT/node_modules/next" ]; then
  log "installing app dependencies (npm ci)"
  (cd "$REPO_ROOT" && npm ci --no-audit --no-fund)
fi
if [ ! -d "$E2E_DIR/node_modules/@playwright/test" ]; then
  log "installing harness dependencies (Playwright $PLAYWRIGHT_VERSION)"
  (cd "$E2E_DIR" && npm ci --no-audit --no-fund)
fi

# Chromium: use the preinstalled browsers; never run `playwright install` here.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-* >/dev/null 2>&1 \
  || log "WARNING: no chromium found in $PLAYWRIGHT_BROWSERS_PATH (set PLAYWRIGHT_BROWSERS_PATH or E2E_CHROMIUM)"
log "setup complete"
