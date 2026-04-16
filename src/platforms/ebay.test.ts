import { createListing } from "../domain/listing";
import { ebayAdapter } from "./ebay";

describe("ebayAdapter", () => {
  it("truncates long titles and limits images", () => {
    const listing = createListing({
      title:
        "Very Long Vintage Guitar Title That Should Definitely Be Trimmed Before It Reaches The eBay Limit",
      description:
        "Clean instrument with fresh strings, original case, and fully working electronics.",
      price: 1200,
      category: "instruments",
      condition: "good",
      imageNames: Array.from({ length: 30 }, (_, index) => `photo-${index + 1}.jpg`),
    });

    const formatted = ebayAdapter.formatListing(listing);

    expect(formatted.title.length).toBeLessThanOrEqual(80);
    expect(formatted.imageNames).toHaveLength(24);
    expect(formatted.notes).toContain("Title truncated to 80 characters for eBay.");
    expect(formatted.notes).toContain("Using first 24 images for eBay.");
  });
});
