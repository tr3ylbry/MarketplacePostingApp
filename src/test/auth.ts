import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import * as schema from "../infrastructure/db/schema";
import { authOptions } from "../auth/options";
import { testDatabaseUrl } from "./testDatabase";

// This module is imported only by test runners, never by the app. No HTTP bypass.
export function createTestAuth() {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  const db = drizzle(pool, { schema });
  const options = authOptions(db, {
    BETTER_AUTH_URL: "http://127.0.0.1:3100",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString("hex"),
    GITHUB_CLIENT_ID: "test-placeholder", GITHUB_CLIENT_SECRET: "test-placeholder",
  });
  const auth = betterAuth({ ...options, plugins: [testUtils()] });
  return { pool, db, auth };
}
