import { createEbayPrivateImageService } from "./ebayPrivateImageService";
import { EBAY_SCOPES, type EbayConnection } from "./ebayConnection";
import { listingFixture } from "../test/fixtures";
import { blobImageSourceSchema } from "../domain/listingImage";
import type { ListingImage } from "../domain/listingImage";
import type { Listing } from "../domain/listing";
import { CLEANUP_GRACE_MS } from "./imageStorage";
import { PRIVATE_IMAGE_REVIEW_MS } from "./ebayPrivateImages";

const owner = "photo-owner", now = new Date("2026-11-10T10:00:00.000Z");
let listing: Listing, image: ListingImage, connection: EbayConnection;
const listings = { getById: vi.fn() }, images = { get: vi.fn(), retainForProvider: vi.fn() }, connections = { connection: vi.fn() };
const reader = { readPrivateImage: vi.fn() }, validator = { validate: vi.fn() };
const service = () => createEbayPrivateImageService(listings, images, connections, reader, validator, "configuration", () => now);
const prepare = () => service().prepare(owner, listing.id, listing.updatedAt, image.id);
beforeEach(() => {
  vi.resetAllMocks(); listing = listingFixture();
  image = { id: "4ea3182c-53f6-49ba-b208-aadf2e4d6e5b", listingId: listing.id, order: 0,
    source: blobImageSourceSchema.parse({ kind: "vercel-blob", pathname: "images/4ea3182c-53f6-49ba-b208-aadf2e4d6e5b/photo.png", originalFilename: "photo.png", contentType: "image/png", size: 12, uploadedAt: now.toISOString() }) };
  connection = { ownerId: owner, environment: "sandbox", id: "connection", version: "version", configHash: "configuration", status: "connected", sellerId: "hashed-seller", sellerLabel: "Synthetic seller",
    access: { ciphertext: "private-access-envelope", iv: "iv1", tag: "tag1", keyVersion: 1 }, refresh: { ciphertext: "private-refresh-envelope", iv: "iv2", tag: "tag2", keyVersion: 1 },
    accessExpiresAt: "2026-11-10T09:00:00.000Z", refreshExpiresAt: "2027-01-01T00:00:00.000Z", connectedAt: now.toISOString(), scopes: [...EBAY_SCOPES], leaseToken: null, leaseUntil: null };
  listings.getById.mockImplementation(async user => user === owner ? listing : null); images.get.mockResolvedValue(image);
  images.retainForProvider.mockResolvedValue(image.source.kind === "vercel-blob" ? image.source.pathname : "");
  connections.connection.mockResolvedValue(connection); reader.readPrivateImage.mockResolvedValue(Buffer.alloc(12));
  validator.validate.mockResolvedValue({ width: 500, height: 500, contentType: "image/png", size: 12 });
});
it("commits owner-scoped retention before reading and returns only a non-exporting photo review", async () => {
  reader.readPrivateImage.mockImplementation(async () => { expect(images.retainForProvider).toHaveBeenCalled(); return Buffer.alloc(12); });
  const review = await prepare();
  expect(images.retainForProvider).toHaveBeenCalledWith(owner, listing.id, image.id, new Date(now.getTime() + PRIVATE_IMAGE_REVIEW_MS + CLEANUP_GRACE_MS).toISOString());
  expect(review).toMatchObject({ imageId: image.id, order: 0, width: 500, height: 500, exportEnabled: false, exportStatus: "not-attempted" });
  expect(JSON.stringify(review)).not.toMatch(/pathname|images\/|private-|ciphertext|token|seller|configuration|Bearer/);
  expect(reader.readPrivateImage).toHaveBeenCalledOnce(); expect(validator.validate).toHaveBeenCalledOnce();
});
it("denies a foreign owner before credential or storage access", async () => {
  await expect(service().prepare("other", listing.id, listing.updatedAt, image.id)).rejects.toMatchObject({ code: "stale" });
  expect(connections.connection).not.toHaveBeenCalled(); expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["missing-listing", "old-version", "missing-image", "different-image", "foreign-image-listing"])("rejects %s without reading bytes", async kind => {
  if (kind === "missing-listing") listings.getById.mockResolvedValue(null);
  if (kind === "old-version") listing = { ...listing, updatedAt: "2020-01-01T00:00:00.000Z" };
  if (kind === "missing-image") images.get.mockResolvedValue(null);
  if (kind === "different-image") images.get.mockResolvedValue({ ...image, id: "other" });
  if (kind === "foreign-image-listing") images.get.mockResolvedValue({ ...image, listingId: "other" });
  await expect(service().prepare(owner, listing.id, kind === "old-version" ? now.toISOString() : listing.updatedAt, image.id)).rejects.toMatchObject({ code: "stale" });
  expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["owner", "environment", "status", "seller", "config", "expiry", "scope", "ciphertext"])("rejects invalid connection %s", async kind => {
  if (kind === "owner") connection.ownerId = "foreign";
  if (kind === "environment") connection.environment = "production";
  if (kind === "status") connection.status = "disconnected";
  if (kind === "seller") connection.sellerId = null;
  if (kind === "config") connection.configHash = "other";
  if (kind === "expiry") connection.refreshExpiresAt = "2020-01-01T00:00:00.000Z";
  if (kind === "scope") connection.scopes = ["https://api.ebay.com/oauth/api_scope/sell.marketing"];
  if (kind === "ciphertext") connection.access = null;
  await expect(prepare()).rejects.toMatchObject({ code: "unavailable" }); expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["filename", "webp"])("does not read unsupported %s sources", async kind => {
  images.get.mockResolvedValue({ ...image, source: kind === "filename" ? { kind: "filename", name: "legacy.png" } : { ...image.source, contentType: "image/webp" } });
  await expect(prepare()).rejects.toMatchObject({ code: "unsupported" }); expect(images.retainForProvider).not.toHaveBeenCalled();
});
it("does not read if retention fails or resolves a different trusted source", async () => {
  images.retainForProvider.mockRejectedValueOnce(new Error("private database error"));
  await expect(prepare()).rejects.toMatchObject({ code: "invalid" }); expect(reader.readPrivateImage).not.toHaveBeenCalled();
  images.retainForProvider.mockResolvedValueOnce("different");
  await expect(prepare()).rejects.toMatchObject({ code: "stale" }); expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["delete", "edit", "source", "reconnect", "disconnect", "seller"])("discards a review after concurrent %s", async kind => {
  reader.readPrivateImage.mockImplementationOnce(async () => {
    if (kind === "delete") images.get.mockResolvedValue(null);
    if (kind === "edit") listings.getById.mockResolvedValue({ ...listing, updatedAt: "2020-01-01T00:00:00.000Z" });
    if (kind === "source") images.get.mockResolvedValue({ ...image, source: { ...image.source, size: 13 } });
    if (kind === "reconnect") connections.connection.mockResolvedValue({ ...connection, version: "new-version" });
    if (kind === "disconnect") connections.connection.mockResolvedValue({ ...connection, status: "disconnected" });
    if (kind === "seller") connections.connection.mockResolvedValue({ ...connection, sellerId: "other" });
    return Buffer.alloc(12);
  });
  await expect(prepare()).rejects.toMatchObject({ code: "stale" });
});
it("rejects changed byte length and removes raw storage/decoder failures from errors", async () => {
  reader.readPrivateImage.mockResolvedValueOnce(Buffer.alloc(13)); await expect(prepare()).rejects.toMatchObject({ code: "invalid" });
  for (const target of [reader.readPrivateImage, validator.validate]) {
    target.mockRejectedValueOnce(new Error("Bearer private-token https://private.invalid/source"));
    await expect(prepare()).rejects.toThrow("could not be verified");
  }
});
it("bounds concurrent validation without queueing and releases slots on failure", async () => {
  const releases: (() => void)[] = [];
  reader.readPrivateImage.mockImplementation(() => new Promise<Buffer>(resolve => releases.push(() => resolve(Buffer.alloc(12)))));
  const first = prepare(), second = prepare();
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  await expect(prepare()).rejects.toMatchObject({ code: "busy" }); releases.forEach(release => release());
  await Promise.all([first, second]); reader.readPrivateImage.mockResolvedValue(Buffer.alloc(12)); await expect(prepare()).resolves.toMatchObject({ exportEnabled: false });
});
