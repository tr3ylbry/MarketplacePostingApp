import { defineConfig } from "@playwright/test";
import { testDatabaseUrl } from "./src/test/testDatabase";
import { randomBytes } from "node:crypto";

const databaseUrl = testDatabaseUrl();
// Ephemeral secret shared only between this test process and its local server.
process.env.PLAYWRIGHT_AUTH_SECRET ??= randomBytes(32).toString("hex");
process.env.BETTER_AUTH_SECRET = process.env.PLAYWRIGHT_AUTH_SECRET;
process.env.TEST_STORAGE_SECRET ??= randomBytes(32).toString("hex");
export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: [{
    command: "npx tsx scripts/test-storage.ts", url: "http://127.0.0.1:4311/health",
    env: { MARKETPLACE_TEST_BUILD: "1", TEST_STORAGE_SECRET: process.env.TEST_STORAGE_SECRET },
    reuseExistingServer: false,
  }, {
    command: "npm run db:migrate && npm run build && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/sign-in", reuseExistingServer: false,
    env: { MARKETPLACE_TEST_BUILD: "1", TEST_DATABASE_URL: databaseUrl, TEST_STORAGE_SECRET: process.env.TEST_STORAGE_SECRET, DATABASE_URL: databaseUrl, BETTER_AUTH_URL: "http://127.0.0.1:3100", BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, GITHUB_CLIENT_ID: "test-placeholder", GITHUB_CLIENT_SECRET: "test-placeholder" }, timeout: 180000,
  }],
});
