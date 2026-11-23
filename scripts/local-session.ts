import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { betterAuth } from "better-auth";
import { authOptions } from "../src/auth/options";
import { ownerIdSchema } from "../src/application/owner";
import * as schema from "../src/infrastructure/db/schema";
import { localSessionCookie } from "./private-tty-input";

export const LOCAL_ORIGIN = "https://127.0.0.1:3000";
export class LocalSessionError extends Error {
  constructor(readonly code: "configuration" | "unavailable" | "unauthenticated") { super("Local session unavailable."); }
}

export function localDatabase(env: NodeJS.ProcessEnv): URL {
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (env.VERCEL || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/^postgres(?:ql)?:$/.test(url.protocol) || env.BETTER_AUTH_URL !== LOCAL_ORIGIN) throw Error();
    // pg-connection-string decodes query names and uses the last duplicate;
    // host/port there override the authority. Do not forward destination/file
    // options or unknown selectors to its subsequent, filesystem-capable parse.
    const allowed = new Set(["application_name", "connect_timeout", "options", "sslmode"]);
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (!allowed.has(key) || seen.has(key)) throw Error();
      seen.add(key);
      if (key === "sslmode" && !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(value)) throw Error();
    }
    return url;
  } catch { throw new LocalSessionError("configuration"); }
}

// Every manual pool uses the same validation before Pool can parse or connect.
export function openLocalDatabasePool(env: NodeJS.ProcessEnv, kind: "session" | "execution", bounded = false) {
  const url = localDatabase(env);
  if (kind === "session") url.searchParams.set("options", "-c default_transaction_read_only=on");
  if (bounded) url.searchParams.set("options", `${kind === "session" ? "-c default_transaction_read_only=on " : ""}-c statement_timeout=5000 -c lock_timeout=5000`);
  return new Pool({ connectionString: url.toString(), max: kind === "session" ? 1 : 5,
    ...(kind === "session" || bounded ? { connectionTimeoutMillis: 5000 } : {}), ...(bounded ? { query_timeout: 5000 } : {}) });
}

// Separate, strictly read-only connection used by ALL manual session reads.
// This changes no normal application auth setting or cookie security attribute.
export function openLocalSessionReader(env: NodeJS.ProcessEnv, bounded = false) {
  const pool = openLocalDatabasePool(env, "session", bounded);
  let unavailable = false;
  let closing: Promise<void> | undefined;
  pool.on("error", () => { unavailable = true; });
  try {
    const options = authOptions(drizzle(pool, { schema }), env);
    const auth = betterAuth({ ...options, session: { ...options.session, deferSessionRefresh: true } });
    async function headers(cookie: string) {
      const validated = localSessionCookie(cookie);
      if (unavailable || (await pool.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only !== "on") throw new LocalSessionError("unavailable");
      return new Headers({ cookie: validated });
    }
    return {
      // Internal manual composition only. The workflow still calls the genuine
      // signed-session API with supported read-only GET options, never a DTO.
      api: { getSession: auth.api.getSession }, headers,
      async session(cookie: string) {
        const validated = localSessionCookie(cookie);
        try {
          const requestHeaders = await headers(validated);
          // disableRefresh alone still deletes expired rows. Supported GET +
          // deferSessionRefresh avoids that deletion; DB read-only is a backstop.
          const result = await auth.api.getSession({ method: "GET", headers: requestHeaders,
            query: { disableRefresh: true, disableCookieCache: true }, returnHeaders: true });
          const s = result.response;
          // Expired/revoked reads can internally clear cookies. Nothing is ever
          // forwarded/emitted. A live read must not issue replacement cookies.
          if (!s || Date.parse(s.session.expiresAt.toISOString()) <= Date.now()) return null;
          if (result.headers.has("set-cookie") || !ownerIdSchema.safeParse(s.user.id).success ||
            !s.session.id || s.session.userId !== s.user.id) throw Error();
          return { ownerId: s.user.id, id: s.session.id, expiresAt: s.session.expiresAt.toISOString() };
        } catch { throw new LocalSessionError("unavailable"); }
      },
      close: () => closing ??= pool.end().catch(() => { throw new LocalSessionError("unavailable"); }),
    };
  } catch {
    void pool.end(); throw new LocalSessionError("configuration");
  }
}
