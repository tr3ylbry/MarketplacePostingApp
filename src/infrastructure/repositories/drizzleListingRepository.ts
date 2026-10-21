import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Listing } from "../../domain/listing";
import { ListingConflictError, type ListingRepository } from "../../application/listingRepository";
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

  private async read(id?: string): Promise<Listing[]> {
    return this.db.transaction(async tx => {
      const rows = await tx.select().from(listings).where(id ? eq(listings.id, id) : undefined)
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

  list() { return this.read(); }
  async getById(id: string) { return (await this.read(id))[0] ?? null; }

  async create(listing: Listing) {
    const { row } = listingToRows(listing);
    await this.db.transaction(async tx => {
      await tx.insert(listings).values(row);
      await insertChildren(tx, listing);
    });
    return listing;
  }

  async update(listing: Listing, expectedUpdatedAt: string) {
    const { row } = listingToRows(listing);
    await this.db.transaction(async tx => {
      const changed = await tx.update(listings).set(row)
        .where(and(eq(listings.id, listing.id), eq(listings.updatedAt, expectedUpdatedAt))).returning({ id: listings.id });
      if (!changed.length) throw new ListingConflictError();
      await tx.delete(listingImages).where(eq(listingImages.listingId, listing.id));
      await tx.delete(marketplaceListings).where(eq(marketplaceListings.listingId, listing.id));
      await insertChildren(tx, listing);
    });
    return listing;
  }

  async delete(id: string) {
    await this.db.delete(listings).where(eq(listings.id, id));
  }

  async importListings(values: Listing[]) {
    // One transaction: collisions in related records cannot leave a partial import.
    const entries = values.map(value => ({ value, row: listingToRows(value).row }));
    return this.db.transaction(async tx => {
      let imported = 0;
      for (const { value, row } of entries) {
        const added = await tx.insert(listings).values(row).onConflictDoNothing({ target: listings.id }).returning({ id: listings.id });
        if (!added.length) continue;
        await insertChildren(tx, value);
        imported += 1;
      }
      return { imported, skipped: values.length - imported };
    });
  }
}
