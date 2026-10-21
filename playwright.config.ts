import { defineConfig } from "@playwright/test";
import { testDatabaseUrl } from "./src/test/testDatabase";

const databaseUrl = testDatabaseUrl();
export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npm run db:migrate && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/listings", reuseExistingServer: false,
    env: { DATABASE_URL: databaseUrl }, timeout: 120000,
  },
});
