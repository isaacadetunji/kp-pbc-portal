# Local end-to-end harness

Runs the real app (`next build` + `next start`) against a local, Docker-free
Supabase-compatible stack, then drives it with Playwright (Chromium).

```bash
bash tests/e2e/run.sh          # full run from a clean DB; exit code = Playwright's
```

A full run takes about 1–2 minutes: ~30 s for a cold `next build` and ~45 s for the suite.
The first run also downloads GoTrue and PostgREST (~25 MB). Results go to
`tests/e2e/report/summary.txt` (pass/fail and timings per phase), `report/results.json`,
`report/junit.xml` and `report/html/`. Traces and screenshots of failures are in
`report/test-results/`. Service logs are in `$KP_E2E_STATE/logs` (default `/tmp/kp-e2e-state/logs`).

## What runs

| Component | Port (env var) | What it is |
|---|---|---|
| Postgres 16 | 54322 (`PG_PORT`) | Throwaway cluster in `$KP_E2E_STATE/pgdata`, owned by the OS user `pgtest` when run as root |
| Gateway | 54321 (`GATEWAY_PORT`) | `services/gateway.mjs`: `/auth/v1` → GoTrue, `/rest/v1` → PostgREST, `/storage/v1` → storage mock. Handles CORS. Serves `supabase/templates` at `/__templates/` for GoTrue |
| GoTrue | 54331 (`GOTRUE_PORT`) | Official `supabase/auth` binary (`GOTRUE_VERSION`, default v2.186.0) |
| PostgREST | 54332 (`POSTGREST_PORT`) | Official binary (`POSTGREST_VERSION`, default v12.2.3) |
| Storage mock | 54333 (`STORAGE_PORT`) | `services/mock-storage.mjs`, file-system backed (`$KP_E2E_STATE/storage`) |
| SMTP sink | 54325 (`SMTP_PORT`) | `services/smtp-sink.mjs`: one `.json` and one `.eml` per message in `$KP_E2E_STATE/mail` |
| App | 3000 (`APP_PORT`) | `next start` |

The database is built the way a hosted project would be:

1. `sql/platform_bootstrap.sql`: the `anon`, `authenticated` and `service_role` roles, the
   `auth`/`extensions`/`storage` schemas, and Supabase's default privileges on `public`.
   The migrations rely on these defaults for `service_role`.
2. GoTrue's own migrations (`auth migrate`) create the **real** `auth` schema (`auth.users`,
   identities, sessions, MFA and so on), so GoTrue works normally.
3. `supabase/tests/supabase_stubs.sql`: its `auth.users` table is skipped because it
   already exists. It replaces `auth.uid()` with the same `request.jwt.claims` logic and
   adds `storage.buckets`.
4. `supabase/migrations/*.sql` in filename order, then `supabase/seed.sql`.
5. `npm run seed:demo` (through the gateway, using `.env.local`).

`start-stack.sh` mints HS256 `anon` and `service_role` JWTs from `JWT_SECRET` into
`$KP_E2E_STATE/keys.env`. It writes the app's `.env.local` pointing at the gateway. The keys
use fixed timestamps, so they are identical across runs and an existing `.next` build stays
valid. If you have a hand-written `.env.local`, it is moved to `.env.local.e2e-backup` and
`stop-stack.sh` restores it.

## Scripts

| Script | Does |
|---|---|
| `setup.sh` | Idempotent. Downloads and caches the binaries in `~/.cache/kp-e2e` (`KP_E2E_CACHE`), runs `npm ci` for the harness (Playwright, in `tests/e2e/node_modules`) and for the app if `node_modules` is missing, and creates the `pgtest` user |
| `reset-db.sh` | Stops GoTrue and PostgREST, recreates the cluster, applies everything above, and clears mail and storage. Leaves Postgres running |
| `start-stack.sh [--with-app]` | Starts all services detached (with `setsid`; pid files in `$KP_E2E_STATE/pids`) and waits for health checks. `--with-app` also runs `next start` on an existing build |
| `stop-stack.sh` | Stops everything by pid file and process group (never `pkill -f`). Stops Postgres (`KEEP_DB=1` keeps it running) and restores your `.env.local` |
| `run.sh [playwright args]` | Full pipeline. `SKIP_BUILD=1` reuses `.next`. `KEEP_STACK=1` leaves everything running for debugging |

Work against a running stack:

```bash
KEEP_STACK=1 bash tests/e2e/run.sh            # or: reset-db.sh && start-stack.sh && npm run seed:demo && next build && start-stack.sh --with-app
cd tests/e2e
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test specs/03-request-workflow.spec.mts
npx playwright show-trace report/test-results/<test>/trace.zip
bash stop-stack.sh
```

Long runs from an agent shell: start detached and poll, because tool calls time out:
`setsid bash tests/e2e/run.sh > /tmp/e2e.log 2>&1 &`, then `tail /tmp/e2e.log` or
`cat tests/e2e/report/summary.txt`.

## Environment variables

All variables are optional. Defaults are in `config.sh`.

| Variable | Default | |
|---|---|---|
| `KP_E2E_STATE` | `/tmp/kp-e2e-state` | Run-time state. It must be traversable by `pgtest`, so not under `/root` |
| `KP_E2E_CACHE` | `~/.cache/kp-e2e` | Downloaded binaries |
| `PG_PORT`, `GATEWAY_PORT`, `GOTRUE_PORT`, `POSTGREST_PORT`, `STORAGE_PORT`, `SMTP_PORT`, `APP_PORT` | see table above | |
| `E2E_HOST` | `localhost` | Host in `APP_URL` and `SUPABASE_URL`. Keep it consistent, because cookies are per host |
| `APP_URL`, `SUPABASE_URL` | `http://localhost:3000`, `http://localhost:54321` | Playwright `baseURL` and the gateway |
| `JWT_SECRET` | local constant | Shared by GoTrue, PostgREST and the storage mock |
| `DEMO_PASSWORD` | `DemoPass#2026` | |
| `PG_OS_USER`, `PGBIN` | `pgtest`, newest `/usr/lib/postgresql/*/bin` | |
| `PLAYWRIGHT_BROWSERS_PATH` | `/opt/pw-browsers` | Uses the preinstalled Chromium. Do not run `playwright install`. The harness pins `@playwright/test@1.63.0`, which matches `chromium-1243` |
| `E2E_CHROMIUM` | – | Explicit browser executable, if the revision doesn't match |
| `E2E_RETRIES` | `0` | Playwright retries |
| `E2E_REPORT_DIR` | `tests/e2e/report` | |
| `SKIP_BUILD`, `KEEP_STACK`, `KEEP_DB` | `0` | See the scripts table |

## Suite layout

Spec files are `.mts`, which keeps them out of the app's `tsconfig` (`**/*.ts`), so
`next build` and `tsc` never see Playwright imports. Check the harness itself with
`node_modules/.bin/tsc -p tests/e2e`.

```
specs/01-auth.spec.mts              password login, bad password, redirect to /login, magic link via SMTP sink
specs/02-engagements.spec.mts       engagement list → open engagement, every tab renders
specs/03-request-workflow.spec.mts  client portal → upload to a request → submit; team accepts (serial)
specs/04-invitations.spec.mts       invite a new client contact → invitation email → set password → sign in
specs/05-admin.spec.mts             super-admin pages render; client can't open them
specs/06-downloads-api.spec.mts     attachments ZIP starts with "PK", file download, unauthenticated API → 401
helpers/env.mts      ports/URLs/keys (reads $KP_E2E_STATE/keys.env) and the demo accounts
helpers/auth.mts     loginWithPassword(page, email, password?)
helpers/mailbox.mts  latestEmail(address, {since, subject}) and extractLink(mail)
helpers/data.mts     service-role REST helpers (mainEngagement(), items(), item(), rest())
fixtures/            upload fixtures
```

Adding a flow: put it in the spec file for its area, or add `NN-area.spec.mts`. Specs
run one at a time against one seeded database, in filename order. Pick test data from
the DB (see `03-request-workflow`) instead of hard-coding item codes, so a spec can be
re-run without a reset. Use unique emails (`Date.now()`) for anything you create.

## Storage mock coverage

Covers what `lib/storage/supabase-provider.ts`, `components/items/file-uploader.tsx`
and `scripts/seed-demo.mts` call:

- `createSignedUploadUrl` and the browser's `PUT /object/upload/sign/...?token=` (multipart)
- `upload` and `update`
- `createSignedUrl` and the signed `GET`
- `list` (prefix and search)
- `remove`

Tokens are HMAC-signed, so they survive a mock restart. Everything except signed URLs
requires the `service_role` JWT. Bucket limits and MIME checks are not enforced. The
database does those checks.

## Not covered locally

- **Realtime.** The gateway refuses websocket upgrades. The browser logs
  `WebSocket connection to 'ws://localhost:54321/realtime/v1/...' failed` and pages fall
  back to normal refreshes. Live-update behaviour is not tested.
- **Supabase Studio.**
- **Image transforms.**
- **SharePoint.**

## Troubleshooting

- **`port N ... already in use`.** Another process (or another agent's stack) holds the
  port. Override the `*_PORT` variable, or run `stop-stack.sh` if it's a stale stack of
  ours. `stop-stack.sh` only kills processes from its own pid files.
- **GoTrue won't start.** Read `$KP_E2E_STATE/logs/gotrue.log`. Migration errors are in
  `gotrue-migrate.log`. Run `reset-db.sh` for a clean `auth` schema.
- **No email arrives.** Read `logs/smtp.log` and `logs/gotrue.log`. GoTrue fetches templates
  from the gateway (`/__templates/*.html`), so the gateway must be up.
  `GOTRUE_SMTP_MAX_FREQUENCY=1s` and high rate limits are set, so repeated sends to the same
  address work.
- **Login works in the seed but not in the browser.** Check that `.env.local` was written by
  `start-stack.sh` (first line is a marker) and that the build used it. Rebuild without
  `SKIP_BUILD`.
- **The `.env` password is cut off at `#`.** Node's `--env-file` treats an unquoted `#` as
  a comment, so `DEMO_PASSWORD=DemoPass#2026` becomes `DemoPass`. The generated
  `.env.local` quotes it.
- **Postgres permission errors as root.** `KP_E2E_STATE` must be outside `/root`. The
  cluster runs as `pgtest` through `runuser`.
- **Chromium not found or version mismatch.** Set `E2E_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux64/chrome`.

The database-only test runner is separate. See [DB-ONLY.md](DB-ONLY.md).
