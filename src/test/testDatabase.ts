import { config } from "dotenv";

export function testDatabaseUrl(): string {
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
  const value = process.env.TEST_DATABASE_URL;
  if (!value || !new URL(value).pathname.endsWith("_test")) {
    throw new Error("Set TEST_DATABASE_URL to a dedicated database whose name ends in _test.");
  }
  return value;
}
