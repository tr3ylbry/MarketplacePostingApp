import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../infrastructure/db/schema";
import { authOptions } from "./options";

const db = drizzle.mock({ schema });
const env = { BETTER_AUTH_SECRET: "unit-test-only-secret-at-least-32-characters", GITHUB_CLIENT_ID: "placeholder", GITHUB_CLIENT_SECRET: "placeholder" };

it("requires credentials and rejects unsafe or ambiguous callback origins", () => {
  expect(() => authOptions(db, {})).toThrow("BETTER_AUTH_SECRET");
  expect(() => authOptions(db, { BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET })).toThrow("GitHub OAuth");
  for (const origin of ["http://example.com", "https://user:pass@example.com", "https://example.com/subpath", "https://example.com?query=1", "https://example.com#fragment"]) {
    expect(() => authOptions(db, { ...env, BETTER_AUTH_URL: origin })).toThrow();
  }
});

it("keeps HTTPS cookies secure, sessions database-backed, and testing/admin/password providers absent", () => {
  const options = authOptions(db, { ...env, BETTER_AUTH_URL: "https://inventory.example.com" });
  expect(options.trustedOrigins).toEqual(["https://inventory.example.com"]);
  expect(options.advanced).toMatchObject({ useSecureCookies: true, disableCSRFCheck: false, disableOriginCheck: false, defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } });
  expect(options.session?.cookieCache?.enabled).toBe(false);
  expect(Object.keys(options.socialProviders ?? {})).toEqual(["github"]);
  expect(options.emailAndPassword?.enabled).not.toBe(true);
  expect(options.plugins).toBeUndefined();
  expect(options.account?.accountLinking?.enabled).toBe(false);
  expect(authOptions(db, env).advanced?.useSecureCookies).toBe(false);
});
