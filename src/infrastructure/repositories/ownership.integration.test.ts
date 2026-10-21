import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTestAuth } from "../../test/auth";
import { listingFixture } from "../../test/fixtures";
import { imagesFromNames } from "../../domain/listingImage";
import { createMarketplaceListing } from "../../domain/marketplaceListing";
import { createListingService } from "../../application/listingService";
import { ListingConflictError, ListingUnavailableError } from "../../application/listingRepository";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import * as schema from "../db/schema";

const { db, pool, auth } = createTestAuth();
const repository = new DrizzleListingRepository(db);
const service = createListingService(repository);
let a: string, b: string;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  const helpers = (await auth.$context).test;
  a = (await helpers.saveUser(helpers.createUser())).id;
  b = (await helpers.saveUser(helpers.createUser())).id;
});
afterEach(async () => {
  for (const id of [a, b]) {
    await db.delete(schema.listings).where(eq(schema.listings.ownerId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
});
afterAll(() => pool.end());

it("User B cannot list, get, update, delete or import over User A's aggregate", async () => {
  const listing = listingFixture();
  listing.images = imagesFromNames(listing.id, ["private.jpg"]);
  listing.marketplaceListings = [createMarketplaceListing(listing.id, "ebay")];
  await repository.create(a, listing);
  expect(await service.listListings(b)).toEqual([]);
  expect(await service.getListing(b, listing.id)).toBeNull();
  expect(await repository.getById(b, listing.id)).toBeNull();
  expect(await repository.getById(a, "")).toBeNull();
  for (const timestamp of [listing.updatedAt, "2000-01-01T00:00:00.000Z"]) {
    await expect(service.updateListing(b, listing.id, { ...listing, title: "Stolen guitar" }, timestamp)).rejects.toBeInstanceOf(ListingConflictError);
    await expect(repository.update(b, { ...listing, title: "Stolen guitar" }, timestamp)).rejects.toBeInstanceOf(ListingConflictError);
  }
  await expect(service.deleteListing(b, listing.id)).rejects.toBeInstanceOf(ListingUnavailableError);
  await expect(repository.delete(b, "absent-listing")).rejects.toBeInstanceOf(ListingUnavailableError);
  expect(await service.importListings(b, [{ ...listing, title: "Stolen guitar", ownerId: b }])).toEqual({ imported: 0, skipped: 1 });
  expect(await repository.getById(a, listing.id)).toEqual(listing);
  expect(await service.listListings(a)).toEqual([listing]);
  expect(await service.listListings(b)).toEqual([]);
});

it("ignores spoofed owners on create, update and import; retries never transfer ownership", async () => {
  const created = await service.createListing(a, { ...listingFixture(), ownerId: b });
  expect(await repository.getById(a, created.id)).toEqual(created);
  expect(await repository.getById(b, created.id)).toBeNull();
  const updated = await service.updateListing(a, created.id, { ...created, title: "Owner edit", ownerId: b }, created.updatedAt);
  expect(await repository.getById(a, created.id)).toEqual(updated);
  const imported = listingFixture();
  expect(await service.importListings(a, [{ ...imported, ownerId: b }])).toEqual({ imported: 1, skipped: 0 });
  expect(await service.importListings(a, [imported])).toEqual({ imported: 0, skipped: 1 });
  const rows = await db.select().from(schema.listings).where(eq(schema.listings.ownerId, a));
  expect(rows).toHaveLength(2);
  expect(await repository.list(b)).toEqual([]);
});

it("preserves optimistic concurrency for the correct owner without distinguishing foreign timestamps", async () => {
  const listing = await service.createListing(a, listingFixture());
  const updated = await service.updateListing(a, listing.id, { ...listing, title: "Current edit" }, listing.updatedAt);
  expect(updated.updatedAt).not.toBe(listing.updatedAt);
  for (const [owner, timestamp] of [[a, listing.updatedAt], [b, updated.updatedAt], [b, listing.updatedAt]]) {
    await expect(service.updateListing(owner, listing.id, listing, timestamp)).rejects.toThrow(new ListingConflictError().message);
  }
  expect(await repository.getById(a, listing.id)).toEqual(updated);
});

it("cannot attach another owner's child ID, and rolls back the attempted aggregate", async () => {
  const original = listingFixture();
  original.images = imagesFromNames(original.id, ["private.jpg"]);
  await repository.create(a, original);
  const stolen = listingFixture();
  stolen.images = [{ ...original.images[0], listingId: stolen.id }];
  await expect(service.importListings(b, [stolen])).rejects.toThrow();
  expect(await repository.list(b)).toEqual([]);
  expect(await repository.getById(a, original.id)).toEqual(original);
});

it("database requires a non-null owner with a valid foreign key", async () => {
  const listing = await service.createListing(a, listingFixture());
  await expect(pool.query("UPDATE listings SET owner_id = NULL WHERE id = $1", [listing.id])).rejects.toThrow();
  await expect(pool.query("UPDATE listings SET owner_id = 'missing-user' WHERE id = $1", [listing.id])).rejects.toThrow();
});

