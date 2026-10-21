import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../infrastructure/db/schema";
import { authSchema } from "../infrastructure/db/authSchema";

interface AuthEnvironment {
  [key: string]: string | undefined;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export function authOptions(db: NodePgDatabase<typeof schema>, env: AuthEnvironment): BetterAuthOptions {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Configure a strong BETTER_AUTH_SECRET (at least 32 characters).");
  const origin = new URL(env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(loopback && origin.protocol === "http:")) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("BETTER_AUTH_URL must be an HTTPS origin (HTTP is allowed only on loopback).");
  }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new Error("Configure GitHub OAuth credentials.");
  return {
    appName: "Marketplace Posting Assistant", baseURL: origin.origin, secret,
    trustedOrigins: [origin.origin],
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: true }),
    socialProviders: { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } },
    // No password provider, account linking, admin or test-login endpoints.
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      // Explicit false also retains real CSRF/origin checks under NODE_ENV=test.
      disableCSRFCheck: false, disableOriginCheck: false,
      useSecureCookies: origin.protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    rateLimit: { enabled: true, window: 60, max: 100 },
    // Provider/DB errors may contain tokens or submitted details: do not log them.
    logger: { disabled: true },
    onAPIError: { throw: true },
  };
}
