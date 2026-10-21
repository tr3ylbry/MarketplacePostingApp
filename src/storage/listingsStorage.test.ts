import { loadListings, saveListings, STORAGE_KEY, LEGACY_STORAGE_KEY } from "./listingsStorage";
import { migrateListing } from "./migrateListing";
import { listingFixture } from "../test/fixtures";
import { toFormInput } from "../features/listings/listingFormMapping";

function legacyFixture() {
  const listing = listingFixture();
  return { ...toFormInput(listing), id: "old-id", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", status: "draft", postingRecords: [] };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("validated local persistence", () => {
  it("round-trips a V2 envelope", () => {
    const listing = listingFixture();
    expect(saveListings([listing])).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(2);
    expect(loadListings()).toEqual([listing]);
  });
  it.each(["{", "null", "{}", '{"version":99,"listings":[]}', '{"version":2,"listings":[{}]}'])("recovers safely from %s without changing stored bytes", raw => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadListings()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it("recovers valid records independently and backs up rejected data before a write", () => {
    const listing = listingFixture();
    const raw = JSON.stringify({ version: 2, listings: [listing, { ...listing, askingPrice: { amount: "free", currency: "USD" } }] });
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadListings()).toEqual([listing]);
    expect(saveListings([listing])).toBe(true);
    expect(localStorage.getItem(`${STORAGE_KEY}:recovery`)).toBe(raw);
  });
  it("handles blocked storage and quota failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadListings()).toEqual([]);
    expect(saveListings([listingFixture()])).toBe(false);
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(saveListings([listingFixture()])).toBe(false);
  });
  it("does not write invalid canonical data", () => {
    const listing = listingFixture();
    listing.askingPrice.amount = -1;
    expect(saveListings([listing])).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it("migrates V1 money, attributes, ordered filenames, timestamps and publications", () => {
    const old = { ...legacyFixture(), imageNames: ["front.jpg", "rear.jpg"], purchasePrice: "150.25", status: "needs-renewal", postingRecords: [{ platform: "eBay", url: "https://ebay.com/item/1", datePosted: "2026-01-01T00:00:00.000Z" }] };
    const migrated = migrateListing(old)!;
    expect(migrated.id).toBe("old-id");
    expect(migrated.createdAt).toBe(old.createdAt);
    expect(migrated.updatedAt).toBe(old.updatedAt);
    expect(migrated.askingPrice.amount).toBe(old.price);
    expect(migrated.acquisitionCost?.amount).toBe(150.25);
    expect(migrated.attributes.brand).toBe("Fender");
    expect(migrated.images.map(image => image.source.name)).toEqual(old.imageNames);
    expect(migrated.images.map(image => image.order)).toEqual([0, 1]);
    expect(migrated.status).toBe("active");
    expect(migrated.marketplaceListings[0]).toMatchObject({ listingId: old.id, marketplace: "ebay", status: "needs-renewal", externalUrl: old.postingRecords[0].url });
    expect(migrateListing(old)).toEqual(migrated);
  });
  it("preserves the original V1 key after saving migrated listings and respects empty V2", () => {
    const raw = JSON.stringify([legacyFixture()]);
    localStorage.setItem(LEGACY_STORAGE_KEY, raw);
    expect(loadListings()).toHaveLength(1);
    expect(saveListings(loadListings())).toBe(true);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
    saveListings([]);
    expect(loadListings()).toEqual([]);
  });
  it("supports older category/platform aliases without accepting arbitrary objects", () => {
    const old = { ...legacyFixture(), selectedPlatforms: undefined, isMusicalItem: false, category: "Instruments", subcategory: "Guitars" };
    expect(migrateListing(old)?.selectedPlatforms).not.toContain("reverb");
    expect(migrateListing(old)?.marketplaceDetails.craigslistCategory).toBe("Instruments");
    expect(migrateListing({})).toBeNull();
    expect(migrateListing({ ...old, price: -1 })).toBeNull();
  });
});
