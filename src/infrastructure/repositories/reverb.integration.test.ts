import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import * as schema from "../db/schema";
import { DrizzleReverbRepository } from "./drizzleReverbRepository";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { CredentialCipher } from "../reverb/credentialCipher";
import { createReverbService, safeReverbError } from "../../application/reverbService";
import { reverbSku } from "../../application/reverbDraft";
import { ReverbProviderError, type ReverbGateway, type ReverbPayload, type ReverbRemoteListing } from "../../application/reverbGateway";
import { listingFixture } from "../../test/fixtures";
import { testDatabaseUrl } from "../../test/testDatabase";
const pool = new Pool({ connectionString: testDatabaseUrl() });
const db = drizzle(pool, { schema }), repo = new DrizzleReverbRepository(db), listings = new DrizzleListingRepository(db);
const cipher = new CredentialCipher(randomBytes(32).toString("hex"));
const categoryId = "14d6cc96-ed7b-4521-bc21-7713c61e9dc5", conditionId = "f7a3f48c-972a-44c6-b01a-0cd27488d3f6";
const choices = { categoryId, conditionId };
let a: string, b: string, listingId: string;
let remotes: ReverbRemoteListing[];
let activeTransactions = 0;
const assertOutside = () => expect(activeTransactions).toBe(0);
const gateway = {
  shop: vi.fn(async () => { assertOutside(); return { id: "shop-a", name: "Shop A", shippingProfiles: [{ id: "profile-a", name: "US shipping" }] }; }),
  categories: vi.fn(async () => { assertOutside(); return [{ id: categoryId, name: "Guitars / Electric" }]; }),
  conditions: vi.fn(async () => { assertOutside(); return [{ id: conditionId, name: "Good" }]; }),
  findBySku: vi.fn(async () => { assertOutside(); return remotes; }),
  createDraft: vi.fn(async (_token: string, payload: ReverbPayload) => { assertOutside(); const remote = { id: "remote-1", sku: payload.sku, state: "draft" }; remotes = [remote]; return remote; }),
} satisfies ReverbGateway;
const images = { createProviderReadAccess: vi.fn(async () => { assertOutside(); return "https://private.example/image?signature=temporary"; }) };
const service = createReverbService(repo, listings, gateway, cipher, images, "sandbox");
const review = () => service.prepare(a, listingId, choices);
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  vi.clearAllMocks(); remotes = []; a = crypto.randomUUID(); b = crypto.randomUUID();
  const original = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(async (...args) => { activeTransactions++; try { return await original(...args); } finally { activeTransactions--; } });
  await db.insert(schema.users).values([a,b].map(id => ({ id, name: "Reverb test", email: `${id}@example.test` })));
  const listing = listingFixture(); listingId = listing.id; await listings.create(a, listing);
  await db.insert(schema.listingImages).values({ id: crypto.randomUUID(), listingId, order: 0, storageProvider: "vercel-blob", pathname: `images/${crypto.randomUUID()}/test.png`, originalFilename: "test.png", contentType: "image/png", byteSize: 68, uploadedAt: new Date().toISOString() });
  await service.connect(a, "fake-reverb-owner-a"); await service.connect(b, "fake-reverb-owner-b");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(schema.listings).where(eq(schema.listings.id, listingId));
  await db.delete(schema.users).where(inArray(schema.users.id, [a,b]));
});
afterAll(() => pool.end());

it("stores owner/environment-scoped encrypted connections and returns only safe metadata", async () => {
  const connection = await repo.connection(a, "sandbox");
  expect(connection?.encryptedToken).not.toContain("fake-reverb-owner-a");
  expect(cipher.decrypt(connection!, JSON.stringify(["reverb-pat-v1", a, "sandbox"]))).toBe("fake-reverb-owner-a");
  expect(await repo.connection(a, "live")).toBeNull();
  const safe = JSON.stringify(await service.status(a));
  for (const field of ["encryptedToken", "authTag", "iv", "fake-reverb-owner-a"]) expect(safe).not.toContain(field);
  await service.disconnect(b); expect((await service.status(a)).connected).toBe(true); expect((await service.status(b)).connected).toBe(false);
});
it("rejects foreign listing preparation, guessed reviews, and disconnected accounts without network writes", async () => {
  await expect(service.prepare(b, listingId, choices)).rejects.toThrow("Listing not found");
  const prepared = await review(); await expect(service.createDraft(b, prepared.reviewId)).rejects.toThrow();
  await service.disconnect(a); await expect(service.createDraft(a, prepared.reviewId)).rejects.toThrow();
  expect(gateway.createDraft).not.toHaveBeenCalled(); expect(images.createProviderReadAccess).not.toHaveBeenCalled();
});
it("keeps the second owner's listing, connection and provider images inaccessible to the first", async () => {
  const other = listingFixture(); await listings.create(b, other);
  try {
    await expect(service.prepare(a, other.id, choices)).rejects.toThrow("Listing not found");
    const before = await repo.connection(b, "sandbox");
    await service.disconnect(a); expect(await repo.connection(b, "sandbox")).toEqual(before);
    expect(images.createProviderReadAccess).not.toHaveBeenCalled(); expect(gateway.createDraft).not.toHaveBeenCalled();
  } finally { await listings.delete(b, other.id); }
});
it("validates canonical fields and durable image availability before provider POST", async () => {
  const listing = (await listings.getById(a, listingId))!;
  await listings.update(a, { ...listing, attributes: { ...listing.attributes, brand: "" } }, listing.updatedAt);
  await expect(review()).rejects.toThrow("Brand");
  await listings.update(a, listing, listing.updatedAt);
  await db.delete(schema.listingImages).where(eq(schema.listingImages.listingId, listingId));
  await expect(review()).rejects.toThrow("durable");
  await db.insert(schema.listingImages).values({ id: crypto.randomUUID(), listingId, order: 0, storageProvider: "filename", originalFilename: "missing.png" });
  await expect(review()).rejects.toThrow("legacy"); expect(gateway.createDraft).not.toHaveBeenCalled();
});
it("requires real taxonomy/profile selections, while explicit zero-rate shipping is valid", async () => {
  await expect(service.prepare(a, listingId, { ...choices, categoryId: crypto.randomUUID() })).rejects.toThrow("selections");
  await expect(service.prepare(a, listingId, { ...choices, shippingProfileId: "invented" })).rejects.toThrow("selections");
  const rate = await review(); expect(rate.payload.shipping?.rates[0]).toEqual({ region_code: "US_CON", rate: { amount: "0.00", currency: "USD" } });
  const profile = await service.prepare(a, listingId, { ...choices, shippingProfileId: "profile-a" });
  expect(profile.payload.shipping_profile_id).toBe("profile-a"); expect(profile.payload.shipping).toBeUndefined();
});
it("persists only draft identity, never acquisition cost, signed URLs or publishedAt", async () => {
  const prepared = await review(); expect(JSON.stringify(prepared)).not.toContain("signature");
  const result = await service.createDraft(a, prepared.reviewId);
  expect(result.status).toBe("draft");
  const listing = (await listings.getById(a, listingId))!;
  expect(listing.status).toBe("draft"); expect(listing.marketplaceListings).toHaveLength(1);
  expect(listing.marketplaceListings[0]).toMatchObject({ status: "draft", externalListingId: "remote-1", providerEnvironment: "sandbox", providerShopId: "shop-a" });
  expect(listing.marketplaceListings[0].publishedAt).toBeUndefined();
  expect(JSON.stringify(listing)).not.toContain("signature");
  expect(JSON.stringify(await db.select().from(schema.reverbDraftRequests))).not.toContain("signature");
  const payload = gateway.createDraft.mock.calls[0][1]; expect(payload.publish).toBe(false); expect(payload).not.toHaveProperty("acquisitionCost");
});
it("reconciles a remote SKU match and repeated actions without another POST", async () => {
  const first = await review(); await service.createDraft(a, first.reviewId);
  const second = await review(); await service.createDraft(a, second.reviewId);
  expect(gateway.createDraft).toHaveBeenCalledTimes(1);
  expect((await listings.getById(a, listingId))?.marketplaceListings).toHaveLength(1);
});
it("adopts a sole existing remote draft, never live or ambiguous matches", async () => {
  const prepared = await review(); remotes = [{ id: "existing", sku: reverbSku(listingId), state: "live" }];
  await expect(service.createDraft(a, prepared.reviewId)).rejects.toThrow("not the expected draft");
  remotes = [{ ...remotes[0], state: "draft" }, { ...remotes[0], id: "duplicate" }];
  await expect(service.createDraft(a, prepared.reviewId)).rejects.toThrow("Multiple");
  remotes = [remotes[0]]; expect((await service.createDraft(a, prepared.reviewId)).externalListingId).toBe("existing");
  expect(gateway.createDraft).not.toHaveBeenCalled();
});
it("recovers an ambiguous POST by SKU lookup instead of re-posting", async () => {
  gateway.createDraft.mockImplementationOnce(async (_token, payload) => { remotes = [{ id: "ambiguous", sku: payload.sku, state: "draft" }]; throw new ReverbProviderError("unavailable"); });
  const prepared = await review(); expect((await service.createDraft(a, prepared.reviewId)).externalListingId).toBe("ambiguous");
  expect(gateway.createDraft).toHaveBeenCalledTimes(1); expect(gateway.findBySku).toHaveBeenCalledTimes(2);
});
it("does not issue another POST when an uncertain result is not yet visible", async () => {
  gateway.createDraft.mockRejectedValueOnce(new ReverbProviderError("unavailable"));
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("may have been created");
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("No new POST");
  expect(gateway.createDraft).toHaveBeenCalledTimes(1);
});
it("retains the POST fence across process interruption and rejects an old worker after lease takeover", async () => {
  const prepared = await review(); const first = await repo.claim(a, "sandbox", prepared.reviewId);
  await db.update(schema.reverbDraftRequests).set({ leaseUntil: new Date(Date.now() - 1).toISOString() }).where(eq(schema.reverbDraftRequests.id, prepared.reviewId));
  const second = await repo.claim(a, "sandbox", prepared.reviewId);
  await expect(repo.markPosting(first)).rejects.toThrow("stale");
  await repo.markPosting(second); await repo.release(second); // Simulated process exit before outcome known.
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("No new POST");
  expect(gateway.createDraft).not.toHaveBeenCalled();
});
it("does not blindly POST when a local external identity is absent remotely", async () => {
  await service.createDraft(a, (await review()).reviewId); remotes = [];
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("No new POST");
  expect(gateway.createDraft).toHaveBeenCalledTimes(1);
});
it("allows a corrected retry after an explicit rejection, but still checks SKU first", async () => {
  gateway.createDraft.mockRejectedValueOnce(new ReverbProviderError("validation"));
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("rejected");
  await service.createDraft(a, (await review()).reviewId);
  expect(gateway.findBySku).toHaveBeenCalledTimes(2); expect(gateway.createDraft).toHaveBeenCalledTimes(2);
});
it("reconciles remote success after local persistence fails", async () => {
  vi.spyOn(repo, "finish").mockRejectedValueOnce(new Error("database unavailable"));
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("local persistence");
  expect((await service.createDraft(a, (await review()).reviewId)).externalListingId).toBe("remote-1");
  expect(gateway.createDraft).toHaveBeenCalledTimes(1);
});
it("rejects stale reviews after edits or credential replacement", async () => {
  const prepared = await review(); const listing = (await listings.getById(a, listingId))!;
  await listings.update(a, { ...listing, updatedAt: new Date(Date.parse(listing.updatedAt) + 1).toISOString() }, listing.updatedAt);
  await expect(service.createDraft(a, prepared.reviewId)).rejects.toThrow("stale");
  const fresh = await review(); await service.connect(a, "fake-reverb-replaced");
  await expect(service.createDraft(a, fresh.reviewId)).rejects.toThrow("stale"); expect(gateway.createDraft).not.toHaveBeenCalled();
});
it("rejects edits made during image signing before granting permission to POST", async () => {
  images.createProviderReadAccess.mockImplementationOnce(async () => {
    await db.update(schema.listings).set({ updatedAt: new Date(Date.now() + 1000).toISOString() }).where(eq(schema.listings.id, listingId)); return "https://private.example/photo";
  });
  await expect(service.createDraft(a, (await review()).reviewId)).rejects.toThrow("stale"); expect(gateway.createDraft).not.toHaveBeenCalled();
});
it("serializes concurrent draft clicks without holding DB transactions during remote I/O", async () => {
  let unblock!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), release = new Promise<void>(resolve => { unblock = resolve; });
  gateway.createDraft.mockImplementationOnce(async (_token, payload) => { assertOutside(); entered(); await release; remotes = [{ id: "concurrent", sku: payload.sku, state: "draft" }]; return remotes[0]; });
  const prepared = await review(), first = service.createDraft(a, prepared.reviewId); await started;
  try { await expect(service.createDraft(a, prepared.reviewId)).rejects.toThrow("in progress"); await expect(review()).rejects.toThrow("in progress"); }
  finally { unblock(); await first; }
  expect(gateway.createDraft).toHaveBeenCalledTimes(1);
});
it("marks revoked credentials for reconnect without deleting ciphertext or hammering Reverb", async () => {
  gateway.categories.mockRejectedValueOnce(new ReverbProviderError("auth"));
  await expect(review()).rejects.toThrow("replacement token");
  expect((await service.status(a)).needsReconnect).toBe(true); expect((await repo.connection(a, "sandbox"))?.encryptedToken).toBeTruthy();
  const calls = gateway.categories.mock.calls.length; await expect(review()).rejects.toThrow("replace"); expect(gateway.categories).toHaveBeenCalledTimes(calls);
});
it("safe errors omit credentials, signatures and SQL", () => {
  const error = safeReverbError(new Error("fake-reverb-owner-a signature=temporary SELECT encrypted_token")); expect(error).not.toMatch(/fake-reverb|signature|SELECT/);
});
it("SKU is stable across edits and bounded ASCII", async () => {
  const before = reverbSku(listingId); expect(before).toMatch(/^crosslist-[a-f0-9]{32}$/); expect(reverbSku(listingId)).toBe(before); expect(reverbSku("other")).not.toBe(before);
});
