import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Listing } from "../../domain/listing";
import { ListingConflictError, ListingUnavailableError, type ListingRepository } from "../../application/listingRepository";
import { ownerIdSchema, type OwnerId } from "../../application/owner";
import * as schema from "../db/schema";
import { listingFromRows, listingToRows } from "./listingMapping";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const { listings, listingImages, marketplaceListings } = schema;

async function insertChildren(tx: Transaction, value: Listing) {
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
      await tx.delete(listingImages).where(eq(listingImages.listingId, listing.id));
      await tx.delete(marketplaceListings).where(eq(marketplaceListings.listingId, listing.id));
      await insertChildren(tx, listing);
    });
    return listing;
  }

  async delete(ownerId: OwnerId, id: string) {
    ownerIdSchema.parse(ownerId);
    const deleted = await this.db.delete(listings).where(and(eq(listings.ownerId, ownerId), eq(listings.id, id))).returning({ id: listings.id });
    if (!deleted.length) throw new ListingUnavailableError();
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
