#!/usr/bin/env bash
# Full local E2E run, from a clean state:
#   setup → stop old stack → reset DB → start services → seed demo data → next build
#   → next start → Playwright → report → stop stack → exit with Playwright's status
#
#   bash tests/e2e/run.sh                     everything
#   SKIP_BUILD=1 bash tests/e2e/run.sh        reuse the existing .next build
#   KEEP_STACK=1 bash tests/e2e/run.sh        leave the stack + app running afterwards
#   bash tests/e2e/run.sh specs/01-auth.spec.mts --grep magic   extra args go to Playwright
#
# Report: tests/e2e/report/{summary.txt,results.json,junit.xml,html/}; logs in $KP_E2E_STATE/logs.
set -uo pipefail
source "$(dirname "$0")/config.sh"

REPORT_DIR="${E2E_REPORT_DIR:-$E2E_DIR/report}"
export E2E_REPORT_DIR="$REPORT_DIR"
rm -rf "$REPORT_DIR" && mkdir -p "$REPORT_DIR" "$LOG_DIR"
SUMMARY="$REPORT_DIR/summary.txt"
T0=$SECONDS
declare -a TIMES=()
phase_start=$SECONDS
phase() { # phase NAME — records the duration of the previous phase
  local now=$SECONDS
  [ -n "${CUR:-}" ] && TIMES+=("$(printf '%-14s %4ss' "$CUR" $((now - phase_start)))")
  CUR="$1"; phase_start=$now
  [ "$1" != "-" ] && log "=== $1"
}
fail() { log "FAILED during '${CUR:-?}': $*"; finish 2; }
finish() {
  local code="$1"
  phase "-"
  {
    echo "PBC Portal local E2E run  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "repo: $REPO_ROOT @ $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
    echo "result: $([ "$code" = 0 ] && echo PASSED || echo "FAILED (exit $code)")"
    echo "timings:"
    printf '  %s\n' "${TIMES[@]}"
    echo "  total          $((SECONDS - T0))s"
    if [ -f "$REPORT_DIR/results.json" ]; then
      node -e '
        const r = require(process.argv[1]); const s = r.stats || {};
        console.log(`tests: ${s.expected ?? 0} passed, ${s.unexpected ?? 0} failed, ${s.flaky ?? 0} flaky, ${s.skipped ?? 0} skipped`);
        const walk = (suite, out) => { for (const sp of suite.specs || []) for (const t of sp.tests || []) { const last = t.results[t.results.length - 1] || {}; if (t.status !== "expected") out.push(`  ${t.status.toUpperCase()}: ${sp.file} › ${sp.title} (${(last.error && last.error.message || "").split("\n")[0]})`); } for (const c of suite.suites || []) walk(c, out); return out; };
        const bad = (r.suites || []).flatMap((s) => walk(s, [])); if (bad.length) console.log(bad.join("\n"));
      ' "$REPORT_DIR/results.json" 2>/dev/null || true
    fi
    echo "logs: $LOG_DIR   html report: $REPORT_DIR/html/index.html"
  } | tee "$SUMMARY"
  if [ "${KEEP_STACK:-0}" = 1 ]; then
    log "KEEP_STACK=1: stack and app left running (stop with tests/e2e/stop-stack.sh)"
  else
    bash "$E2E_DIR/stop-stack.sh" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap 'fail "interrupted"' INT TERM

phase setup
bash "$E2E_DIR/setup.sh" || fail "setup.sh"

phase stop-old
bash "$E2E_DIR/stop-stack.sh" >/dev/null 2>&1 || true
port_open "$APP_PORT" && fail "port $APP_PORT is already in use by another process (set APP_PORT)"

phase reset-db
mkdir -p "$LOG_DIR"
bash "$E2E_DIR/reset-db.sh" >"$LOG_DIR/reset-db.log" 2>&1 || { tail -20 "$LOG_DIR/reset-db.log"; fail "reset-db.sh"; }

phase start-stack
bash "$E2E_DIR/start-stack.sh" || fail "start-stack.sh"

phase seed-demo
(cd "$REPO_ROOT" && npm run --silent seed:demo) >"$LOG_DIR/seed-demo.log" 2>&1 || { tail -20 "$LOG_DIR/seed-demo.log"; fail "npm run seed:demo"; }

if [ "${SKIP_BUILD:-0}" = 1 ] && [ -f "$REPO_ROOT/.next/BUILD_ID" ]; then
  phase build-skip
else
  phase next-build
  (cd "$REPO_ROOT" && npx next build) >"$LOG_DIR/next-build.log" 2>&1 || { tail -30 "$LOG_DIR/next-build.log"; fail "next build"; }
fi

phase next-start
(cd "$REPO_ROOT" && start_bg next npx next start -p "$APP_PORT")
( wait_http "$APP_URL/login" next 90 ) || { tail -20 "$LOG_DIR/next.log"; fail "next start"; }

phase playwright
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
export KP_E2E_STATE APP_URL
(cd "$E2E_DIR" && npx playwright test "$@") 2>&1 | tee "$LOG_DIR/playwright.log"
PW=${PIPESTATUS[0]}

finish "$PW"
