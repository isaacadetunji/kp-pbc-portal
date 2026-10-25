import { defineConfig, devices } from "@playwright/test";
import { appUrl } from "./helpers/env.mts";

/**
 * Local E2E suite. Run through `bash tests/e2e/run.sh` (full pipeline), or against an
 * already running stack + app with `cd tests/e2e && npx playwright test`.
 *
 * Env: APP_URL (default http://localhost:3000), KP_E2E_STATE (where keys.env and the
 * mail sink live), E2E_CHROMIUM (explicit browser binary), E2E_RETRIES, E2E_REPORT_DIR.
 */
const reportDir = process.env.E2E_REPORT_DIR ?? "report";

export default defineConfig({
  testDir: "./specs",
  testMatch: /.*\.spec\.mts$/,
  // The specs share one database (seeded once per run), so run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: Number(process.env.E2E_RETRIES ?? 0),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: `${reportDir}/test-results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${reportDir}/html`, open: "never" }],
    ["json", { outputFile: `${reportDir}/results.json` }],
    ["junit", { outputFile: `${reportDir}/junit.xml` }],
  ],
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    acceptDownloads: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}),
          // Everything is on localhost; never route the browser through an outbound proxy.
          args: ["--no-proxy-server"],
        },
      },
    },
  ],
});
