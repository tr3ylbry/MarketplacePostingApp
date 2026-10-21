import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { listingFixture } from "../../test/fixtures";
import { testDatabaseUrl } from "../../test/testDatabase";
import { imagesFromNames } from "../../domain/listingImage";
import { createMarketplaceListing } from "../../domain/marketplaceListing";
import { createListingService } from "../../application/listingService";
import { ListingConflictError } from "../../application/listingRepository";

const pool = new Pool({ connectionString: testDatabaseUrl() });
const db = drizzle(pool, { schema });
const repository = new DrizzleListingRepository(db);
const service = createListingService(repository);
const ownedIds = new Set<string>();
const ownerId = crypto.randomUUID();
function fixture() {
  const listing = listingFixture({ acquisitionCost: { amount: 123.45, currency: "USD" } });
  ownedIds.add(listing.id);
  listing.images = imagesFromNames(listing.id, ["front.jpg", "rear.jpg"]);
  listing.images[0].altText = "Front of guitar";
  listing.marketplaceListings = [{
    ...createMarketplaceListing(listing.id, "ebay"), status: "published", externalListingId: "external-123",
    externalUrl: "https://example.com/item/123", priceOverride: { amount: 275.99, currency: "USD" },
    publishedAt: "2026-01-01T00:00:00.000Z", lastSyncedAt: "2026-01-02T00:00:00.000Z",
  }];
  return listing;
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await migrate(db, { migrationsFolder: "drizzle" }); // Repeat application must be safe.
  await db.insert(schema.users).values({ id: ownerId, name: "Repository test", email: `${ownerId}@example.test` });
});
afterEach(async () => {
  for (const id of ownedIds) await db.delete(schema.listings).where(eq(schema.listings.id, id));
  ownedIds.clear();
});
afterAll(async () => { await db.delete(schema.users).where(eq(schema.users.id, ownerId)); await pool.end(); });

it("round-trips Money, optional values, ordered image metadata and publication history", async () => {
  const listing = fixture();
  await repository.create(ownerId, listing);
  expect(await repository.getById(ownerId, listing.id)).toEqual(listing);
  expect((await repository.list(ownerId)).some(value => value.id === listing.id)).toBe(true);
});
it("persists service-created listings and publications with omitted optional fields", async () => {
  const created = await service.createListing(ownerId, { ...listingFixture(), acquisitionCost: undefined, shippingRate: undefined, imageNames: ["one.jpg"] });
  ownedIds.add(created.id);
  expect(await repository.getById(ownerId, created.id)).toEqual(created);
  const publication = createMarketplaceListing(created.id, "reverb");
  await repository.update(ownerId, { ...created, marketplaceListings: [publication] }, created.updatedAt);
  expect((await repository.getById(ownerId, created.id))?.marketplaceListings).toEqual([publication]);
});
it("persists edits and reordered images while preserving publication history", async () => {
  const listing = fixture();
  await repository.create(ownerId, listing);
  const updated = await service.updateListing(ownerId, listing.id, { ...listing, title: "Updated Guitar", acquisitionCost: undefined, shippingRate: undefined, imageNames: ["rear.jpg", "front.jpg"] }, listing.updatedAt);
  const stored = await repository.getById(ownerId, listing.id);
  expect(stored).toEqual(updated);
  expect(stored?.images[0].id).toBe(listing.images[1].id);
  expect(stored?.acquisitionCost).toBeUndefined();
  expect(stored?.shippingRate).toBeUndefined();
  expect(stored?.marketplaceListings).toEqual(listing.marketplaceListings);
});
it("rejects stale writes without overwriting a newer edit", async () => {
  const listing = fixture();
  await repository.create(ownerId, listing);
  const newer = { ...listing, title: "Newer Guitar", updatedAt: new Date(Date.parse(listing.updatedAt) + 10).toISOString() };
  await repository.update(ownerId, newer, listing.updatedAt);
  await expect(repository.update(ownerId, { ...listing, title: "Stale Guitar" }, listing.updatedAt)).rejects.toBeInstanceOf(ListingConflictError);
  expect((await repository.getById(ownerId, listing.id))?.title).toBe("Newer Guitar");
});
it("deletes children by foreign-key cascade and returns not found for repeated deletion", async () => {
  const listing = fixture();
  await repository.create(ownerId, listing);
  await repository.delete(ownerId, listing.id);
  await expect(repository.delete(ownerId, listing.id)).rejects.toThrow("Listing not found.");
  expect(await repository.getById(ownerId, listing.id)).toBeNull();
  expect(await db.select().from(schema.listingImages).where(eq(schema.listingImages.listingId, listing.id))).toEqual([]);
  expect(await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.listingId, listing.id))).toEqual([]);
});
it("imports atomically and skips existing IDs without overwriting them on retry", async () => {
  const listing = fixture();
  expect(await service.importListings(ownerId, [listing])).toEqual({ imported: 1, skipped: 0 });
  expect(await service.importListings(ownerId, [{ ...listing, title: "Do not overwrite" }])).toEqual({ imported: 0, skipped: 1 });
  expect(await repository.getById(ownerId, listing.id)).toEqual(listing);
});
it("rolls back a failed graph insert instead of leaving an orphan listing", async () => {
  const original = fixture();
  await repository.create(ownerId, original);
  const conflicting = fixture();
  conflicting.images[0].id = original.images[0].id;
  await expect(repository.create(ownerId, conflicting)).rejects.toThrow();
  expect(await repository.getById(ownerId, conflicting.id)).toBeNull();
  expect(await repository.getById(ownerId, original.id)).toEqual(original);
});
it("rolls back the entire import batch when a later child record conflicts", async () => {
  const existing = fixture();
  await repository.create(ownerId, existing);
  const first = fixture();
  const conflicting = fixture();
  conflicting.images[0].id = existing.images[0].id;
  await expect(service.importListings(ownerId, [first, conflicting])).rejects.toThrow();
  expect(await repository.getById(ownerId, first.id)).toBeNull();
  expect(await repository.getById(ownerId, conflicting.id)).toBeNull();
  expect(await repository.getById(ownerId, existing.id)).toEqual(existing);
});
it("rejects invalid domain input before writes and enforces database Money constraints", async () => {
  const listing = fixture();
  listing.askingPrice.amount = -1;
  await expect(repository.create(ownerId, listing)).rejects.toThrow();
  expect(await repository.getById(ownerId, listing.id)).toBeNull();
  listing.askingPrice.amount = 25;
  await repository.create(ownerId, listing);
  await expect(db.update(schema.listings).set({ askingPriceAmount: "-1" }).where(eq(schema.listings.id, listing.id))).rejects.toThrow();
  await expect(db.update(schema.listings).set({ currency: "EUR" }).where(eq(schema.listings.id, listing.id))).rejects.toThrow();
  expect((await repository.getById(ownerId, listing.id))?.askingPrice.amount).toBe(25);
});
