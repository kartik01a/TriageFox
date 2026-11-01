import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Tests read the same root .env as the app (live provider checks run only when credentials exist).
const rootEnv = join(import.meta.dirname, "..", "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
// The hook route needs a signing secret. A real .env wins; otherwise tests use their own (they sign their own hooks).
process.env.CRISP_HOOK_SECRET ||= "e2e-hook-signing-secret-0123456789";
// Let the live reconcile test see conversations that are hours old.
process.env.RECONCILE_LOOKBACK_MIN ||= "100000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuses a running `pnpm dev`; otherwise starts one. Needs `pnpm infra:up` and `pnpm db:migrate`.
  webServer: {
    command: "pnpm dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    env: {
      E2E_DISABLE_AUTH_RATE_LIMIT: "true",
      // Billing and admin tests: a webhook secret the tests sign with (the fake provider's, not a real one)
      // and the one email allowed into /admin.
      DODO_API_KEY: "e2e-not-a-real-key",
      DODO_WEBHOOK_SECRET: "whsec_dGVzdC1zZWNyZXQtZm9yLXRoZS1mYWtlLXByb3ZpZGVy",
      PLATFORM_ADMIN_EMAILS: "e2e-admin@example.test",
    },
    timeout: 120_000,
  },
});
