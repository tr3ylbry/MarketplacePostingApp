import { createListing, validateListingInput } from "./listing";

describe("listing domain", () => {
  it("creates a normalized draft listing", () => {
    const listing = createListing({
      title: "  Roland SP-404 MKII  ",
      description:
        "  Excellent condition sampler with power supply and original box included.  ",
      price: 399,
      category: "instruments",
      condition: "like-new",
      imageNames: ["front.jpg", "rear.jpg"],
    });

    expect(listing.title).toBe("Roland SP-404 MKII");
    expect(listing.description).toBe(
      "Excellent condition sampler with power supply and original box included.",
    );
    expect(listing.status).toBe("draft");
    expect(listing.postingRecords).toEqual([]);
  });

  it("returns validation errors for incomplete input", () => {
    expect(
      validateListingInput({
        title: "TV",
        description: "Too short",
        price: 0,
        category: "electronics",
        condition: "fair",
        imageNames: [],
      }),
    ).toEqual([
      "Title must be at least 4 characters.",
      "Description must be at least 20 characters.",
      "Price must be greater than 0.",
    ]);
  });
});
