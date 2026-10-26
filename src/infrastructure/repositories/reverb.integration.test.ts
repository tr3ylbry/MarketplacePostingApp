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
import { createProviderImageAccess } from "../../application/providerImageAccess";
import { createImageService } from "../../application/imageService";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
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
  deleteDraft: vi.fn(async (_token: string, id: string) => { assertOutside(); remotes = remotes.filter(r => r.id !== id); }),
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
it("accepts legacy provider category GUIDs only when returned by the provider", async () => {
  const legacy = "12345678-abcd-0123-7123-123456789abc";
  gateway.categories.mockResolvedValueOnce([{ id: legacy, name: "Effects / Test" }]);
  const prepared = await service.prepare(a, listingId, { ...choices, categoryId: legacy });
  expect(prepared.payload.categories).toEqual([{ uuid: legacy }]);
  await expect(service.prepare(a, listingId, { ...choices, categoryId: legacy })).rejects.toThrow("selections");
  await expect(service.prepare(a, listingId, { ...choices, categoryId: "not-a-guid" })).rejects.toThrow();
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
  expect(images.createProviderReadAccess).toHaveBeenCalledWith(a, listingId, listing.images[0].id);
});
it("keeps source bytes available when an image is removed after the Reverb POST starts", async () => {
  const [image] = await db.select().from(schema.listingImages).where(eq(schema.listingImages.listingId, listingId));
  const storage = new MemoryImageStorage();
  storage.objects.set(image.pathname!, { bytes: new Uint8Array(68), type: "image/png" });
  const imageRepo = new DrizzleImageRepository(db);
  let capabilityExpiry = 0;
  const access = createProviderImageAccess(imageRepo, { signProviderReadAccess: async (_path, expiry) => {
    assertOutside(); capabilityExpiry = expiry; return "https://private.example/image?signature=temporary";
  } });
  const protectedService = createReverbService(repo, listings, gateway, cipher, access, "sandbox");
  gateway.createDraft.mockImplementationOnce(async (_token, payload) => {
    assertOutside(); expect(payload.publish).toBe(false);
    await createImageService(imageRepo, storage).remove(a, listingId, image.id);
    expect((await listings.getById(a, listingId))?.images).toEqual([]);
    expect(storage.objects.has(image.pathname!)).toBe(true);
    const [entry] = await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, image.pathname!));
    expect(Date.parse(entry.notBefore)).toBeGreaterThan(capabilityExpiry);
    return { id: "retained-remote", sku: payload.sku, state: "draft" };
  });
  try {
    const prepared = await protectedService.prepare(a, listingId, choices);
    await protectedService.createDraft(a, prepared.reviewId);
    expect(gateway.createDraft).toHaveBeenCalledOnce(); expect(storage.deleted).toEqual([]);
  } finally { await db.delete(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, image.pathname!)); }
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

const remoteDraft = (id = "remote-1", state = "draft") => ({ id, state, sku: reverbSku(listingId) });
const publication = async () => (await listings.getById(a, listingId))!.marketplaceListings[0];
const create = async () => service.createDraft(a, (await review()).reviewId);
it("reads local management state without provider traffic; options require an explicit action", async () => {
  vi.clearAllMocks();
  expect((await service.localState(a, listingId)).connected).toBe(true);
  for (const call of Object.values(gateway)) expect(call).not.toHaveBeenCalled();
  await service.options(a, listingId);
  expect(gateway.shop).toHaveBeenCalledOnce(); expect(gateway.categories).toHaveBeenCalledOnce(); expect(gateway.conditions).toHaveBeenCalledOnce();
  expect(gateway.findBySku).not.toHaveBeenCalled();
});
it("persists an exact draft refresh and a real check timestamp without provider writes", async () => {
  await create(); vi.clearAllMocks();
  await service.refresh(a, listingId);
  expect(await publication()).toMatchObject({ externalListingId: "remote-1", providerState: "draft", status: "draft" });
  expect(Date.parse((await publication()).providerCheckedAt!)).toBeLessThanOrEqual(Date.now());
  expect(gateway.findBySku).toHaveBeenCalledOnce(); expect(gateway.createDraft).not.toHaveBeenCalled(); expect(gateway.deleteDraft).not.toHaveBeenCalled();
});
it("adopts a sole remote draft after loss of local publication state, without a POST", async () => {
  remotes = [remoteDraft("recovered")]; await service.refresh(a, listingId);
  expect(await publication()).toMatchObject({ externalListingId: "recovered", providerState: "draft" });
  await create(); expect(gateway.createDraft).not.toHaveBeenCalled();
});
it("known missing clears active identity and permits one deliberate replacement", async () => {
  await create(); remotes = []; await service.refresh(a, listingId);
  expect(await publication()).toMatchObject({ providerState: "missing" }); expect((await publication()).externalListingId).toBeUndefined();
  const [request] = await db.select().from(schema.reverbDraftRequests).where(eq(schema.reverbDraftRequests.listingId, listingId));
  expect(request.postAttempted).toBe(false); expect(request.externalId).toBeNull();
  gateway.createDraft.mockImplementationOnce(async () => { assertOutside(); remotes = [remoteDraft("replacement")]; return remotes[0]; });
  await create(); await service.refresh(a, listingId);
  expect((await publication()).externalListingId).toBe("replacement"); expect(gateway.createDraft).toHaveBeenCalledTimes(2); expect(remotes).toHaveLength(1);
});
it("refresh never clears the fence for an unconfirmed ambiguous POST", async () => {
  gateway.createDraft.mockRejectedValueOnce(new ReverbProviderError("unavailable"));
  await expect(create()).rejects.toThrow("may have been created");
  await expect(service.refresh(a, listingId)).rejects.toThrow("may have reached Reverb");
  await expect(create()).rejects.toThrow("No new POST"); expect(gateway.createDraft).toHaveBeenCalledOnce();
  const [request] = await db.select().from(schema.reverbDraftRequests).where(eq(schema.reverbDraftRequests.listingId, listingId));
  expect(request.postAttempted).toBe(true); expect(request.externalId).toBeNull();
});
it("does not use a historical deletion to clear an ambiguous replacement POST fence", async () => {
  await create(); await service.deleteDraft(a, listingId);
  gateway.createDraft.mockRejectedValueOnce(new ReverbProviderError("unavailable"));
  await expect(create()).rejects.toThrow("may have been created");
  await expect(service.refresh(a, listingId)).rejects.toThrow("may have reached Reverb");
  await expect(create()).rejects.toThrow("No new POST");
  expect(gateway.createDraft).toHaveBeenCalledTimes(2);
});
it("retains a fresh non-draft identity without asserting published or sending DELETE", async () => {
  await create(); remotes[0].state = "ended";
  const result = await service.deleteDraft(a, listingId);
  expect(result.message).toContain("no longer a draft");
  expect(await publication()).toMatchObject({ externalListingId: "remote-1", providerState: "ended", status: "draft" });
  expect((await publication()).publishedAt).toBeUndefined(); expect(gateway.deleteDraft).not.toHaveBeenCalled();
});
it.each(["duplicate", "mismatch"])("refuses %s identities without changing local state", async mode => {
  await create(); const before = await publication();
  remotes = mode === "duplicate" ? [remoteDraft(), remoteDraft("other")] : [remoteDraft("other")];
  await expect(service.refresh(a, listingId)).rejects.toThrow(mode === "duplicate" ? "Multiple" : "identity conflict");
  await expect(service.deleteDraft(a, listingId)).rejects.toThrow();
  expect(await publication()).toEqual(before); expect(gateway.deleteDraft).not.toHaveBeenCalled();
});
it("deletes only after a fresh lookup, confirms absence, and preserves all local product data", async () => {
  await create(); const before = (await listings.getById(a, listingId))!; const connection = await repo.connection(a, "sandbox");
  vi.clearAllMocks(); await service.deleteDraft(a, listingId);
  expect(gateway.findBySku).toHaveBeenCalledTimes(2); expect(gateway.deleteDraft).toHaveBeenCalledOnce();
  expect(gateway.findBySku.mock.invocationCallOrder[0]).toBeLessThan(gateway.deleteDraft.mock.invocationCallOrder[0]);
  expect(gateway.deleteDraft.mock.invocationCallOrder[0]).toBeLessThan(gateway.findBySku.mock.invocationCallOrder[1]);
  const after = (await listings.getById(a, listingId))!;
  expect(after.images).toEqual(before.images); expect(after.title).toBe(before.title); expect(await repo.connection(a, "sandbox")).toEqual(connection);
  expect(await publication()).toMatchObject({ providerState: "missing" }); expect(remotes).toEqual([]);
});
it.each(["missing", "unavailable", "malformed"] as const)("reconciles %s DELETE outcome without retrying", async code => {
  await create(); gateway.deleteDraft.mockImplementationOnce(async () => { assertOutside(); remotes = []; throw new ReverbProviderError(code); });
  await service.deleteDraft(a, listingId); expect((await publication()).providerState).toBe("missing"); expect(gateway.deleteDraft).toHaveBeenCalledOnce();
});
it("keeps linkage when an uncertain DELETE still finds the exact draft", async () => {
  await create(); gateway.deleteDraft.mockRejectedValueOnce(new ReverbProviderError("unavailable"));
  const result = await service.deleteDraft(a, listingId);
  expect(result.message).toContain("not confirmed"); expect((await publication()).externalListingId).toBe("remote-1");
  expect((await publication()).providerState).toBe("draft"); expect(gateway.deleteDraft).toHaveBeenCalledOnce();
});
it("records a non-draft state after uncertain deletion without a second DELETE", async () => {
  await create(); gateway.deleteDraft.mockImplementationOnce(async () => { remotes[0].state = "live"; throw new ReverbProviderError("unavailable"); });
  await service.deleteDraft(a, listingId); expect((await publication()).providerState).toBe("live"); expect(gateway.deleteDraft).toHaveBeenCalledOnce();
});
it("does not overwrite linkage when post-delete lookup reports a conflict", async () => {
  await create(); const before = await publication();
  gateway.deleteDraft.mockImplementationOnce(async () => { remotes = [remoteDraft(), remoteDraft("other")]; });
  await expect(service.deleteDraft(a, listingId)).rejects.toThrow("Multiple"); expect(await publication()).toEqual(before);
});
it.each(["auth", "forbidden", "rate"] as const)("does not retry DELETE after %s rejection", async code => {
  await create(); gateway.deleteDraft.mockRejectedValueOnce(new ReverbProviderError(code)); vi.clearAllMocks();
  await expect(service.deleteDraft(a, listingId)).rejects.toBeInstanceOf(ReverbProviderError);
  expect(gateway.deleteDraft).toHaveBeenCalledOnce(); expect(gateway.findBySku).toHaveBeenCalledOnce();
});
it("denies foreign state reads, refresh, adoption, delete and fence reset before provider I/O", async () => {
  await create(); vi.clearAllMocks(); const before = await publication();
  for (const operation of [service.localState, service.refresh, service.deleteDraft]) await expect(operation(b, listingId)).rejects.toThrow("Listing not found");
  for (const call of Object.values(gateway)) expect(call).not.toHaveBeenCalled(); expect(await publication()).toEqual(before);
});
it("rejects stale reconciliation after a newer management lease commits another identity", async () => {
  const old = await repo.claimManagement(a, "sandbox", listingId);
  await db.update(schema.reverbManagementLeases).set({ expiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(schema.reverbManagementLeases.listingId, listingId));
  const fresh = await repo.claimManagement(a, "sandbox", listingId);
  await repo.reconcile(fresh, remoteDraft("newer")); await repo.releaseManagement(fresh);
  await expect(repo.reconcile(old, remoteDraft("stale"))).rejects.toThrow("stale");
  expect((await publication()).externalListingId).toBe("newer");
});
it("serializes management with creation and fences expired create workers", async () => {
  const prepared = await review(); const createClaim = await repo.claim(a, "sandbox", prepared.reviewId);
  await expect(service.refresh(a, listingId)).rejects.toThrow("in progress");
  await db.update(schema.reverbDraftRequests).set({ leaseUntil: new Date(Date.now() - 1).toISOString() }).where(eq(schema.reverbDraftRequests.listingId, listingId));
  const management = await repo.claimManagement(a, "sandbox", listingId);
  await expect(repo.finish(createClaim, remoteDraft())).rejects.toThrow("stale");
  await expect(review()).rejects.toThrow("in progress"); await expect(repo.claim(a, "sandbox", prepared.reviewId)).rejects.toThrow("in progress");
  await repo.releaseManagement(management);
});
it("rejects stale management before DELETE after a concurrent local edit", async () => {
  await create(); gateway.findBySku.mockImplementationOnce(async () => {
    assertOutside(); await db.update(schema.listings).set({ updatedAt: new Date(Date.now() + 1000).toISOString() }).where(eq(schema.listings.id, listingId)); return remotes;
  });
  await expect(service.deleteDraft(a, listingId)).rejects.toThrow("stale"); expect(gateway.deleteDraft).not.toHaveBeenCalled();
});
