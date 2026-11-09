import { randomBytes, randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { testDatabaseUrl } from "../../test/testDatabase";
import { listingFixture } from "../../test/fixtures";
import { requirementsFixture, preparationSelection } from "../../test/ebay/preparationFixtures";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { createEbayPreparationService } from "../../application/ebayPreparationService";
import { createEbayConnectionService } from "../../application/ebayConnectionService";
import { EbayTokenCipher } from "../ebay/tokenCipher";
import type { Listing } from "../../domain/listing";

const pool = new Pool({ connectionString: testDatabaseUrl() }), db = drizzle(pool, { schema });
const listings = new DrizzleListingRepository(db), connections = new DrizzleEbayConnectionRepository(db);
const transaction = new AsyncLocalStorage<boolean>();
const config = { clientId: "fixture", clientSecret: "fixture", ruName: "fixture-runame", origin: "https://127.0.0.1:3000", fingerprint: "preparation-test" };
const metadata = {
  browse: vi.fn(async () => { expect(transaction.getStore()).not.toBe(true); return requirementsFixture().branch; }),
  requirements: vi.fn(async () => { expect(transaction.getStore()).not.toBe(true); return requirementsFixture(); }),
};
const service = () => createEbayPreparationService(listings, connections, metadata, config.fingerprint);
let owner: string, other: string, listing: Listing;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); owner = randomUUID(); other = randomUUID();
  metadata.browse.mockImplementation(async () => { expect(transaction.getStore()).not.toBe(true); return requirementsFixture().branch; });
  metadata.requirements.mockImplementation(async () => { expect(transaction.getStore()).not.toBe(true); return requirementsFixture(); });
  const original = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation((...args) => transaction.run(true, () => original(...args)));
  await db.insert(schema.users).values([owner, other].map(id => ({ id, name: "Preparation fixture", email: id + "@example.test" })));
  listing = await listings.create(owner, listingFixture());
  const oauth = createEbayConnectionService(connections, {
    exchange: async () => ({ accessToken: "fake-access", expiresIn: 7200, refreshToken: "fake-refresh", refreshExpiresIn: 86400 }),
    refresh: async () => { throw new Error("Unexpected refresh"); },
    identity: async () => ({ sellerId: createHash("sha256").update(owner).digest("hex"), label: "Synthetic seller", source: "trading-get-user" }),
  }, new EbayTokenCipher(randomBytes(32).toString("hex")), config);
  const session = randomUUID(), state = new URL(await oauth.begin(owner, session)).searchParams.get("state")!;
  await oauth.complete(owner, session, state, "fixture-code");
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const user of [owner, other]) for (const row of await listings.list(user)) await listings.delete(user, row.id);
  await db.delete(schema.users).where(inArray(schema.users.id, [owner, other]));
});
afterAll(() => pool.end());

it("loads read-only metadata outside transactions without changing listing or encrypted connection", async () => {
  const before = await connections.connection(owner);
  const result = await service().load(owner, listing.id, listing.updatedAt, "101");
  expect(result.requirements?.branch.category?.leaf).toBe(true);
  expect(await connections.connection(owner)).toEqual(before);
  expect(await listings.getById(owner, listing.id)).toEqual(listing);
});
it("denies a foreign listing before any metadata/token request", async () => {
  await expect(service().load(other, listing.id, listing.updatedAt, "101")).rejects.toThrow();
  await expect(service().review(other, listing.id, listing.updatedAt, preparationSelection())).rejects.toThrow();
  expect(metadata.browse).not.toHaveBeenCalled(); expect(metadata.requirements).not.toHaveBeenCalled();
});
it("does not borrow another owner's connection for an owned listing", async () => {
  const own = await listings.create(other, listingFixture());
  await expect(service().load(other, own.id, own.updatedAt)).rejects.toThrow();
  expect(metadata.browse).not.toHaveBeenCalled();
});
it("rejects stale listing version before provider traffic", async () => {
  await expect(service().load(owner, listing.id, "2000-01-01T00:00:00.000Z")).rejects.toThrow();
  expect(metadata.browse).not.toHaveBeenCalled();
});
it("rejects a disconnect during metadata retrieval and does not restore credentials", async () => {
  metadata.requirements.mockImplementation(async () => { await connections.disconnect(owner); return requirementsFixture(); });
  await expect(service().review(owner, listing.id, listing.updatedAt, preparationSelection())).rejects.toThrow();
  expect(await connections.connection(owner)).toMatchObject({ status: "disconnected", access: null, refresh: null });
});
it("rejects a local edit while metadata is in flight", async () => {
  metadata.requirements.mockImplementation(async () => {
    await listings.update(owner, { ...listing, title: "Updated local title", updatedAt: new Date(Date.now() + 1000).toISOString() }, listing.updatedAt);
    return requirementsFixture();
  });
  await expect(service().review(owner, listing.id, listing.updatedAt, preparationSelection())).rejects.toThrow();
});
it("returns a safe pure review without creating publication/media/resource records", async () => {
  const before = await connections.connection(owner);
  const result = await service().review(owner, listing.id, listing.updatedAt, preparationSelection());
  expect(result).toMatchObject({ canStage: false, environment: "sandbox", quantity: 1 });
  expect(JSON.stringify(result)).not.toMatch(/fake-access|fake-refresh|ciphertext|authTag|pathname/);
  expect(await connections.connection(owner)).toEqual(before);
  expect((await listings.getById(owner, listing.id))?.marketplaceListings).toEqual(listing.marketplaceListings);
});
