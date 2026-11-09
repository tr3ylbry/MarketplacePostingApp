import { randomBytes, randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { testDatabaseUrl } from "../../test/testDatabase";
import { listingFixture } from "../../test/fixtures";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { createEbayConnectionService } from "../../application/ebayConnectionService";
import { createEbayReadinessService } from "../../application/ebayReadinessService";
import { EbayTokenCipher } from "../ebay/tokenCipher";
import { EBAY_SCOPES, EBAY_READINESS_SCOPES, EbayError, type EbayAuthorizationProfile, type EbayTokens } from "../../application/ebayConnection";
import type { Listing } from "../../domain/listing";
import { EbayReadinessClient } from "../ebay/ebayReadinessClient";
import { readinessFixture } from "../../test/ebay/readinessFixtures";

const pool = new Pool({ connectionString: testDatabaseUrl() }), db = drizzle(pool, { schema });
const repo = new DrizzleEbayConnectionRepository(db), listings = new DrizzleListingRepository(db);
const cipher = new EbayTokenCipher(randomBytes(32).toString("hex"));
const config = { clientId: "fixture", clientSecret: "fixture", ruName: "fixture-runame", origin: "https://127.0.0.1:3000", fingerprint: "unchanged-base-config" };
const txContext = new AsyncLocalStorage<boolean>();
let owner: string, other: string, session: string, listing: Listing, now: Date;
const tokens = (profile: EbayAuthorizationProfile = "identity"): EbayTokens => ({ accessToken: "fixture-access", expiresIn: 7200, refreshToken: "fixture-refresh", refreshExpiresIn: 86400,
  scopes: [...(profile === "readiness" ? EBAY_READINESS_SCOPES : EBAY_SCOPES)] });
const identity = (id: string) => ({ sellerId: createHash("sha256").update(id).digest("hex"), label: "Synthetic seller", source: "trading-get-user" as const });
const oauth = { exchange: vi.fn(async () => tokens()), refresh: vi.fn(async () => tokens()), identity: vi.fn(async () => identity(owner)) };
const authorization = () => createEbayConnectionService(repo, oauth, cipher, config, () => now);
const transport = vi.fn<typeof fetch>(async (input) => {
  expect(txContext.getStore()).not.toBe(true);
  const url = new URL(String(input)); return Response.json(readinessFixture(url.pathname, url.searchParams));
});
const gateway = { inspect: vi.fn((token: string) => new EbayReadinessClient(transport).inspect(token)) };
const readiness = () => createEbayReadinessService(listings, repo, authorization(), gateway, () => now);
async function consent(profile: EbayAuthorizationProfile = "identity", user = owner) {
  oauth.exchange.mockResolvedValueOnce(tokens(profile)); oauth.identity.mockResolvedValueOnce(identity(user));
  const url = new URL(await authorization().begin(user, session, profile)), state = url.searchParams.get("state")!;
  await authorization().complete(user, session, state, "fixture-code");
  return url;
}
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); owner = randomUUID(); other = randomUUID(); session = randomUUID(); now = new Date();
  oauth.exchange.mockImplementation(async () => { expect(txContext.getStore()).not.toBe(true); return tokens(); });
  oauth.refresh.mockImplementation(async () => { expect(txContext.getStore()).not.toBe(true); return tokens("readiness"); });
  oauth.identity.mockImplementation(async () => { expect(txContext.getStore()).not.toBe(true); return identity(owner); });
  gateway.inspect.mockImplementation(token => new EbayReadinessClient(transport).inspect(token));
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation((...args) => txContext.run(true, () => transaction(...args)));
  await db.insert(schema.users).values([owner, other].map(id => ({ id, name: "Readiness fixture", email: id + "@example.test" })));
  listing = await listings.create(owner, listingFixture()); await consent(); vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const user of [owner, other]) for (const row of await listings.list(user)) await listings.delete(user, row.id);
  await db.delete(schema.users).where(inArray(schema.users.id, [owner, other]));
});
afterAll(() => pool.end());

it("requires explicit read-only reauthorization without mutating a usable base-scope connection", async () => {
  const before = await repo.connection(owner);
  await expect(readiness().check(owner, listing.id, listing.updatedAt)).rejects.toMatchObject({ code: "permissions" });
  expect(await repo.connection(owner)).toEqual(before); expect(transport).not.toHaveBeenCalled(); expect(oauth.refresh).not.toHaveBeenCalled();
  expect((await authorization().status(owner)).state).toBe("connected");
});
it("binds requested scopes to one-use state and preserves credentials through denial", async () => {
  const before = (await repo.connection(owner))!, url = new URL(await authorization().begin(owner, session, "readiness"));
  expect(url.searchParams.get("scope")?.split(" ")).toEqual([...EBAY_READINESS_SCOPES]);
  const state = url.searchParams.get("state")!;
  expect((await db.select().from(schema.ebayOauthStates).where(eq(schema.ebayOauthStates.ownerId, owner)))[0].requestedScopes).toEqual([...EBAY_READINESS_SCOPES]);
  await authorization().complete(owner, session, state, null, true);
  const after = (await repo.connection(owner))!;
  expect(after.access).toEqual(before.access); expect(after.refresh).toEqual(before.refresh); expect(after.configHash).toBe(before.configHash); expect(after.scopes).toEqual([...EBAY_SCOPES]);
  await expect(authorization().complete(owner, session, state, "replay")).rejects.toThrow(); expect(oauth.exchange).not.toHaveBeenCalled();
});
it("migrates old pending states to their original base grant without backfilling new permissions", async () => {
  const row = (await repo.connection(owner))!;
  const [state] = await db.insert(schema.ebayOauthStates).values({ hash: randomBytes(32).toString("hex"), ownerId: owner, sessionHash: "fixture-session-hash", configHash: config.fingerprint,
    connectionVersion: row.version, expiresAt: new Date(now.getTime() + 600000).toISOString() }).returning();
  expect(state.requestedScopes).toEqual([...EBAY_SCOPES]); expect(await repo.connection(owner)).toEqual(row);
});
it.each(["exchange", "identity", "scopes"])("preserves previous ciphertext on a failed %s permission upgrade", async failure => {
  const before = (await repo.connection(owner))!, url = new URL(await authorization().begin(owner, session, "readiness"));
  if (failure === "exchange") oauth.exchange.mockRejectedValueOnce(new EbayError("auth"));
  else oauth.exchange.mockResolvedValueOnce(failure === "scopes" ? tokens() : tokens("readiness"));
  if (failure === "identity") oauth.identity.mockRejectedValueOnce(new EbayError("identity"));
  await expect(authorization().complete(owner, session, url.searchParams.get("state"), "fixture-code")).rejects.toThrow();
  const after = (await repo.connection(owner))!;
  expect(after.access).toEqual(before.access); expect(after.refresh).toEqual(before.refresh); expect(after.sellerId).toBe(before.sellerId); expect(after.status).toBe("connected");
});
it("cannot upgrade a state belonging to another session or owner", async () => {
  const url = new URL(await authorization().begin(owner, session, "readiness")), state = url.searchParams.get("state");
  await expect(authorization().complete(other, session, state, "code")).rejects.toThrow();
  await expect(authorization().complete(owner, "foreign-session", state, "code")).rejects.toThrow();
  expect(oauth.exchange).not.toHaveBeenCalled(); expect((await repo.connection(owner))?.scopes).toEqual([...EBAY_SCOPES]);
});
it("cannot switch seller identity while upgrading an existing connection", async () => {
  const before = (await repo.connection(owner))!, url = new URL(await authorization().begin(owner, session, "readiness"));
  oauth.exchange.mockResolvedValueOnce(tokens("readiness")); oauth.identity.mockResolvedValueOnce(identity(other));
  await expect(authorization().complete(owner, session, url.searchParams.get("state"), "fixture-code")).rejects.toMatchObject({ code: "identity" });
  const after = (await repo.connection(owner))!;
  expect(after.access).toEqual(before.access); expect(after.refresh).toEqual(before.refresh); expect(after.sellerId).toBe(before.sellerId); expect(after.scopes).toEqual(before.scopes);
});
it("rejects broader write permissions before creating an authorization state", async () => {
  const before = await repo.connection(owner);
  await expect(repo.begin(owner, "session", config.fingerprint, "state", now.toISOString(), new Date(now.getTime() + 600000).toISOString(), [...EBAY_SCOPES, "https://api.ebay.com/oauth/api_scope/sell.inventory"])).rejects.toThrow();
  expect(await repo.connection(owner)).toEqual(before); expect(oauth.exchange).not.toHaveBeenCalled();
});
it("upgrades only after identity validation, keeps AAD/config stable, and reconnect retains the granted profile", async () => {
  const before = (await repo.connection(owner))!; await consent("readiness");
  const after = (await repo.connection(owner))!;
  expect(after.configHash).toBe(before.configHash); expect(after.sellerId).toBe(before.sellerId);
  expect((await authorization().status(owner)).readinessAuthorized).toBe(true);
  expect(await authorization().accessToken(owner)).toBe("fixture-access");
  expect(new URL(await authorization().begin(owner, session)).searchParams.get("scope")?.split(" ")).toEqual([...EBAY_READINESS_SCOPES]);
});
it("does not invent new scopes from an old refresh grant", async () => {
  const row = (await repo.connection(owner))!;
  await db.update(schema.ebayConnections).set({ accessExpiresAt: new Date(now.getTime() - 1).toISOString() }).where(eq(schema.ebayConnections.ownerId, owner));
  oauth.refresh.mockResolvedValueOnce(tokens("readiness"));
  await expect(authorization().accessToken(owner)).rejects.toMatchObject({ code: "scopes" });
  expect((await repo.connection(owner))?.scopes).toEqual(row.scopes);
});
it("refreshes an expanded grant without dropping permissions or requiring a replacement refresh token", async () => {
  await consent("readiness"); const before = (await repo.connection(owner))!;
  now = new Date(now.getTime() + 7201000);
  oauth.refresh.mockResolvedValueOnce({ accessToken: "renewed-readiness", expiresIn: 7200 });
  const access = await authorization().accessContext(owner, "readiness"), after = (await repo.connection(owner))!;
  expect(access.version).toBe(after.version); expect(access.token).toBe("renewed-readiness");
  expect(after.refresh).toEqual(before.refresh); expect(after.refreshExpiresAt).toBe(before.refreshExpiresAt); expect(after.scopes).toEqual([...EBAY_READINESS_SCOPES]);
});
it("keeps all seller reads outside transactions and changes no listing or credential data", async () => {
  await consent("readiness"); const before = await repo.connection(owner);
  const result = await readiness().check(owner, listing.id, listing.updatedAt);
  expect(result).toMatchObject({ environment: "sandbox", registrationComplete: true, inventoryEligibility: "unverified", canStage: false, canCreateOffer: false, canPublish: false });
  expect(JSON.stringify(result)).not.toMatch(/fixture-access|fixture-refresh|private-fixture|ciphertext|authTag|addressLine|postalCode/);
  expect(await repo.connection(owner)).toEqual(before); expect(await listings.getById(owner, listing.id)).toEqual(listing);
});
it("denies foreign listings and never borrows another owner's connection", async () => {
  await consent("readiness");
  await expect(readiness().check(other, listing.id, listing.updatedAt)).rejects.toThrow();
  const own = await listings.create(other, listingFixture());
  await expect(readiness().check(other, own.id, own.updatedAt)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
});
it("rejects a foreign connection returned at the access boundary", async () => {
  await consent("readiness"); const row = (await repo.connection(owner))!;
  vi.spyOn(repo, "connection").mockResolvedValueOnce({ ...row, ownerId: other });
  await expect(authorization().accessContext(owner, "readiness")).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
});
it.each(["disconnect", "reconnect", "edit"])("discards stale results after %s during provider reads", async change => {
  await consent("readiness");
  gateway.inspect.mockImplementationOnce(async token => {
    if (change === "disconnect") await authorization().disconnect(owner);
    if (change === "reconnect") await consent("readiness");
    if (change === "edit") await listings.update(owner, { ...listing, title: "Changed locally", updatedAt: new Date(now.getTime() + 1000).toISOString() }, listing.updatedAt);
    return new EbayReadinessClient(transport).inspect(token);
  });
  await expect(readiness().check(owner, listing.id, listing.updatedAt)).rejects.toMatchObject({ code: "stale" });
});
it("rejects an already stale listing before credentials or provider traffic", async () => {
  await consent("readiness");
  await expect(readiness().check(owner, listing.id, "2000-01-01T00:00:00.000Z")).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
});
