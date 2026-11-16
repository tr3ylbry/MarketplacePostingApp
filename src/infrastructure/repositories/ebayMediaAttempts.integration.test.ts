import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTestAuth } from "../../test/auth";
import { listingFixture } from "../../test/fixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { mediaFixture } from "../../test/ebay/mediaFixture";
import { createImageService } from "../../application/imageService";
import { createListingService } from "../../application/listingService";
import { createMediaAttemptService } from "../../application/ebayMediaAttemptService";
import { mediaDigest, MEDIA_LEASE_MS, type MediaOutcome } from "../../application/ebayMediaAttempt";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { DrizzleEbayMediaRepository } from "./drizzleEbayMediaRepository";
import { exportImageValidator } from "../storage/validateExportImage";
import { cleanupImages } from "../storage/cleanupImages";
import * as schema from "../db/schema";

const { db, pool, auth } = createTestAuth();
const listings = new DrizzleListingRepository(db), images = new DrizzleImageRepository(db), repository = new DrizzleEbayMediaRepository(db);
const transactions = new AsyncLocalStorage<boolean>();
const reader = { readPrivateImage: vi.fn() }, fixture = { create: vi.fn(mediaFixture.create) }, gateway = { create: vi.fn() };
let owner: string, foreign: string, listingId: string, imageId: string, bytes: Buffer, storage: MemoryImageStorage, now: Date;
const row = async () => (await db.select().from(schema.ebayMediaAttempts).where(eq(schema.ebayMediaAttempts.ownerId, owner)))[0];
const current = () => listings.getById(owner, listingId);
const outcome = (): MediaOutcome => ({ complete: true, imageId: "fake_" + "a".repeat(32), imageUrl: "http://127.0.0.1:4313/eps/fake_" + "a".repeat(32) + ".png",
  expiresAt: new Date(now.getTime() + 3600000).toISOString(), responseStatus: 201, reason: "complete" });
const service = () => createMediaAttemptService(repository, reader, exportImageValidator, fixture, gateway, "media-config", () => now);
const simulate = async (user = owner, photo = imageId) => service().simulate(user, listingId, (await current())!.updatedAt, photo);
async function addImage(content = bytes) {
  const service = createImageService(images, storage), prepared = await service.prepare(owner, listingId, { filename: "synthetic.png", contentType: "image/png", size: content.length });
  const pending = storage.uploads.get(prepared.imageId)!; storage.objects.set(pending.pathname, { bytes: content, type: "image/png" });
  await service.finalize(owner, listingId, prepared.imageId); return prepared.imageId;
}
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); bytes = await sharp({ create: { width: 500, height: 600, channels: 3, background: "#883322" } }).png().toBuffer(); });
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); now = new Date();
  const helpers = (await auth.$context).test; owner = (await helpers.saveUser(helpers.createUser())).id; foreign = (await helpers.saveUser(helpers.createUser())).id;
  storage = new MemoryImageStorage(); listingId = (await listings.create(owner, listingFixture())).id; imageId = await addImage();
  await db.insert(schema.ebayConnections).values({ ownerId: owner, id: randomUUID(), version: randomUUID(), configHash: "media-config", status: "connected",
    sellerId: mediaDigest("synthetic-seller-" + owner), sellerLabel: "Synthetic seller", access: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    refresh: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 }, accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), connectedAt: new Date().toISOString(), scopes: [...EBAY_SCOPES] });
  const transaction = db.transaction.bind(db); vi.spyOn(db, "transaction").mockImplementation((...args) => transactions.run(true, () => transaction(...args)));
  reader.readPrivateImage.mockImplementation(async source => {
    expect(transactions.getStore()).not.toBe(true); expect((await row()).state).toBe("preparing");
    const [image] = await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId)); expect(Date.parse(image.providerRetainUntil!)).toBeGreaterThan(now.getTime());
    return Buffer.from(storage.objects.get(source.pathname)!.bytes);
  });
  fixture.create.mockImplementation(mediaFixture.create);
  gateway.create.mockImplementation(async content => {
    expect(transactions.getStore()).not.toBe(true);
    const saved = await row(); expect(saved.state).toBe("unknown"); expect(saved.postAttemptedAt).not.toBeNull();
    expect(saved.exportDigest).toBe(mediaDigest(content)); expect(saved.sourceDigest).toBe(mediaDigest(bytes));
    return outcome();
  });
});
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  await db.delete(schema.ebayMediaAttempts).where(inArray(schema.ebayMediaAttempts.ownerId, [owner, foreign]));
  await db.delete(schema.listings).where(inArray(schema.listings.ownerId, [owner, foreign]));
  await db.delete(schema.users).where(inArray(schema.users.id, [owner, foreign]));
  const paths = [...storage.uploads.values()].map(upload => upload.pathname); if (paths.length) await db.delete(schema.imageCleanup).where(inArray(schema.imageCleanup.pathname, paths));
});
afterAll(() => pool.end());

it("commits retention/claim before reads, a send fence before POST and separate content identities before confirmed response", async () => {
  const connection = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner));
  const listing = await current();
  expect(await simulate()).toEqual({ state: "confirmed", simulation: true });
  const saved = await row(); expect(saved.sourceDigest).not.toBe(saved.exportDigest); expect(saved.transformationVersion).toBe("generated-fixture-v1");
  expect(saved.returnedImageId).toBe(outcome().imageId); expect(saved.imageUrl).toBe(outcome().imageUrl); expect(saved.expiresAt).not.toBeNull();
  expect(Object.keys(saved)).not.toContain("pathname"); expect(JSON.stringify(saved)).not.toMatch(/synthetic\.png|ciphertext|refreshToken|Bearer|object\//);
  expect(await current()).toEqual(listing); expect(await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner))).toEqual(connection);
  expect(await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.listingId, listingId))).toEqual([]);
  expect(await simulate()).toEqual({ state: "confirmed", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(1); expect(reader.readPrivateImage).toHaveBeenCalledTimes(1);
});
it("scopes claims to the owner and saved durable image before any read, and rejects a stale version", async () => {
  await expect(simulate(foreign)).rejects.toMatchObject({ code: "stale" });
  await expect(simulate(owner, randomUUID())).rejects.toMatchObject({ code: "stale" });
  await expect(service().simulate(owner, listingId, "2000-01-01T00:00:00.000Z", imageId)).rejects.toMatchObject({ code: "stale" });
  expect(await row()).toBeUndefined(); expect(reader.readPrivateImage).not.toHaveBeenCalled(); expect(gateway.create).not.toHaveBeenCalled();
});
it("permits explicit retry after definitive pre-send failure but keeps the extra retention", async () => {
  reader.readPrivateImage.mockRejectedValueOnce(new Error("private provider response")); await expect(simulate()).rejects.toMatchObject({ code: "preparation" });
  expect(await row()).toMatchObject({ state: "not-sent", postAttemptedAt: null }); expect(gateway.create).not.toHaveBeenCalled();
  expect(await simulate()).toEqual({ state: "confirmed", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(1);
});
it("never signs/sends if the durable claim/retention transaction fails", async () => {
  vi.spyOn(repository, "claim").mockRejectedValueOnce(new Error("private DB connection details"));
  await expect(simulate()).rejects.toMatchObject({ code: "preparation" }); expect(reader.readPrivateImage).not.toHaveBeenCalled(); expect(gateway.create).not.toHaveBeenCalled();
});
it("cannot send if committing the pre-transmission fence fails", async () => {
  vi.spyOn(repository, "markSending").mockRejectedValueOnce(new Error("DB unavailable"));
  await expect(simulate()).rejects.toMatchObject({ code: "preparation" }); expect((await row()).postAttemptedAt).toBeNull(); expect(gateway.create).not.toHaveBeenCalled();
});
it.each(["image", "listing", "edit", "reconnect", "disconnect", "seller"])("refuses a changed %s before transmission", async kind => {
  reader.readPrivateImage.mockImplementationOnce(async source => {
    const result = Buffer.from(storage.objects.get(source.pathname)!.bytes);
    if (kind === "image") await createImageService(images, storage).remove(owner, listingId, imageId);
    else if (kind === "listing") await createListingService(listings, storage).deleteListing(owner, listingId);
    else if (kind === "edit") { const listing = (await current())!; await listings.update(owner, { ...listing, title: "Changed", updatedAt: new Date(Date.parse(listing.updatedAt) + 1).toISOString() }, listing.updatedAt); }
    else await db.update(schema.ebayConnections).set({ version: randomUUID(), ...(kind === "disconnect" ? { status: "disconnected" } : kind === "seller" ? { sellerId: mediaDigest("another-seller") } : {}) }).where(eq(schema.ebayConnections.ownerId, owner));
    return result;
  });
  await expect(simulate()).rejects.toMatchObject({ code: "stale" }); expect((await row()).postAttemptedAt).toBeNull(); expect(gateway.create).not.toHaveBeenCalled();
});
it.each(["image", "listing", "edit", "connection"])("preserves a valid residual response after concurrent %s deletion/change and local cleanup", async kind => {
  const foreignListing = await listings.create(foreign, listingFixture());
  const source = (await images.get(owner, listingId, imageId))!.source; if (source.kind !== "vercel-blob") throw new Error();
  gateway.create.mockImplementationOnce(async () => {
    expect(transactions.getStore()).not.toBe(true); expect((await row()).state).toBe("unknown");
    if (kind === "image") await createImageService(images, storage).remove(owner, listingId, imageId);
    else if (kind === "listing") await createListingService(listings, storage).deleteListing(owner, listingId);
    else if (kind === "edit") { const listing = (await current())!; await listings.update(owner, { ...listing, title: "Edited during send", updatedAt: new Date(Date.parse(listing.updatedAt) + 1).toISOString() }, listing.updatedAt); }
    else await db.update(schema.ebayConnections).set({ version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
    return outcome();
  });
  expect(await simulate()).toEqual({ state: "residual", simulation: true });
  expect(await row()).toMatchObject({ state: "residual", returnedImageId: outcome().imageId, imageUrl: outcome().imageUrl });
  if (kind === "image" || kind === "listing") {
    const [entry] = await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, source.pathname)); expect(Date.parse(entry.notBefore)).toBeGreaterThan(now.getTime());
    await cleanupImages(db, storage); expect(storage.objects.has(source.pathname)).toBe(true);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(entry.notBefore) + 1); await cleanupImages(db, storage);
    expect(storage.objects.has(source.pathname)).toBe(false); expect((await row()).returnedImageId).toBe(outcome().imageId);
  }
  expect(await listings.getById(foreign, foreignListing.id)).not.toBeNull();
});
it.each(["transport", "id-only", "url-only", "expired"])("persists %s uncertainty and blocks reposting even after lease/response expiry", async kind => {
  gateway.create.mockResolvedValueOnce({ ...outcome(), complete: false, reason: kind === "expired" ? "expired" : "response",
    imageId: kind === "url-only" || kind === "transport" ? null : outcome().imageId,
    imageUrl: kind === "id-only" || kind === "transport" ? null : outcome().imageUrl,
    expiresAt: kind === "id-only" || kind === "transport" ? null : kind === "expired" ? "2020-01-01T00:00:00.000Z" : outcome().expiresAt });
  expect(await simulate()).toEqual({ state: "unknown", simulation: true });
  now = new Date(now.getTime() + MEDIA_LEASE_MS + 1); expect(await simulate()).toEqual({ state: "unknown", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(1);
});
it("does not reset a send fence after an ambiguous DB acknowledgement or local final-commit outage", async () => {
  vi.spyOn(repository, "settle").mockRejectedValue(new Error("private DB connection details"));
  await expect(simulate()).rejects.toMatchObject({ code: "unknown" }); expect((await row()).state).toBe("unknown");
  expect(await simulate()).toEqual({ state: "unknown", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(1);
});
it("cannot undo a send fence when the pre-send DB commit succeeded but acknowledgement was lost", async () => {
  const mark = repository.markSending.bind(repository); vi.spyOn(repository, "markSending").mockImplementationOnce(async (...args) => { await mark(...args); throw new Error("Lost DB acknowledgement"); });
  await expect(simulate()).rejects.toMatchObject({ code: "preparation" }); expect((await row()).state).toBe("unknown");
  expect(await simulate()).toEqual({ state: "unknown", simulation: true }); expect(gateway.create).not.toHaveBeenCalled();
});
it("expires a pre-send lease safely but cannot send using its old claim", async () => {
  const old = await repository.claim(owner, listingId, (await current())!.updatedAt, imageId, "media-config", now); if (old.kind !== "claimed") throw new Error();
  await expect(simulate()).rejects.toMatchObject({ code: "busy" }); now = new Date(now.getTime() + MEDIA_LEASE_MS + 1);
  await expect(repository.markSending(old.claim, { sourceDigest: mediaDigest(bytes), exportDigest: mediaDigest(bytes), size: bytes.length }, now)).rejects.toMatchObject({ code: "stale" });
  expect(await simulate()).toEqual({ state: "confirmed", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(1);
});
it("serializes duplicate concurrent attempts and caps simultaneous byte pipelines without a queue", async () => {
  const second = await addImage(await sharp({ create: { width: 500, height: 600, channels: 3, background: "#225544" } }).png().toBuffer());
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  reader.readPrivateImage.mockImplementation(async source => { await gate; return Buffer.from(storage.objects.get(source.pathname)!.bytes); });
  gateway.create.mockImplementation(async () => outcome());
  const first = simulate(), next = simulate(owner, second);
  await vi.waitFor(() => expect(reader.readPrivateImage).toHaveBeenCalledTimes(2));
  await expect(simulate()).rejects.toMatchObject({ code: "busy" }); release();
  await Promise.all([first, next]); expect(gateway.create).toHaveBeenCalledTimes(2);
  expect(await simulate()).toEqual({ state: "confirmed", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(2);
});
it("does not let a new local image ID or concurrent duplicate content bypass a send fence", async () => {
  const second = await addImage();
  reader.readPrivateImage.mockImplementation(async source => Buffer.from(storage.objects.get(source.pathname)!.bytes));
  gateway.create.mockImplementation(async () => outcome());
  const results = await Promise.allSettled([simulate(), simulate(owner, second)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(gateway.create).toHaveBeenCalledTimes(1);
  expect(results.filter(result => result.status === "rejected")[0]).toMatchObject({ reason: { code: "unknown" } });
  expect((await db.select().from(schema.ebayMediaAttempts).where(eq(schema.ebayMediaAttempts.ownerId, owner))).filter(attempt => attempt.postAttemptedAt)).toHaveLength(1);
});
it("never shortens an existing source hold when preparation fails", async () => {
  const longer = new Date(now.getTime() + 1800000).toISOString(); await images.retainForProvider(owner, listingId, imageId, longer);
  fixture.create.mockRejectedValueOnce(new Error("Synthetic generator unavailable")); await expect(simulate()).rejects.toMatchObject({ code: "preparation" });
  expect(new Date((await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId)))[0].providerRetainUntil!).toISOString()).toBe(longer);
  expect(gateway.create).not.toHaveBeenCalled();
});
it("never enables reuse/repost after a confirmed response expires and rejects real-mode/schema impersonation", async () => {
  await simulate();
  for (const values of [{ simulation: false }, { environment: "production" }, { transformationVersion: "original-bytes" }, { imageUrl: "https://i.ebayimg.com/guessed.png" }]) {
    await expect(db.update(schema.ebayMediaAttempts).set(values).where(eq(schema.ebayMediaAttempts.ownerId, owner))).rejects.toThrow();
  }
  now = new Date(now.getTime() + 3600001); expect(await simulate()).toEqual({ state: "residual", simulation: true }); expect(gateway.create).toHaveBeenCalledTimes(1);
  await listings.delete(owner, listingId);
  await expect(db.delete(schema.users).where(eq(schema.users.id, owner))).rejects.toThrow(); // Evidence is not silently cascaded with account removal.
});
