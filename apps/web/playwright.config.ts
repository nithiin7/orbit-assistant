import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end journeys in a real browser against a real API and a throwaway SQLite database.
 * Nothing external is called: no AI providers, no Google or Microsoft accounts.
 *
 *   pnpm test:e2e            # from the repository root; starts both apps on spare ports
 *
 * Install the browser once with `pnpm --filter @orbit/web exec playwright install chromium`.
 */

const API_PORT = 8100;
const WEB_PORT = 3100;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const apiDir = fileURLToPath(new URL("../api", import.meta.url));
// A fresh data directory per run, so journeys never see an earlier run's accounts.
const dataDir = process.env.ORBIT_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "orbit-e2e-"));
process.env.ORBIT_E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: "./e2e",
  // Journeys share one server; each signs up its own account, but runs one at a time so a
  // failure is easy to read.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Migrate the empty database, then serve the API. The worker is off: journeys don't
      // wait on reminders, and the API process stays quiet.
      command:
        "uv run python -c 'from orbit_api.config import get_settings; from orbit_api.db.migrate import upgrade; upgrade(get_settings())' && uv run orbit-api",
      cwd: apiDir,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ORBIT_ENV: "test",
        ORBIT_API_PORT: String(API_PORT),
        ORBIT_SQLITE_PATH: join(dataDir, "orbit.sqlite3"),
        ORBIT_CORS_ORIGINS: JSON.stringify([WEB_URL]),
        ORBIT_SCHEDULER_IN_API: "false",
        ORBIT_LOG_LEVEL: "warning",
      },
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT} --hostname 127.0.0.1`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
