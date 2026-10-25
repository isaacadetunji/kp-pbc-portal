# Database-only tests

The database tests (RLS, workflow functions, triggers) do not use this harness.
They still run with:

```bash
bash supabase/tests/run-local.sh      # or: npm run db:test
```

That script starts its own throwaway Postgres 16 on port 54329 (`PGPORT_TEST`), applies
`supabase/tests/supabase_stubs.sql`, the migrations and `seed.sql` (twice, to prove it is
re-runnable), and runs `supabase/tests/rls_workflow_test.sql`. It does not need GoTrue,
PostgREST, Node or a browser, and it doesn't conflict with the E2E stack (port 54322).

Use the E2E harness (`bash tests/e2e/run.sh`, see [README.md](README.md)) for anything that
needs the app, auth emails, storage or a browser.
