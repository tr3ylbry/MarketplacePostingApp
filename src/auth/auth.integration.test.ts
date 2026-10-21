import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTestAuth } from "../test/auth";
import { sessions, verifications } from "../infrastructure/db/schema";

const { auth, db, pool } = createTestAuth();
let userId: string;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => { const test = (await auth.$context).test; userId = (await test.saveUser(test.createUser())).id; });
afterEach(async () => { await (await auth.$context).test.deleteUser(userId); });
afterAll(() => pool.end());

it("validates real database sessions and rejects absent, tampered, expired and revoked sessions", async () => {
  expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  expect(await auth.api.getSession({ headers: new Headers({ cookie: "better-auth.session_token=forged" }) })).toBeNull();
  const test = (await auth.$context).test;
  const login = await test.login({ userId });
  expect((await auth.api.getSession({ headers: login.headers }))?.user.id).toBe(userId);
  await db.update(sessions).set({ expiresAt: new Date(0) }).where(eq(sessions.id, login.session.id));
  expect(await auth.api.getSession({ headers: login.headers })).toBeNull();
  const next = await test.login({ userId });
  await db.delete(sessions).where(eq(sessions.id, next.session.id));
  expect(await auth.api.getSession({ headers: next.headers })).toBeNull();
});

it("rejects cross-origin sign-out, but same-origin sign-out revokes the actual session", async () => {
  const { headers } = await (await auth.$context).test.login({ userId });
  const call = (origin: string) => auth.handler(new Request("http://127.0.0.1:3100/api/auth/sign-out", {
    method: "POST", headers: { cookie: headers.get("cookie")!, origin, "content-type": "application/json" }, body: "{}",
  }));
  expect((await call("https://attacker.example")).status).toBe(403);
  expect((await auth.api.getSession({ headers }))?.user.id).toBe(userId);
  expect((await call("http://127.0.0.1:3100")).status).toBe(200);
  expect(await auth.api.getSession({ headers })).toBeNull();
});

it("rejects untrusted callback URLs without contacting GitHub", async () => {
  const response = await auth.handler(new Request("http://127.0.0.1:3100/api/auth/sign-in/social", {
    method: "POST", headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "https://attacker.example" }),
  }));
  expect(response.status).toBe(403);
});

it("starts the real OAuth flow with persisted state and HttpOnly cookies without contacting GitHub", async () => {
  const response = await auth.handler(new Request("http://127.0.0.1:3100/api/auth/sign-in/social", {
    method: "POST", headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/listings" }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { url: string };
  const redirect = new URL(body.url);
  expect(redirect.origin).toBe("https://github.com");
  expect(redirect.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3100/api/auth/callback/github");
  const state = redirect.searchParams.get("state");
  expect(state).toBeTruthy();
  try {
    const rows = await db.select().from(verifications).where(eq(verifications.identifier, `auth-state:${state}`));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("set-cookie")).toMatch(/httponly/i);
  } finally { await db.delete(verifications).where(eq(verifications.identifier, `auth-state:${state}`)); }
});
