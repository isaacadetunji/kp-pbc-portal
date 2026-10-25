#!/usr/bin/env bash
# Notification dispatcher for a plain server cron (e.g. a MochaHost VPS), the
# alternative to the Netlify scheduled function and GitHub Actions. It POSTs to
# the portal's protected dispatch endpoint, which sends pending instant e-mails
# and the reminder digests due now. Reminders are idempotent, so running it
# more often than hourly is safe.
#
# Setup (cPanel > Cron Jobs, or `crontab -e`), hourly at minute 5:
#
#   SITE_URL=https://pbc.krestonpedabo.com
#   CRON_SECRET=the-same-value-as-the-app
#   5 * * * * SITE_URL="$SITE_URL" CRON_SECRET="$CRON_SECRET" /home/USER/kp-pbc-portal/scripts/dispatch-cron.sh >> /home/USER/logs/pbc-dispatch.log 2>&1
#
# Or export SITE_URL and CRON_SECRET in the environment and call the script
# directly. It exits non-zero on failure so cron can e-mail the output.

set -euo pipefail

BASE="${SITE_URL:-${NEXT_PUBLIC_SITE_URL:-}}"
SECRET="${CRON_SECRET:-}"

if [ -z "$BASE" ] || [ -z "$SECRET" ]; then
  echo "[dispatch] SITE_URL and CRON_SECRET must be set" >&2
  exit 2
fi

BASE="${BASE%/}"

printf '[dispatch] %s POST %s/api/cron/dispatch\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BASE"

HTTP_CODE=$(curl -sS -o /tmp/pbc-dispatch-body.$$ -w '%{http_code}' \
  -X POST "$BASE/api/cron/dispatch" \
  -H "Authorization: Bearer $SECRET" \
  --max-time 120) || { echo "[dispatch] curl failed" >&2; exit 1; }

BODY=$(cat /tmp/pbc-dispatch-body.$$ 2>/dev/null || true)
rm -f /tmp/pbc-dispatch-body.$$

echo "[dispatch] HTTP $HTTP_CODE ${BODY:0:2000}"

case "$HTTP_CODE" in
  2*) exit 0 ;;
  *)  exit 1 ;;
esac
