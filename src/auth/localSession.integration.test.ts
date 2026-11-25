import { randomBytes, createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { authOptions } from "./options";
import { disposableRealMediaDatabase } from "../test/disposableRealMediaDatabase";
import { privateTerminal } from "../test/privateTerminal";
import { runManualTool } from "../../scripts/ebay-capture-discovery";
import { openLocalSessionReader, LOCAL_ORIGIN } from "../../scripts/local-session";
import * as schema from "../infrastructure/db/schema";

const forbidden = vi.hoisted(() => vi.fn(() => { throw Error("Provider composition is forbidden in local modes"); }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn: forbidden, execFileSync: forbidden }));
vi.mock("../infrastructure/ebay/ebayClient", () => forbidden());
vi.mock("../infrastructure/ebay/tokenCipher", () => forbidden());
vi.mock("../infrastructure/ebay/captureClient", () => forbidden());
vi.mock("../infrastructure/storage/captureSource", () => forbidden());
vi.mock("../application/photoDerivativeService", () => forbidden());
vi.mock("../infrastructure/storage/captureFixture", () => forbidden());

let isolated: Awaited<ReturnType<typeof disposableRealMediaDatabase>>;
const authFactory = (db: typeof isolated.db, env: NodeJS.ProcessEnv) => betterAuth({ ...authOptions(db, env), plugins: [testUtils()] });
let auth: ReturnType<typeof authFactory>;
let env: NodeJS.ProcessEnv, cookie: string, owner: string, sessionId: string;
const deniedFetch = vi.fn(() => { throw Error("External HTTP is blocked"); });

async function snapshot() {
  const tables = (await isolated.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const state: Record<string, string> = {};
  for (const { tablename } of tables) {
    const rows = await isolated.pool.query('SELECT coalesce(jsonb_agg(v ORDER BY v::text),\'[]\') AS rows FROM (SELECT to_jsonb(t) AS v FROM "' + tablename.replaceAll('"', '""') + '" t) q');
    state[tablename] = createHash("sha256").update(JSON.stringify(rows.rows[0].rows)).digest("hex");
  }
  return state;
}

beforeAll(async () => { isolated = await disposableRealMediaDatabase(); }, 30000);
beforeEach(async () => {
  vi.stubGlobal("fetch", deniedFetch); deniedFetch.mockClear(); forbidden.mockClear();
  env = { NODE_ENV: "test", DATABASE_URL: isolated.pool.options.connectionString!, BETTER_AUTH_URL: LOCAL_ORIGIN,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), GITHUB_CLIENT_ID: "synthetic", GITHUB_CLIENT_SECRET: "synthetic" };
  auth = authFactory(isolated.db, env);
  const h = (await auth.$context).test;
  owner = (await h.saveUser(h.createUser())).id;
  const login = await h.login({ userId: owner }); cookie = login.headers.get("cookie")!; sessionId = login.session.id;
  await isolated.db.insert(schema.ebayConnections).values({ ownerId: owner, id: crypto.randomUUID(), version: crypto.randomUUID(),
    configHash: "a".repeat(64), status: "connected", sellerId: createHash("sha256").update(owner).digest("hex"), sellerLabel: "Synthetic",
    access: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    refresh: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    scopes: ["https://api.ebay.com/oauth/api_scope"], accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 7200000).toISOString(), connectedAt: new Date().toISOString() });
});
afterEach(() => { expect(forbidden).not.toHaveBeenCalled(); expect(deniedFetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(async () => { if (isolated) await isolated.close(); });

async function check(value: string, args = ["--check-session"], settings = env) {
  const before = await snapshot(), t = privateTerminal();
  const pending = runManualTool(args, settings, t.terminal);
  // Local flags/configuration validation is synchronous before the input wait.
  t.send("\x1b[200~" + value + "\x1b[201~"); t.submit();
  const exit = await pending;
  expect(await snapshot()).toEqual(before);
  expect(t.input.isRaw).toBe(false); expect(t.text()).not.toContain(value || "not-a-real-secret");
  return { exit, output: t.text() };
}

it("validates a signed HTTPS session via the shared hidden input path without any provider configuration/composition", async () => {
  expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
  const r = await check(cookie);
  expect(r.exit).toBe(0); expect(r.output).toContain('"authenticated":true,"live":true,"originMatches":true');
  expect(r.output).not.toContain("set-cookie"); expect(r.output).not.toContain(owner); expect(r.output).not.toContain(sessionId);
});

it("does not renew an old-but-live session or emit replacement cookies", async () => {
  await isolated.db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 6 * 86400000), updatedAt: new Date(Date.now() - 6 * 86400000),
    expiresAt: new Date(Date.now() + 3600000) }).where(eq(schema.sessions.id, sessionId));
  expect((await check(cookie)).exit).toBe(0);
});

it("rejects an expired signed session without deleting it, even though disableRefresh alone would delete it", async () => {
  await isolated.db.update(schema.sessions).set({ expiresAt: new Date(0) }).where(eq(schema.sessions.id, sessionId));
  const r = await check(cookie); expect(r.exit).toBe(1); expect(r.output).toContain('"failure":"unauthenticated"');
  expect(await isolated.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))).toHaveLength(1);
});

it("rejects a revoked signed session without creating state", async () => {
  await isolated.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  expect((await check(cookie)).output).toContain('"failure":"unauthenticated"');
});
it("rejects a tampered signature without writes or identity disclosure", async () => {
  const dot = cookie.indexOf(".", cookie.indexOf("="));
  const changed = cookie.slice(0, dot + 1) + (cookie[dot + 1] === "x" ? "y" : "x") + cookie.slice(dot + 2);
  expect((await check(changed)).output).toContain('"failure":"unauthenticated"');
});
it.each(["", "node scripts/ebay-capture-discovery.ts --check-session", "Cookie: bad", "x".repeat(4100)])("rejects empty/command/malformed/oversized input", async value => {
  const r = await check(value); expect(r.exit).toBe(1); expect(r.output).toMatch(/"failure":"(format|too-long)"/);
});
it("rejects the insecure HTTP cookie alias", async () => {
  expect((await check(cookie.replace("__Secure-", ""))).output).toContain('"failure":"format"');
});
it.each(["http://127.0.0.1:3000", "https://localhost:3000", "https://127.0.0.1:3001"])("rejects a different auth origin before input", async origin => {
  const r = await check(cookie, ["--check-session"], { ...env, BETTER_AUTH_URL: origin });
  expect(r.exit).toBe(1); expect(r.output).toContain('"failure":"configuration"');
});
it("enforces read-only database access independently of the supplied connection options", async () => {
  const url = new URL(env.DATABASE_URL!); url.searchParams.set("options", "-c default_transaction_read_only=off");
  const reader = openLocalSessionReader({ ...env, DATABASE_URL: url.toString() });
  try { expect((await reader.session(cookie))?.ownerId).toBe(owner); } finally { await reader.close(); }
  // A valid read above is real authentication, not a caller-supplied owner ID.
  expect((await isolated.db.execute(sql`SELECT count(*)::int AS n FROM ebay_oauth_states`)).rows[0].n).toBe(0);
});
it.each(["cancel", "eof", "error"])("leaves all records intact on input %s", async event => {
  const before = await snapshot(), t = privateTerminal(), pending = runManualTool(["--check-session"], env, t.terminal);
  if (event === "cancel") t.send("\x03"); else if (event === "eof") t.input.emit("end"); else t.input.emit("error", Error("synthetic"));
  expect(await pending).toBe(1); expect(await snapshot()).toEqual(before); expect(t.input.isRaw).toBe(false);
});
it.each([["--check-session", "--approve-media-consent"], ["--check-session", "--approve-one-create"], ["--check-session", "--fixture", "/tmp/no-file"]].map(args => ({ args })))("cannot fall through conflicting flags to a real mode: $args", async ({ args }) => {
  const r = await check(cookie, args); expect(r.exit).toBe(1); expect(r.output).toContain('"failure":"flags"');
});

async function checkRequestHeaders(requestHeaders: Headers, settings = env) {
  const before = await snapshot(), original = [...requestHeaders.entries()];
  const reader = openLocalSessionReader(settings, true);
  try {
    const actor = await reader.sessionFromHeaders(requestHeaders);
    expect([...requestHeaders.entries()]).toEqual(original);
    expect(await snapshot()).toEqual(before);
    return actor;
  } finally { await reader.close(); }
}

it("authenticates ordinary server Headers without a TTY or exact-cookie export and leaves them unchanged", async () => {
  const incoming = new Headers({ cookie: "ui-preference=compact; " + cookie + "; other-state=synthetic",
    origin: LOCAL_ORIGIN, host: "127.0.0.1:3000" });
  const actor = await checkRequestHeaders(incoming);
  expect(actor).toEqual({ ownerId: owner, id: sessionId, expiresAt: expect.any(String) });
  expect(Object.keys(actor!).sort()).toEqual(["expiresAt", "id", "ownerId"]);
});

it("clones server Headers only after checking its read-only pool and never mutates the request", async () => {
  const incoming = new Headers({ cookie, origin: LOCAL_ORIGIN });
  const reader = openLocalSessionReader(env, true);
  try {
    const clone = await reader.headersFromRequest(incoming);
    expect(clone).not.toBe(incoming);
    expect(clone.get("cookie")).toBe(cookie);
    clone.delete("cookie");
    expect(incoming.get("cookie")).toBe(cookie);
    expect((await reader.sessionFromHeaders(incoming))?.ownerId).toBe(owner);
  } finally { await reader.close(); }
});

it("does not renew old live sessions when authenticated through normal request Headers", async () => {
  await isolated.db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 6 * 86400000), updatedAt: new Date(Date.now() - 6 * 86400000),
    expiresAt: new Date(Date.now() + 3600000) }).where(eq(schema.sessions.id, sessionId));
  expect((await checkRequestHeaders(new Headers({ cookie })))?.id).toBe(sessionId);
});

it("rejects expired signed browser sessions without deleting rows or emitting replacement cookies", async () => {
  await isolated.db.update(schema.sessions).set({ expiresAt: new Date(0) }).where(eq(schema.sessions.id, sessionId));
  expect(await checkRequestHeaders(new Headers({ cookie }))).toBeNull();
  expect(await isolated.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))).toHaveLength(1);
});

it("rejects revoked and tampered browser sessions without changing any application state", async () => {
  const dot = cookie.indexOf(".", cookie.indexOf("="));
  const changed = cookie.slice(0, dot + 1) + (cookie[dot + 1] === "x" ? "y" : "x") + cookie.slice(dot + 2);
  expect(await checkRequestHeaders(new Headers({ cookie: changed }))).toBeNull();
  await isolated.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  expect(await checkRequestHeaders(new Headers({ cookie }))).toBeNull();
});

it.each(["", "malformed", "insecure-alias", "asserted-owner"])("does not authenticate %s request headers", async kind => {
  const incoming = kind === "insecure-alias" ? new Headers({ cookie: cookie.replace("__Secure-", "") }) :
    kind === "asserted-owner" ? new Headers({ "x-owner-id": owner, "x-session-id": sessionId, authorization: "Bearer synthetic" }) :
    new Headers(kind ? { cookie: kind } : {});
  expect(await checkRequestHeaders(incoming)).toBeNull();
});
