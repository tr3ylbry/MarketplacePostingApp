import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTestAuth } from "../../test/auth";
import { listingFixture } from "../../test/fixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { createImageService } from "../../application/imageService";
import { createListingService } from "../../application/listingService";
import { imagesFromNames } from "../../domain/listingImage";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { cleanupImages } from "../storage/cleanupImages";
import * as schema from "../db/schema";

const { db, pool, auth } = createTestAuth();
const repository = new DrizzleImageRepository(db), listings = new DrizzleListingRepository(db);
let storage: MemoryImageStorage, service: ReturnType<typeof createImageService>, a: string, b: string;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const input = { filename: "photo.png", contentType: "image/png", size: png.length };
const paths = new Set<string>();
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeAll(() => migrate(db, { migrationsFolder: "drizzle" }));
beforeEach(async () => {
  const helpers = (await auth.$context).test;
  a = (await helpers.saveUser(helpers.createUser())).id; b = (await helpers.saveUser(helpers.createUser())).id;
  storage = new MemoryImageStorage(); service = createImageService(repository, storage);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const upload of storage.uploads.values()) paths.add(upload.pathname);
  for (const owner of [a, b]) { await db.delete(schema.listings).where(eq(schema.listings.ownerId, owner)); await db.delete(schema.users).where(eq(schema.users.id, owner)); }
  for (const pathname of paths) await db.delete(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, pathname));
  paths.clear();
});
afterAll(() => pool.end());
async function prepare(owner: string, listingId: string) {
  const result = await service.prepare(owner, listingId, input), upload = storage.uploads.get(result.imageId)!;
  storage.objects.set(upload.pathname, { bytes: png, type: input.contentType }); return upload;
}
async function saved(owner: string, listingId: string) {
  const upload = await prepare(owner, listingId); await service.finalize(owner, listingId, upload.id); return upload;
}

it("persists verified metadata, retries finalization without duplicates and updates concurrency", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await saved(a, listing.id);
  await service.finalize(a, listing.id, upload.id);
  const stored = await listings.getById(a, listing.id);
  expect(stored?.images).toHaveLength(1); expect(stored?.images[0].source).toMatchObject({ kind: "vercel-blob", pathname: upload.pathname, size: png.length });
  expect(stored?.updatedAt).not.toBe(listing.updatedAt);
  await expect(createListingService(listings).updateListing(a, listing.id, listing, listing.updatedAt)).rejects.toThrow();
  expect(await db.select().from(schema.imageUploads).where(eq(schema.imageUploads.id, upload.id))).toEqual([]);
  expect(await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, upload.pathname))).toEqual([]);
  expect(await repository.cancel(a, listing.id, upload.id)).toEqual([]);
});
it("allows each owner to read their own image and denies all foreign combinations", async () => {
  const la = await listings.create(a, listingFixture()), lb = await listings.create(b, listingFixture());
  const ia = await saved(a, la.id), ib = await saved(b, lb.id);
  expect(await service.read(a, la.id, ia.id)).toContain("test.invalid/read");
  expect(await service.read(b, lb.id, ib.id)).toContain("test.invalid/read");
  for (const [owner, listing, image] of [[a, lb.id, ib.id], [b, la.id, ia.id], [a, la.id, ib.id], [b, lb.id, ia.id], [a, la.id, ib.pathname], ["", la.id, ia.id]]) {
    await expect(service.read(owner, listing, image)).rejects.toThrow();
  }
});
it("rejects cross-user prepare/finalize/delete/reorder and injected owners/paths", async () => {
  const la = await listings.create(a, listingFixture()), lb = await listings.create(b, listingFixture());
  const ia = await saved(a, la.id), ib = await prepare(b, lb.id);
  await expect(service.prepare(b, la.id, input)).rejects.toThrow("not found");
  await expect(service.prepare(a, la.id, { ...input, ownerId: b })).rejects.toThrow();
  await expect(service.prepare(a, la.id, { ...input, pathname: ib.pathname })).rejects.toThrow();
  await expect(service.finalize(a, lb.id, ib.id)).rejects.toThrow("not found");
  await expect(service.finalize(b, la.id, ib.id)).rejects.toThrow("not found");
  await expect(service.finalize(a, la.id, ib.id)).rejects.toThrow();
  await expect(service.remove(b, la.id, ia.id)).rejects.toThrow("not found");
  await expect(service.reorder(b, la.id, [ia.id])).rejects.toThrow("not found");
  expect(storage.deleted).toEqual([]); expect((await listings.getById(a, la.id))?.images).toHaveLength(1);
});
it("rejects invalid MIME, size and filename before reserving or contacting storage", async () => {
  const listing = await listings.create(a, listingFixture());
  for (const override of [{ contentType: "image/svg+xml" }, { size: 0 }, { size: 10485761 }, { filename: "x".repeat(256) }]) await expect(service.prepare(a, listing.id, { ...input, ...override })).rejects.toThrow();
  expect(storage.uploads.size).toBe(0);
});
it("counts pending reservations and legacy images atomically under concurrent preparations", async () => {
  const listing = listingFixture(); listing.images = imagesFromNames(listing.id, Array.from({ length: 39 }, (_, i) => `${i}.png`));
  await listings.create(a, listing);
  const result = await Promise.allSettled([service.prepare(a, listing.id, input), service.prepare(a, listing.id, input)]);
  expect(result.filter(value => value.status === "fulfilled")).toHaveLength(1);
  expect(result.filter(value => value.status === "rejected")).toHaveLength(1);
});
it("reorders transactionally without unique-order collisions, retaining IDs and bytes", async () => {
  const listing = await listings.create(a, listingFixture()), first = await saved(a, listing.id), second = await saved(a, listing.id);
  await service.reorder(a, listing.id, [second.id, first.id]);
  expect((await listings.getById(a, listing.id))?.images.map(image => image.id)).toEqual([second.id, first.id]);
  await expect(service.reorder(a, listing.id, [second.id, second.id])).rejects.toThrow();
  await expect(service.reorder(a, listing.id, [first.id])).rejects.toThrow();
  expect(storage.objects.size).toBe(2); expect(storage.deleted).toEqual([]);
});
it("appends to valid legacy ordering gaps and enforces relational image constraints", async () => {
  const listing = listingFixture(); listing.images = imagesFromNames(listing.id, ["legacy.png"]); listing.images[0].order = 1;
  await listings.create(a, listing);
  const upload = await saved(a, listing.id);
  expect((await listings.getById(a, listing.id))?.images.map(image => image.order)).toEqual([1, 2]);
  await expect(db.update(schema.listingImages).set({ byteSize: -1 }).where(eq(schema.listingImages.id, upload.id))).rejects.toThrow();
  await expect(db.update(schema.listingImages).set({ contentType: "image/svg+xml" }).where(eq(schema.listingImages.id, upload.id))).rejects.toThrow();
  await expect(db.update(schema.listingImages).set({ order: 1 }).where(eq(schema.listingImages.id, upload.id))).rejects.toThrow();
});
it("removes metadata before failed cleanup, resequences and safely repeats deletion", async () => {
  const listing = await listings.create(a, listingFixture()), first = await saved(a, listing.id), second = await saved(a, listing.id);
  storage.failDelete = true; await service.remove(a, listing.id, first.id); await service.remove(a, listing.id, first.id);
  expect((await listings.getById(a, listing.id))?.images.map(image => [image.id, image.order])).toEqual([[second.id, 0]]);
  expect(storage.objects.has(first.pathname)).toBe(true);
  await db.update(schema.imageCleanup).set({ notBefore: new Date(0).toISOString() }).where(eq(schema.imageCleanup.pathname, first.pathname));
  expect((await cleanupImages(db, storage)).failed).toBeGreaterThan(0);
  storage.failDelete = false;
  await db.update(schema.imageCleanup).set({ notBefore: new Date(0).toISOString() }).where(eq(schema.imageCleanup.pathname, first.pathname));
  expect((await cleanupImages(db, storage)).removed).toBeGreaterThan(0);
  expect(storage.objects.has(first.pathname)).toBe(false); expect(storage.objects.has(second.pathname)).toBe(true);
});
it("compensates missing or mismatched objects without creating saved metadata", async () => {
  const listing = await listings.create(a, listingFixture());
  for (const bytes of [null, new Uint8Array(png.length)]) {
    const upload = await prepare(a, listing.id);
    if (bytes) storage.objects.set(upload.pathname, { bytes, type: input.contentType }); else storage.objects.delete(upload.pathname);
    await expect(service.finalize(a, listing.id, upload.id)).rejects.toThrow();
    expect(storage.deleted).toContain(upload.pathname);
  }
  expect((await listings.getById(a, listing.id))?.images).toEqual([]);
});
it("compensates a database failure after verification and never deletes an ambiguously committed image", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  const verify = vi.spyOn(storage, "verifyUpload");
  const commit = vi.spyOn(repository, "finalize").mockRejectedValueOnce(new Error("Database failure"));
  const failing = createImageService(repository, storage);
  await expect(failing.finalize(a, listing.id, upload.id)).rejects.toThrow();
  expect(verify).toHaveBeenCalledOnce();
  expect(storage.deleted).toContain(upload.pathname); expect((await listings.getById(a, listing.id))?.images).toEqual([]);
  commit.mockRestore();
  const committed = await prepare(a, listing.id);
  const finalize = repository.finalize.bind(repository);
  const ambiguous = vi.spyOn(repository, "finalize").mockImplementationOnce(async (...args) => {
    await finalize(...args); throw new Error("Commit response lost");
  });
  await expect(failing.finalize(a, listing.id, committed.id)).rejects.toThrow();
  expect((await listings.getById(a, listing.id))?.images[0].id).toBe(committed.id);
  expect(storage.deleted).not.toContain(committed.pathname);
  ambiguous.mockRestore(); verify.mockRestore();
  await failing.finalize(a, listing.id, committed.id);
});
it("listing deletion cascades metadata and cleans only its owner's saved and pending objects", async () => {
  const la = await listings.create(a, listingFixture()), lb = await listings.create(b, listingFixture());
  const ia = await saved(a, la.id), pending = await prepare(a, la.id), ib = await saved(b, lb.id);
  const service = createListingService(listings, storage);
  await expect(service.deleteListing(a, lb.id)).rejects.toThrow(); expect(storage.deleted).toEqual([]);
  await service.deleteListing(a, la.id);
  expect(storage.deleted.sort()).toEqual([ia.pathname, pending.pathname].sort());
  expect(storage.objects.has(ib.pathname)).toBe(true);
  expect(await db.select().from(schema.listingImages).where(eq(schema.listingImages.listingId, la.id))).toEqual([]);
  expect(await db.select().from(schema.imageUploads).where(eq(schema.imageUploads.listingId, la.id))).toEqual([]);
});
it("rejects forged Blob metadata on local import and preserves images on ordinary edits", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await saved(a, listing.id);
  const current = (await listings.getById(a, listing.id))!;
  const service = createListingService(listings, storage);
  await expect(service.importListings(b, [current])).rejects.toThrow();
  const updated = await service.updateListing(a, listing.id, { ...current, title: "Edited", imageNames: [] }, current.updatedAt);
  expect(updated.images[0].id).toBe(upload.id); expect((await listings.getById(a, listing.id))?.images).toEqual(current.images);
});
it("expires abandoned reservations, releases capacity and retains cleanup until safe", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  await db.update(schema.imageUploads).set({ expiresAt: new Date(0).toISOString() }).where(eq(schema.imageUploads.id, upload.id));
  await expect(service.finalize(a, listing.id, upload.id)).rejects.toThrow("expired");
  expect(await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, upload.pathname))).toHaveLength(1);
  expect((await listings.getById(a, listing.id))?.images).toEqual([]);
});

it("performs verification and cleanup provider calls with no active database transaction", async () => {
  const transaction = db.transaction.bind(db);
  let active = 0;
  vi.spyOn(db, "transaction").mockImplementation(async (...args) => {
    active++;
    try { return await transaction(...args); } finally { active--; }
  });
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  const verify = storage.verifyUpload.bind(storage);
  vi.spyOn(storage, "verifyUpload").mockImplementation(async value => { expect(active).toBe(0); return verify(value); });
  await service.finalize(a, listing.id, upload.id);
  await repository.remove(a, listing.id, upload.id);
  await db.update(schema.imageCleanup).set({ notBefore: new Date(0).toISOString() }).where(eq(schema.imageCleanup.pathname, upload.pathname));
  const remove = storage.deleteObject.bind(storage);
  vi.spyOn(storage, "deleteObject").mockImplementation(async path => { expect(active).toBe(0); await remove(path); });
  expect((await cleanupImages(db, storage)).removed).toBeGreaterThan(0);
  expect(storage.deleted).toContain(upload.pathname);
});

it("allows a second finalizer to commit while the first is verifying, then resolves both idempotently", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  const entered = signal(), release = signal();
  const verify = storage.verifyUpload.bind(storage);
  vi.spyOn(storage, "verifyUpload").mockImplementationOnce(async value => {
    const source = await verify(value); entered.resolve(); await release.promise; return source;
  });
  const first = service.finalize(a, listing.id, upload.id);
  try {
    await entered.promise;
    await service.finalize(a, listing.id, upload.id);
    expect((await listings.getById(a, listing.id))?.images).toHaveLength(1);
  } finally { release.resolve(); }
  await first;
  expect((await listings.getById(a, listing.id))?.images).toHaveLength(1);
  expect(storage.deleted).toEqual([]);
});

it("rejects expiry between provider verification and commit and safely compensates", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  const verify = storage.verifyUpload.bind(storage);
  vi.spyOn(storage, "verifyUpload").mockImplementationOnce(async value => {
    const source = await verify(value);
    await db.update(schema.imageUploads).set({ expiresAt: new Date(0).toISOString() }).where(eq(schema.imageUploads.id, upload.id));
    return source;
  });
  await expect(service.finalize(a, listing.id, upload.id)).rejects.toThrow("expired");
  expect((await listings.getById(a, listing.id))?.images).toEqual([]);
  expect(storage.deleted).toContain(upload.pathname);
});

it.each(["pathname", "contentType", "size", "originalFilename"] as const)("rechecks verified %s against immutable reservation at commit", async field => {
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  const source = await storage.verifyUpload(upload);
  const overrides = { pathname: `images/${crypto.randomUUID()}/other.png`, contentType: "image/jpeg" as const, size: source.size + 1, originalFilename: "other.png" };
  vi.spyOn(storage, "verifyUpload").mockResolvedValueOnce({ ...source, [field]: overrides[field] });
  await expect(service.finalize(a, listing.id, upload.id)).rejects.toThrow("does not match");
  expect((await listings.getById(a, listing.id))?.images).toEqual([]);
});

it("cleanup skips committed images and unexpired reservations even with an early due ledger entry", async () => {
  const listing = await listings.create(a, listingFixture()), committed = await saved(a, listing.id), pending = await prepare(a, listing.id);
  await db.insert(schema.imageCleanup).values({ pathname: committed.pathname, notBefore: new Date(0).toISOString() });
  await db.update(schema.imageCleanup).set({ notBefore: new Date(0).toISOString() }).where(eq(schema.imageCleanup.pathname, pending.pathname));
  await cleanupImages(db, storage);
  expect(storage.deleted).not.toContain(committed.pathname); expect(storage.deleted).not.toContain(pending.pathname);
  await service.finalize(a, listing.id, pending.id);
  expect((await listings.getById(a, listing.id))?.images).toHaveLength(2);
});

it("cleanup leases exclude concurrent workers and retain a requeued entry on completion", async () => {
  const listing = await listings.create(a, listingFixture()), upload = await prepare(a, listing.id);
  await db.update(schema.imageUploads).set({ expiresAt: new Date(0).toISOString() }).where(eq(schema.imageUploads.id, upload.id));
  await db.update(schema.imageCleanup).set({ notBefore: new Date(0).toISOString() }).where(eq(schema.imageCleanup.pathname, upload.pathname));
  const entered = signal(), release = signal();
  const remove = storage.deleteObject.bind(storage);
  vi.spyOn(storage, "deleteObject").mockImplementationOnce(async path => { entered.resolve(); await release.promise; await remove(path); });
  const first = cleanupImages(db, storage);
  try {
    await entered.promise;
    await cleanupImages(db, storage);
    expect(storage.deleteObject).toHaveBeenCalledOnce();
    await db.update(schema.imageCleanup).set({ notBefore: new Date(Date.now() + 600000).toISOString() }).where(eq(schema.imageCleanup.pathname, upload.pathname));
  } finally { release.resolve(); }
  await first;
  expect(await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, upload.pathname))).toHaveLength(1);
  expect(await db.select().from(schema.imageUploads).where(eq(schema.imageUploads.id, upload.id))).toHaveLength(1);
  await db.update(schema.imageCleanup).set({ notBefore: new Date(0).toISOString() }).where(eq(schema.imageCleanup.pathname, upload.pathname));
  await cleanupImages(db, storage);
  expect(await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, upload.pathname))).toEqual([]);
  expect(await db.select().from(schema.imageUploads).where(eq(schema.imageUploads.id, upload.id))).toEqual([]);
});
