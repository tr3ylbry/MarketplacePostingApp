import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Listing } from "../../domain/listing";
import { ListingConflictError, ListingUnavailableError, type ListingRepository } from "../../application/listingRepository";
import { ownerIdSchema, type OwnerId } from "../../application/owner";
import * as schema from "../db/schema";
import { listingFromRows, listingToRows } from "./listingMapping";
import { immediateCleanupPaths, lockOwnedListing, queueCleanup } from "./drizzleImageRepository";
import { INVENTORY_PAGE_SIZE, inventoryQuerySchema, type InventoryPage, type InventoryQuery } from "../../application/inventory";
import { moneySchema } from "../../domain/money";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const { listings, listingImages, marketplaceListings } = schema;

async function insertChildren(tx: Transaction, value: Listing) {
  if (value.images.some(image => image.source.kind !== "filename")) throw new Error("Stored images must be finalized through the image boundary.");
  const { images, publications } = listingToRows(value);
  if (images.length) await tx.insert(listingImages).values(images);
  if (publications.length) await tx.insert(marketplaceListings).values(publications);
}

export class DrizzleListingRepository implements ListingRepository {
  constructor(private readonly db: Database) {}

  private async read(ownerId: OwnerId, id?: string): Promise<Listing[]> {
    ownerIdSchema.parse(ownerId);
    return this.db.transaction(async tx => {
      const rows = await tx.select().from(listings).where(and(eq(listings.ownerId, ownerId), id !== undefined ? eq(listings.id, id) : undefined))
        .orderBy(desc(listings.createdAt), asc(listings.id));
      if (!rows.length) return [];
      const ids = rows.map(row => row.id);
      const [images, publications] = await Promise.all([
        tx.select().from(listingImages).where(inArray(listingImages.listingId, ids)),
        tx.select().from(marketplaceListings).where(inArray(marketplaceListings.listingId, ids)).orderBy(asc(marketplaceListings.id)),
      ]);
      return rows.map(row => listingFromRows(row, images.filter(image => image.listingId === row.id), publications.filter(publication => publication.listingId === row.id)));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  list(ownerId: OwnerId) { return this.read(ownerId); }
  async getById(ownerId: OwnerId, id: string) { return (await this.read(ownerId, id))[0] ?? null; }

  async listInventory(ownerId: OwnerId, input: InventoryQuery): Promise<InventoryPage> {
    ownerIdSchema.parse(ownerId);
    const { query, page: requestedPage } = inventoryQuerySchema.parse(input);
    // Explicit ! escaping makes %, _ and ! literal; backslash is ordinary text.
    const pattern = `%${query.replace(/[!%_]/g, "!$&")}%`;
    const predicate = and(eq(listings.ownerId, ownerId), query ? sql`${listings.title} ilike ${pattern} escape '!'` : undefined);
    return this.db.transaction(async tx => {
      const [{ total }] = await tx.select({ total: count() }).from(listings).where(predicate);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error("Inventory count is unsupported.");
      const totalPages = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
      const page = Math.min(requestedPage, totalPages);
      // OFFSET is derived only after the matching count clamps the validated request.
      const rows = await tx.select({
        id: listings.id, title: listings.title, askingPriceAmount: listings.askingPriceAmount, currency: listings.currency,
        status: listings.status, condition: listings.condition, createdAt: listings.createdAt,
        categoryLabel: sql<string>`coalesce(nullif(${listings.marketplaceDetails}->>'ebayCategory', ''),
          nullif(${listings.marketplaceDetails}->>'offerupCategory', ''), nullif(${listings.marketplaceDetails}->>'facebookCategory', ''),
          nullif(${listings.marketplaceDetails}->>'craigslistCategory', ''), nullif(${listings.marketplaceDetails}->>'reverbCategory', ''), 'No Category')`,
      }).from(listings).where(predicate).orderBy(desc(listings.createdAt), asc(listings.id))
        .limit(INVENTORY_PAGE_SIZE).offset((page - 1) * INVENTORY_PAGE_SIZE);
      return { items: rows.map(row => ({ id: row.id, title: row.title,
        askingPrice: moneySchema.parse({ amount: Number(row.askingPriceAmount), currency: row.currency }),
        status: row.status, condition: row.condition, createdAt: new Date(row.createdAt).toISOString(), categoryLabel: row.categoryLabel,
      })), query, page, pageSize: INVENTORY_PAGE_SIZE, totalPages, matchingCount: total };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async create(ownerId: OwnerId, listing: Listing) {
    ownerIdSchema.parse(ownerId);
    const { row } = listingToRows(listing);
    await this.db.transaction(async tx => {
      await tx.insert(listings).values({ ...row, ownerId });
      await insertChildren(tx, listing);
    });
    return listing;
  }

  async update(ownerId: OwnerId, listing: Listing, expectedUpdatedAt: string) {
    ownerIdSchema.parse(ownerId);
    const { row } = listingToRows(listing);
    await this.db.transaction(async tx => {
      const changed = await tx.update(listings).set(row)
        .where(and(eq(listings.ownerId, ownerId), eq(listings.id, listing.id), eq(listings.updatedAt, expectedUpdatedAt))).returning({ id: listings.id });
      if (!changed.length) throw new ListingConflictError();
      await tx.delete(marketplaceListings).where(eq(marketplaceListings.listingId, listing.id));
      const { publications } = listingToRows(listing);
      if (publications.length) await tx.insert(marketplaceListings).values(publications);
    });
    return listing;
  }

  async delete(ownerId: OwnerId, id: string) {
    ownerIdSchema.parse(ownerId);
    return this.db.transaction(async tx => {
      await lockOwnedListing(tx, ownerId, id);
      const images = await tx.select({ pathname: listingImages.pathname, providerRetainUntil: listingImages.providerRetainUntil }).from(listingImages).where(eq(listingImages.listingId, id));
      const pending = await tx.select({ pathname: schema.imageUploads.pathname }).from(schema.imageUploads).where(eq(schema.imageUploads.listingId, id));
      const paths = [...images, ...pending.map(image => ({ ...image, providerRetainUntil: null }))]
        .flatMap(image => image.pathname ? [{ pathname: image.pathname, providerRetainUntil: image.providerRetainUntil }] : []);
      await queueCleanup(tx, paths);
      const deleted = await tx.delete(listings).where(and(eq(listings.ownerId, ownerId), eq(listings.id, id))).returning({ id: listings.id });
      if (!deleted.length) throw new ListingUnavailableError();
      return immediateCleanupPaths(paths);
    });
  }

  async importListings(ownerId: OwnerId, values: Listing[]) {
    ownerIdSchema.parse(ownerId);
    // One transaction: collisions in related records cannot leave a partial import.
    const entries = values.map(value => ({ value, row: listingToRows(value).row }));
    return this.db.transaction(async tx => {
      let imported = 0;
      for (const { value, row } of entries) {
        const added = await tx.insert(listings).values({ ...row, ownerId }).onConflictDoNothing({ target: listings.id }).returning({ id: listings.id });
        if (!added.length) continue;
        await insertChildren(tx, value);
        imported += 1;
      }
      return { imported, skipped: values.length - imported };
    });
  }
}
