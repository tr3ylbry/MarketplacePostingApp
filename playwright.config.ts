import { defineConfig } from "@playwright/test";
import { testDatabaseUrl } from "./src/test/testDatabase";
import { randomBytes } from "node:crypto";

const databaseUrl = testDatabaseUrl();
// Ephemeral secret shared only between this test process and its local server.
process.env.PLAYWRIGHT_AUTH_SECRET ??= randomBytes(32).toString("hex");
process.env.BETTER_AUTH_SECRET = process.env.PLAYWRIGHT_AUTH_SECRET;
export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npm run db:migrate && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/sign-in", reuseExistingServer: false,
    env: { DATABASE_URL: databaseUrl, BETTER_AUTH_URL: "http://127.0.0.1:3100", BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, GITHUB_CLIENT_ID: "test-placeholder", GITHUB_CLIENT_SECRET: "test-placeholder" }, timeout: 120000,
  },
});
