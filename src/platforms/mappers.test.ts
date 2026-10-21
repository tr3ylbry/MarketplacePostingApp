import { listingFixture } from "../test/fixtures";
import { imagesFromNames } from "../domain/listingImage";
import { ebayMapper } from "./ebay";
import { reverbMapper } from "./reverb";
import { reverbRequiredErrors } from "./reverbValidation";
import { previewMappers } from "./index";

describe("marketplace validation and pure drafts", () => {
  it("keeps short eBay titles and small image sets intact", () => {
    const listing = listingFixture();
    listing.images = imagesFromNames(listing.id, ["front.jpg", "back.jpg"]);
    const draft = ebayMapper.createDraft(listing);
    expect(draft.fields.find(field => field.key === "title")?.value).toBe(listing.title);
    expect(draft.photoSets[0].imageNames).toEqual(["front.jpg", "back.jpg"]);
    expect(ebayMapper.validate(listing).warnings.some(note => /truncated|first/.test(note))).toBe(false);
  });
  it("distinguishes eBay recommendations from blocking errors", () => {
    const result = ebayMapper.validate(listingFixture({ attributes: {} }));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(3);
  });
  it("accepts a complete Reverb listing including zero-cost shipping", () => {
    expect(reverbMapper.validate(listingFixture()).errors).toEqual([]);
  });
  it.each(["brand", "model"] as const)("requires Reverb %s", field => {
    const listing = listingFixture();
    listing.attributes[field] = "  ";
    expect(reverbMapper.validate(listing).errors.join(" ").toLowerCase()).toContain(field);
  });
  it("requires an explicit category, while still providing a draft suggestion", () => {
    const listing = listingFixture({ category: "" });
    expect(reverbMapper.validate(listing).errors.join(" ")).toContain("Category is required");
    expect(reverbMapper.createDraft(listing).fields.find(field => field.key === "category")?.value).toBe("Suggested: Guitars");
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid Reverb price %s", amount => {
    const listing = listingFixture();
    listing.askingPrice.amount = amount;
    expect(reverbMapper.validate(listing).errors.join(" ")).toContain("price is required");
  });
  it("reports missing price and shipping at the marketplace boundary", () => {
    expect(reverbRequiredErrors({}).price).toContain("price is required");
    expect(reverbMapper.validate(listingFixture({ shippingRate: undefined })).errors).toContain("Shipping rate is required for Reverb.");
  });
  it.each(["title", "description"] as const)("requires Reverb %s", field => {
    const listing = listingFixture();
    listing[field] = "";
    expect(reverbMapper.validate(listing).errors).toHaveLength(1);
  });
  it("produces deterministic output without changing listings for every mapper", () => {
    const listing = listingFixture();
    const original = JSON.stringify(listing);
    for (const mapper of previewMappers) {
      expect(mapper.createDraft(listing)).toEqual(mapper.createDraft(listing));
      expect(mapper.validate(listing)).toEqual(mapper.validate(listing));
    }
    expect(JSON.stringify(listing)).toBe(original);
  });
});
