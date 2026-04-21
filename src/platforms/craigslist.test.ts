import { createListing } from "../domain/listing";
import { craigslistAdapter } from "./craigslist";

describe("craigslistAdapter", () => {
  it("returns Craigslist-specific fields and photo caps", () => {
    const listing = createListing({
      selectedPlatforms: ["craigslist"],
      brand: "Yamaha",
      model: "P-125",
      type: "Digital Piano",
      year: "",
      finish: "",
      manufacturerCountry: "",
      ebayCategory: "",
      offerupCategory: "",
      offerupSubcategory: "",
      facebookCategory: "",
      craigslistCategory: "Musical Instruments",
      reverbCategory: "",
      reverbSubcategory: "",
      reverbAdditionalSubcategory: "",
      title: "Yamaha P-125",
      description: "Weighted keyboard with stand and pedal included.",
      price: 450,
      condition: "Good",
      youtubeLink: "",
      purchasePrice: "",
      shippingRate: "",
      craigslistCity: "Tempe",
      craigslistZipCode: "85281",
      craigslistSizeDimensions: "52 x 12 x 6",
      craigslistPhoneNumber: "602-555-0100",
      craigslistContactName: "Trey",
      craigslistStreet: "University Dr",
      craigslistCrossStreet: "Rural Rd",
      imageNames: Array.from({ length: 26 }, (_, index) => `photo-${index + 1}.jpg`),
    });

    const formatted = craigslistAdapter.formatListing(listing);

    expect(formatted.platform).toBe("Craigslist");
    expect(formatted.photoSets[0].imageNames).toHaveLength(24);
    expect(formatted.fields.map((field) => field.label)).toEqual([
      "Category (Craigslist)",
      "Posting title",
      "Price",
      "City (Craigslist)",
      "Zip code (Craigslist)",
      "Description",
      "Make / manufacturer (Craigslist)",
      "Model name / number",
      "Size / dimensions (Craigslist)",
      "Condition",
      "Phone number (Craigslist)",
      "Contact name (Craigslist)",
      "Street (Craigslist)",
      "Cross street (Craigslist)",
    ]);
  });
});
