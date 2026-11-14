import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, inArray } from "drizzle-orm";
import { createTestAuth } from "../../test/auth";
import { listingFixture } from "../../test/fixtures";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { listingToRows } from "./listingMapping";
import * as schema from "../db/schema";

const { pool, db } = createTestAuth();
const statements: { query: string; params: unknown[] }[] = [];
const repository = new DrizzleListingRepository(drizzle(pool, { schema, logger: { logQuery(query, params) { statements.push({ query, params }); } } }));
let owner: string, other: string;
beforeAll(() => migrate(db, { migrationsFolder: "drizzle" }));
beforeEach(async () => {
  owner = crypto.randomUUID(); other = crypto.randomUUID();
  await db.insert(schema.users).values([owner, other].map(id => ({ id, name: "Inventory test", email: `${id}@example.test` })));
  statements.length = 0;
});
afterEach(async () => {
  await db.delete(schema.listings).where(inArray(schema.listings.ownerId, [owner, other]));
  await db.delete(schema.users).where(inArray(schema.users.id, [owner, other]));
});
afterAll(() => pool.end());

async function seed(ownerId: string, titles: string[]) {
  const values = titles.map((title, index) => ({ ...listingFixture({ title }), id: `${ownerId}-${String(index).padStart(4, "0")}`,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
  if (values.length) await db.insert(schema.listings).values(values.map(value => ({ ...listingToRows(value).row, ownerId })));
  return values;
}

it("returns a valid empty page for empty inventory and unmatched searches", async () => {
  expect(await repository.listInventory(owner, { query: "", page: 9 })).toEqual({ items: [], query: "", page: 1, pageSize: 25, totalPages: 1, matchingCount: 0 });
  await seed(owner, ["Existing guitar"]);
  expect(await repository.listInventory(owner, { query: "absent", page: 2 })).toMatchObject({ items: [], query: "absent", matchingCount: 0, page: 1 });
});

const literalTitles = ["Fender Case Guitar", "Other fEnDeR amplifier", "100%_literal\\path ! plus O'Reilly", "100XYliteralZpath plain", "東京 🎸 Café", "Literal \\% token"];
it.each(["fENDER", "%", "_", "\\", "!", "O'Reilly", "東京 🎸", "CAFÉ", "\\%", "%' OR true --"])("matches the literal case-insensitive title substring %s", async query => {
  await seed(owner, literalTitles);
  await seed(other, [...literalTitles, "Private other-owner guitar"]);
  const result = await repository.listInventory(owner, { query: ` ${query} `, page: 1 });
  const expected = literalTitles.filter(title => title.toLowerCase().includes(query.toLowerCase()));
  expect(result.items.map(item => item.title).sort()).toEqual(expected.sort());
  expect(result.matchingCount).toBe(expected.length);
  expect(result.query).toBe(query);
});

it("limits pages to 25 and preserves created-desc/id-asc tie ordering", async () => {
  const values = await seed(owner, Array.from({ length: 52 }, (_, index) => `Inventory ${index}`));
  const newest = { ...listingFixture({ title: "Newest guitar" }), createdAt: "2026-02-01T00:00:00.000Z" };
  const oldest = { ...listingFixture({ title: "Oldest guitar" }), createdAt: "2025-01-01T00:00:00.000Z" };
  for (const value of [newest, oldest]) await repository.create(owner, value);
  const expected = [newest, ...values, oldest].map(value => value.id);
  const pages = await Promise.all([1, 2, 3].map(page => repository.listInventory(owner, { query: "", page })));
  expect(pages.map(page => page.items.length)).toEqual([25, 25, 4]);
  expect(pages.flatMap(page => page.items.map(item => item.id))).toEqual(expected);
  expect(pages.map(page => [page.matchingCount, page.totalPages])).toEqual([[54, 3], [54, 3], [54, 3]]);
});

it("clamps a huge safe page against the count before creating a bounded OFFSET", async () => {
  await seed(owner, Array.from({ length: 26 }, (_, index) => `Inventory ${index}`));
  statements.length = 0;
  const result = await repository.listInventory(owner, { query: "", page: Number.MAX_SAFE_INTEGER });
  expect(result).toMatchObject({ page: 2, totalPages: 2, matchingCount: 26 });
  expect(result.items).toHaveLength(1);
  const rows = statements.find(statement => statement.query.startsWith("select") && statement.query.includes("limit"))!;
  expect(rows.params).toContain(25);
  expect(rows.params).not.toContain(Number.MAX_SAFE_INTEGER);
  expect(statements.some(statement => statement.query.includes("isolation level repeatable read read only"))).toBe(true);
});

it("applies identical owner/search predicates to count and page with no child hydration", async () => {
  const [listing] = await seed(owner, ["Owned matching guitar"]);
  await seed(other, ["Foreign matching guitar", "Foreign matching amplifier"]);
  const imageId = crypto.randomUUID();
  await db.insert(schema.listingImages).values({ id: imageId, listingId: listing.id, storageProvider: "vercel-blob",
    pathname: `images/${imageId}/private-fixture.png`, originalFilename: "private-fixture.png", contentType: "image/png", byteSize: 1,
    uploadedAt: "2026-01-01T00:00:00.000Z", order: 0 });
  await db.insert(schema.marketplaceListings).values({ id: crypto.randomUUID(), listingId: listing.id, marketplace: "reverb", status: "draft", externalListingId: "private-publication-fixture" });
  statements.length = 0;
  const result = await repository.listInventory(owner, { query: "matching", page: 1 });
  expect(result.matchingCount).toBe(1); expect(result.items.map(item => item.id)).toEqual([listing.id]);
  expect(Object.keys(result.items[0]).sort()).toEqual(["id", "title", "askingPrice", "status", "condition", "createdAt", "categoryLabel"].sort());
  const selects = statements.filter(statement => statement.query.startsWith("select"));
  expect(selects).toHaveLength(2);
  for (const statement of selects) {
    expect(statement.params.slice(0, 2)).toEqual([owner, "%matching%"]);
    expect(statement.query).not.toMatch(/listing_images|marketplace_listings|description|pathname|credentials/);
    expect(statement.query).not.toContain("select *");
  }
  expect(JSON.stringify(result)).not.toMatch(/private-fixture|private-publication|images|marketplaceListings|ownerId/);
  const full = await repository.getById(owner, listing.id);
  expect(full?.images[0].source.kind).toBe("vercel-blob");
  expect(full?.marketplaceListings[0].externalListingId).toBe("private-publication-fixture");
  expect(await repository.getById(other, listing.id)).toBeNull();
});

it("preserves the existing marketplace-category precedence and No Category fallback", async () => {
  const details = [
    { ebayCategory: "eBay first", offerupCategory: "OfferUp later" }, { offerupCategory: "OfferUp first", facebookCategory: "Facebook later" },
    { facebookCategory: "Facebook first", craigslistCategory: "Craigslist later" }, { craigslistCategory: "Craigslist first", reverbCategory: "Reverb later" },
    { reverbCategory: "Reverb first" }, {},
  ];
  for (const [index, marketplaceDetails] of details.entries()) await repository.create(owner, listingFixture({ title: `Category fixture ${index}`, category: "Canonical is not the card fallback", marketplaceDetails }));
  const result = await repository.listInventory(owner, { query: "", page: 1 });
  const categories = [...result.items].sort((a, b) => a.title.localeCompare(b.title)).map(item => item.categoryLabel);
  expect(categories).toEqual(["eBay first", "OfferUp first", "Facebook first", "Craigslist first", "Reverb first", "No Category"]);
});

it("keeps row and count owner isolation at page boundaries", async () => {
  await seed(owner, Array.from({ length: 26 }, (_, index) => `Matching guitar ${index}`));
  await seed(other, Array.from({ length: 60 }, (_, index) => `Matching guitar other ${index}`));
  expect(await repository.listInventory(owner, { query: "matching", page: 2 })).toMatchObject({ matchingCount: 26, totalPages: 2, items: [expect.objectContaining({ title: "Matching guitar 25" })] });
  expect(await repository.listInventory(other, { query: "matching", page: 3 })).toMatchObject({ matchingCount: 60, totalPages: 3 });
});

it("rejects invalid application input before SQL", async () => {
  for (const input of [{ query: "x".repeat(101), page: 1 }, { query: "bad\u0000text", page: 1 }, { query: "", page: 0 }, { query: "", page: Number.MAX_SAFE_INTEGER + 1 }]) {
    await expect(repository.listInventory(owner, input)).rejects.toThrow();
  }
  await expect(repository.listInventory("legacy-unclaimed", { query: "", page: 1 })).rejects.toThrow();
  expect(statements).toEqual([]);
});

it("uses one repeatable-read snapshot when a matching row is deleted after the count", async () => {
  const values = await seed(owner, Array.from({ length: 26 }, (_, index) => `Snapshot guitar ${index}`));
  const client = await pool.connect();
  const original = client.query.bind(client);
  let deleted = false;
  const spy = vi.spyOn(client, "query").mockImplementation((async (...args: unknown[]) => {
    const result = await Reflect.apply(original, client, args);
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text;
    if (!deleted && text.startsWith("select count(")) {
      deleted = true;
      await db.delete(schema.listings).where(eq(schema.listings.id, values[25].id));
    }
    return result;
  }) as typeof client.query);
  try {
    const snapshot = await new DrizzleListingRepository(drizzle(client, { schema })).listInventory(owner, { query: "Snapshot", page: 2 });
    expect(deleted).toBe(true);
    expect(snapshot).toMatchObject({ matchingCount: 26, page: 2, items: [expect.objectContaining({ id: values[25].id })] });
  } finally { spy.mockRestore(); client.release(); }
  const fresh = await repository.listInventory(owner, { query: "Snapshot", page: 2 });
  expect(fresh).toMatchObject({ matchingCount: 25, page: 1 });
  expect(fresh.items).toHaveLength(25);
});
