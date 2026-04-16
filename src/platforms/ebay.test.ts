import { createListing } from "../domain/listing";
import { ebayAdapter } from "./ebay";

describe("ebayAdapter", () => {
  it("truncates long titles and limits images", () => {
    const listing = createListing({
      isMusicalItem: true,
      brand: "Fender",
      model: "Stratocaster",
      type: "Electric Guitar",
      year: "",
      finish: "",
      manufacturerCountry: "",
      title:
        "Very Long Vintage Guitar Title That Should Definitely Be Trimmed Before It Reaches The eBay Limit",
      description:
        "Clean instrument with fresh strings, original case, and fully working electronics.",
      price: 1200,
      category: "instruments",
      subcategory: "",
      additionalSubcategory: "",
      condition: "good",
      youtubeLink: "",
      purchasePrice: "",
      shippingRate: "",
      craigslistCity: "Phoenix",
      craigslistZipCode: "85032",
      craigslistSizeDimensions: "",
      craigslistPhoneNumber: "602-555-0199",
      craigslistContactName: "Trey",
      craigslistStreet: "",
      craigslistCrossStreet: "",
      imageNames: Array.from({ length: 30 }, (_, index) => `photo-${index + 1}.jpg`),
    });

    const formatted = ebayAdapter.formatListing(listing);

    const titleField = formatted.fields.find((field) => field.key === "title");
    const photoSet = formatted.photoSets[0];

    expect(titleField?.value.length).toBeLessThanOrEqual(80);
    expect(photoSet.imageNames).toHaveLength(24);
    expect(formatted.notes).toContain("Title truncated to 80 characters for eBay.");
    expect(formatted.notes).toContain("Using first 24 images for eBay.");
  });
});
