import { createListing, validateListingInput } from "./listing";

describe("listing domain", () => {
  it("creates a normalized draft listing", () => {
    const listing = createListing({
      brand: "  Roland  ",
      model: "  SP-404 MKII  ",
      year: "  2022  ",
      finish: "  Black  ",
      manufacturerCountry: "  Japan  ",
      category: "  instruments  ",
      subcategory: "  Samplers  ",
      additionalSubcategory: "  Grooveboxes  ",
      title: "  Roland SP-404 MKII  ",
      description:
        "  Excellent condition sampler with power supply and original box included.  ",
      price: 399,
      condition: "  like-new  ",
      youtubeLink: "  youtu.be/demo  ",
      purchasePrice: "  350.00  ",
      shippingRate: "  25.00  ",
      imageNames: ["front.jpg", "rear.jpg"],
    });

    expect(listing.brand).toBe("Roland");
    expect(listing.model).toBe("SP-404 MKII");
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
        brand: "This field is definitely more than thirty five chars",
        model: "",
        year: "",
        finish: "",
        manufacturerCountry: "",
        title: "TV",
        description: "Too short",
        price: 0,
        category: "electronics",
        subcategory: "",
        additionalSubcategory: "",
        condition: "fair",
        youtubeLink: "",
        purchasePrice: "",
        shippingRate: "",
        imageNames: [],
      }),
    ).toEqual([
      "Title must be at least 4 characters.",
      "Description must be at least 20 characters.",
      "Price must be greater than 0.",
      "Brand must be 35 characters or fewer.",
    ]);
  });
});
