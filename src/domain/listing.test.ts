import { createListing, validateListingInput } from "./listing";

describe("listing domain", () => {
  it("creates a normalized draft listing", () => {
    const listing = createListing({
      selectedPlatforms: ["ebay", "craigslist", "reverb"],
      brand: "  Roland  ",
      model: "  SP-404 MKII  ",
      type: "  Sampler  ",
      year: "  2022  ",
      finish: "  Black  ",
      manufacturerCountry: "  Japan  ",
      ebayCategory: "  instruments  ",
      offerupCategory: "",
      offerupSubcategory: "",
      facebookCategory: "",
      craigslistCategory: "  instruments  ",
      reverbCategory: "  instruments  ",
      reverbSubcategory: "  Samplers  ",
      reverbAdditionalSubcategory: "  Grooveboxes  ",
      title: "  Roland SP-404 MKII  ",
      description:
        "  Excellent condition sampler with power supply and original box included.  ",
      price: 399,
      condition: "  like-new  ",
      youtubeLink: "  youtu.be/demo  ",
      purchasePrice: "  350.00  ",
      shippingRate: "  25.00  ",
      craigslistCity: "  Phoenix  ",
      craigslistZipCode: "  85032  ",
      craigslistSizeDimensions: "  12 x 9 x 3  ",
      craigslistPhoneNumber: "  602-555-0199  ",
      craigslistContactName: "  Trey  ",
      craigslistStreet: "  Greenway  ",
      craigslistCrossStreet: "  32nd  ",
      imageNames: ["front.jpg", "rear.jpg"],
    });

    expect(listing.selectedPlatforms).toEqual(["ebay", "craigslist", "reverb"]);
    expect(listing.brand).toBe("Roland");
    expect(listing.model).toBe("SP-404 MKII");
    expect(listing.type).toBe("Sampler");
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
        selectedPlatforms: ["craigslist"],
        brand: "This field is definitely more than thirty five chars",
        model: "",
        type: "",
        year: "",
        finish: "",
        manufacturerCountry: "",
        ebayCategory: "",
        offerupCategory: "",
        offerupSubcategory: "",
        facebookCategory: "",
        craigslistCategory: "",
        reverbCategory: "",
        reverbSubcategory: "",
        reverbAdditionalSubcategory: "",
        title: "TV",
        description: "Too short",
        price: 0,
        condition: "fair",
        youtubeLink: "",
        purchasePrice: "",
        shippingRate: "",
        craigslistCity: "",
        craigslistZipCode: "",
        craigslistSizeDimensions: "",
        craigslistPhoneNumber: "",
        craigslistContactName: "",
        craigslistStreet: "",
        craigslistCrossStreet: "",
        imageNames: [],
      }),
    ).toEqual([
      "Title must be at least 4 characters.",
      "Description must be at least 20 characters.",
      "Price must be greater than 0.",
      "Category (Craigslist) is required.",
      "City (Craigslist) is required.",
      "Zip code (Craigslist) is required.",
      "Phone number (Craigslist) is required.",
      "Contact name (Craigslist) is required.",
      "Brand / Make must be 35 characters or fewer.",
    ]);
  });
});
