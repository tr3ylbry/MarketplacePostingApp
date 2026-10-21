import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { testDatabaseUrl } from "../../test/testDatabase";
import { listingFixture } from "../../test/fixtures";
import { LEGACY_OWNER_ID } from "../../application/owner";
import { claimLegacyListings } from "../repositories/claimLegacyListings";
import { DrizzleListingRepository } from "../repositories/drizzleListingRepository";
import * as schema from "./schema";

it("preserves pre-auth aggregates under a non-login holder until an explicit, idempotent offline claim", async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  const client = await pool.connect();
  // Generated identifier, never input. All migration/claim effects stay in this schema.
  const isolated = `migration_${crypto.randomUUID().replace(/-/g, "")}`;
  try {
    await client.query(`CREATE SCHEMA "${isolated}"`);
    await client.query(`SET search_path TO "${isolated}"`);
    const migration = async (file: string) => client.query(
      (await readFile(`drizzle/${file}`, "utf8")).replace(/"public"\./g, `"${isolated}".`),
    );
    await migration("0000_grey_earthquake.sql");
    await client.query(`INSERT INTO listings
      (id,title,description,asking_price_amount,currency,condition,category,status,attributes,marketplace_details,selected_platforms,created_at,updated_at)
      VALUES ('legacy-item','Old guitar','Still valuable',250,'USD','good','Guitars','draft','{}','{}','{ebay}','2025-01-01','2025-01-01')`);
    await client.query(`INSERT INTO listing_images (id,listing_id,source,sort_order)
      VALUES ('legacy-image','legacy-item','{"kind":"filename","name":"old.jpg"}',0)`);
    await client.query(`INSERT INTO marketplace_listings (id,listing_id,marketplace,status,external_listing_id)
      VALUES ('legacy-publication','legacy-item','ebay','published','external-123')`);
    const before = (await client.query("SELECT * FROM listings")).rows[0];
    const images = (await client.query("SELECT * FROM listing_images")).rows;
    const publications = (await client.query("SELECT * FROM marketplace_listings")).rows;
    await migration("0001_famous_harrier.sql");
    expect((await client.query("SELECT * FROM listings")).rows).toEqual([{ ...before, owner_id: LEGACY_OWNER_ID }]);
    expect((await client.query("SELECT * FROM listing_images")).rows).toEqual(images);
    expect((await client.query("SELECT * FROM marketplace_listings")).rows).toEqual(publications);
    const db = drizzle(client, { schema });
    const repository = new DrizzleListingRepository(db);
    await expect(db.insert(schema.sessions).values({ id: crypto.randomUUID(), userId: LEGACY_OWNER_ID, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 10000) })).rejects.toThrow();
    await expect(db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId: LEGACY_OWNER_ID, accountId: "holder", providerId: "github" })).rejects.toThrow();
    await expect(repository.list(LEGACY_OWNER_ID)).rejects.toThrow();
    const owner = crypto.randomUUID(), other = crypto.randomUUID();
    await db.insert(schema.users).values([
      { id: owner, name: "Owner", email: "owner@example.invalid" },
      { id: other, name: "Other", email: "other@example.invalid" },
    ]);
    expect(await repository.list(owner)).toEqual([]);
    await expect(claimLegacyListings(db, owner)).rejects.toThrow("GitHub-authenticated");
    await expect(claimLegacyListings(db, LEGACY_OWNER_ID)).rejects.toThrow();
    await db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId: owner, providerId: "github", accountId: "123" });
    const owned = await repository.create(other, listingFixture());
    expect(await claimLegacyListings(db, owner)).toBe(1);
    expect(await claimLegacyListings(db, owner)).toBe(0);
    expect((await db.select().from(schema.listings).where(eq(schema.listings.id, "legacy-item")))[0].ownerId).toBe(owner);
    expect(await repository.getById(other, owned.id)).toEqual(owned);
    expect(await repository.getById(other, "legacy-item")).toBeNull();
    expect((await client.query("SELECT * FROM listing_images")).rows).toEqual(images);
    expect((await client.query("SELECT * FROM marketplace_listings")).rows).toEqual(publications);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
    client.release();
    await pool.end();
  }
});
