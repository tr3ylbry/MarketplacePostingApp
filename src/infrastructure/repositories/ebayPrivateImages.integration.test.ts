import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTestAuth } from "../../test/auth";
import { listingFixture } from "../../test/fixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { createImageService } from "../../application/imageService";
import { createListingService } from "../../application/listingService";
import { createEbayPrivateImageService } from "../../application/ebayPrivateImageService";
import { PRIVATE_IMAGE_REVIEW_MS } from "../../application/ebayPrivateImages";
import { CLEANUP_GRACE_MS } from "../../application/imageStorage";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import { exportImageValidator } from "../storage/validateExportImage";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { cleanupImages } from "../storage/cleanupImages";
import * as schema from "../db/schema";

const { db, pool, auth } = createTestAuth(), listings = new DrizzleListingRepository(db), images = new DrizzleImageRepository(db), connections = new DrizzleEbayConnectionRepository(db);
const transactions = new AsyncLocalStorage<boolean>();
let owner: string, foreign: string, storage: MemoryImageStorage, listingId: string, imageId: string, bytes: Buffer;
const reader = { readPrivateImage: vi.fn() }, validator = { validate: vi.fn(exportImageValidator.validate) };
const service = () => createEbayPrivateImageService(listings, images, connections, reader, validator, "private-photo-config");
const current = () => listings.getById(owner, listingId);
async function prepare(user = owner) { const listing = (await current())!; return service().prepare(user, listingId, listing.updatedAt, imageId); }
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); bytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#446688" } }).png().toBuffer(); });
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  const helpers = (await auth.$context).test; owner = (await helpers.saveUser(helpers.createUser())).id; foreign = (await helpers.saveUser(helpers.createUser())).id;
  storage = new MemoryImageStorage(); listingId = (await listings.create(owner, listingFixture())).id;
  const imageService = createImageService(images, storage), upload = await imageService.prepare(owner, listingId, { filename: "synthetic.png", contentType: "image/png", size: bytes.length });
  imageId = upload.imageId; const pending = storage.uploads.get(imageId)!; storage.objects.set(pending.pathname, { bytes, type: "image/png" }); await imageService.finalize(owner, listingId, imageId);
  await db.insert(schema.ebayConnections).values({ ownerId: owner, id: randomUUID(), version: randomUUID(), configHash: "private-photo-config", status: "connected", sellerId: "synthetic-seller-" + owner,
    sellerLabel: "Synthetic seller", access: { ciphertext: "synthetic-envelope-a", iv: "iv-a", tag: "tag-a", keyVersion: 1 }, refresh: { ciphertext: "synthetic-envelope-r", iv: "iv-r", tag: "tag-r", keyVersion: 1 },
    accessExpiresAt: new Date(Date.now() - 1000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), connectedAt: new Date().toISOString(), scopes: [...EBAY_SCOPES] });
  const transaction = db.transaction.bind(db); vi.spyOn(db, "transaction").mockImplementation((...args) => transactions.run(true, () => transaction(...args)));
  reader.readPrivateImage.mockImplementation(async source => {
    expect(transactions.getStore()).not.toBe(true);
    const row = (await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId)))[0]; expect(Date.parse(row.providerRetainUntil!)).toBeGreaterThan(Date.now());
    return Buffer.from(storage.objects.get(source.pathname)!.bytes);
  });
  validator.validate.mockImplementation(async (...args) => { expect(transactions.getStore()).not.toBe(true); return exportImageValidator.validate(...args); });
});
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  await db.delete(schema.listings).where(inArray(schema.listings.ownerId, [owner, foreign]));
  await db.delete(schema.users).where(inArray(schema.users.id, [owner, foreign]));
  const paths = [...storage.uploads.values()].map(u => u.pathname); if (paths.length) await db.delete(schema.imageCleanup).where(inArray(schema.imageCleanup.pathname, paths));
});
afterAll(() => pool.end());
it("validates with committed retention, no token access/provider calls, and unchanged listing/connection", async () => {
  const listing = await current(), connection = await connections.connection(owner);
  expect(await prepare()).toMatchObject({ width: 500, height: 500, exportEnabled: false, exportStatus: "not-attempted" });
  expect(await current()).toEqual(listing); expect(await connections.connection(owner)).toEqual(connection);
  expect(await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.listingId, listingId))).toEqual([]);
});
it("denies foreign owners and missing image identities before byte access", async () => {
  await expect(prepare(foreign)).rejects.toMatchObject({ code: "stale" });
  await expect(service().prepare(owner, listingId, (await current())!.updatedAt, randomUUID())).rejects.toMatchObject({ code: "stale" });
  expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["edit", "reconnect", "disconnect"])("rejects stale %s while private I/O is in flight", async change => {
  reader.readPrivateImage.mockImplementationOnce(async () => {
    const listing = (await current())!;
    if (change === "edit") await listings.update(owner, { ...listing, title: "Changed during validation", updatedAt: new Date(Date.parse(listing.updatedAt) + 1000).toISOString() }, listing.updatedAt);
    else await db.update(schema.ebayConnections).set({ version: randomUUID(), ...(change === "disconnect" ? { status: "disconnected" } : {}) }).where(eq(schema.ebayConnections.ownerId, owner));
    return bytes;
  });
  await expect(prepare()).rejects.toMatchObject({ code: "stale" });
});
it.each(["image", "listing"])("preserves bytes and cleanup intent after concurrent %s deletion, then retries after expiry", async kind => {
  const source = (await images.get(owner, listingId, imageId))!.source; if (source.kind !== "vercel-blob") throw new Error();
  const other = await listings.create(foreign, listingFixture());
  const initial = Date.now();
  reader.readPrivateImage.mockImplementationOnce(async () => {
    expect(transactions.getStore()).not.toBe(true);
    if (kind === "image") await createImageService(images, storage).remove(owner, listingId, imageId);
    else await createListingService(listings, storage).deleteListing(owner, listingId);
    expect(storage.objects.has(source.pathname)).toBe(true); return bytes;
  });
  await expect(prepare()).rejects.toMatchObject({ code: "stale" });
  const [entry] = await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, source.pathname));
  expect(Date.parse(entry.notBefore)).toBeGreaterThanOrEqual(initial + PRIVATE_IMAGE_REVIEW_MS + CLEANUP_GRACE_MS);
  await cleanupImages(db, storage); expect(storage.deleted).not.toContain(source.pathname); expect(storage.objects.has(source.pathname)).toBe(true);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(entry.notBefore) + 1);
  storage.failDelete = true; expect((await cleanupImages(db, storage)).failed).toBeGreaterThanOrEqual(1);
  storage.failDelete = false; vi.setSystemTime(Date.now() + CLEANUP_GRACE_MS + 1); expect((await cleanupImages(db, storage)).removed).toBeGreaterThanOrEqual(1);
  expect(await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, source.pathname))).toEqual([]);
  expect(storage.objects.has(source.pathname)).toBe(false); expect(await listings.getById(foreign, other.id)).not.toBeNull();
});
it("never shortens an existing longer retention and leaves safe retention after read failure", async () => {
  const longer = new Date(Date.now() + 1800000).toISOString(); await images.retainForProvider(owner, listingId, imageId, longer);
  reader.readPrivateImage.mockRejectedValueOnce(new Error("private provider response")); await expect(prepare()).rejects.toMatchObject({ code: "invalid" });
  expect(new Date((await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId)))[0].providerRetainUntil!).toISOString()).toBe(longer);
});
