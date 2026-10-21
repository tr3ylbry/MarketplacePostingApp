import { createListing, listingSchema, updateListing } from "./listing";
import { createMoney, moneySchema } from "./money";
import { imagesFromNames, imageNames } from "./listingImage";
import { createMarketplaceListing, marketplaceListingSchema } from "./marketplaceListing";
import { listingFixture } from "../test/fixtures";
import { toFormInput, updateListingFromForm } from "../features/listings/listingFormMapping";

describe("V2 domain boundaries", () => {
  it("normalizes canonical text and defaults optional attributes and lifecycle", () => {
    const listing = createListing({ title: "  Guitar  ", description: "  A working guitar with its original case.  ", askingPrice: createMoney(12.5) });
    expect(listing.title).toBe("Guitar");
    expect(listing.description).toBe("A working guitar with its original case.");
    expect(listing.status).toBe("draft");
    expect(listing.attributes.brand).toBe("");
    expect(listing.acquisitionCost).toBeUndefined();
    expect(listing.images).toEqual([]);
    expect(listing.marketplaceListings).toEqual([]);
    expect(listing.updatedAt).toBe(listing.createdAt);
    expect(Number.isNaN(Date.parse(listing.createdAt))).toBe(false);
  });
  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid Money %s", amount => {
    expect(() => createMoney(amount)).toThrow();
  });
  it("accepts free shipping and rejects non-USD or string amounts", () => {
    expect(createMoney(0)).toEqual({ amount: 0, currency: "USD" });
    expect(moneySchema.safeParse({ amount: 10, currency: "EUR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: "10", currency: "USD" }).success).toBe(false);
  });
  it.each([0, -10, NaN, Infinity])("rejects an invalid asking price %s", amount => {
    expect(() => listingFixture({ askingPrice: { amount, currency: "USD" } })).toThrow();
  });
  it("normalizes optional attributes and deduplicates selected marketplaces", () => {
    const listing = listingFixture({ attributes: { brand: " Fender ", year: " 2020 " }, selectedPlatforms: ["ebay", "ebay"] });
    expect(listing.attributes.brand).toBe("Fender");
    expect(listing.attributes.year).toBe("2020");
    expect(listing.selectedPlatforms).toEqual(["ebay"]);
  });
  it("models ordered filename references without mutating the source array", () => {
    const images = imagesFromNames("listing", ["front.jpg", "back.jpg"]);
    const reversed = [...images].reverse();
    expect(imageNames(reversed)).toEqual(["front.jpg", "back.jpg"]);
    expect(reversed[0].order).toBe(1);
    expect(images[0].listingId).toBe("listing");
    expect(images[0].id).not.toBe(images[1].id);
  });
  it("preserves identity, publication state and media identities on edits", () => {
    const listing = listingFixture();
    listing.images = imagesFromNames(listing.id, ["front.jpg", "back.jpg"]);
    listing.marketplaceListings = [{ ...createMarketplaceListing(listing.id, "ebay"), status: "published" }];
    const updated = updateListingFromForm(listing, { ...toFormInput(listing), title: "Updated Guitar", imageNames: ["back.jpg", "front.jpg"] });
    expect(updated.id).toBe(listing.id);
    expect(updated.createdAt).toBe(listing.createdAt);
    expect(updated.marketplaceListings).toEqual(listing.marketplaceListings);
    expect(updated.images[0].id).toBe(listing.images[1].id);
    expect(updated.images[0].order).toBe(0);
    expect(listing.title).toBe("Fender Guitar");
    expect(updateListing(listing, { ...listing, title: "Another Guitar" }).status).toBe("draft");
  });
  it("creates a draft publication independently of the canonical lifecycle", () => {
    const publication = createMarketplaceListing("item", "reverb");
    expect(publication.status).toBe("draft");
    expect(publication.externalListingId).toBeUndefined();
    for (const status of ["draft", "ready", "published", "sold", "error", "needs-renewal"]) {
      expect(marketplaceListingSchema.safeParse({ ...publication, status }).success).toBe(true);
    }
    expect(marketplaceListingSchema.safeParse({ ...publication, status: "invented" }).success).toBe(false);
  });
  it("rejects inconsistent related records and duplicate image order", () => {
    const listing = listingFixture();
    expect(listingSchema.safeParse({ ...listing, images: imagesFromNames("other", ["x.jpg"]) }).success).toBe(false);
    const images = imagesFromNames(listing.id, ["a.jpg", "b.jpg"]).map(image => ({ ...image, order: 0 }));
    expect(listingSchema.safeParse({ ...listing, images }).success).toBe(false);
  });
});
