import { createListing } from "../domain/listing";
import { reverbAdapter } from "./reverb";

describe("reverbAdapter", () => {
  it("returns Reverb-specific posting fields", () => {
    const listing = createListing({
      isMusicalItem: true,
      brand: "Gibson",
      model: "Les Paul Studio",
      type: "Electric Guitar",
      year: "2018",
      finish: "Smokehouse Burst",
      manufacturerCountry: "USA",
      title: "Gibson Les Paul Studio",
      description: "Solid guitar with hard case and recent setup.",
      price: 999,
      category: "Guitars",
      subcategory: "Electric Guitars",
      additionalSubcategory: "Solid Body",
      condition: "Good",
      youtubeLink: "youtu.be/demo",
      purchasePrice: "850.00",
      shippingRate: "65.00",
      craigslistCity: "Phoenix",
      craigslistZipCode: "85032",
      craigslistSizeDimensions: "",
      craigslistPhoneNumber: "602-555-0199",
      craigslistContactName: "Trey",
      craigslistStreet: "",
      craigslistCrossStreet: "",
      imageNames: ["front.jpg"],
    });

    const formatted = reverbAdapter.formatListing(listing);

    expect(formatted.platform).toBe("Reverb");
    expect(formatted.fields.map((field) => field.label)).toEqual([
      "Brand",
      "Model",
      "Year",
      "Finish",
      "Manufacturer's country",
      "Category",
      "Subcategory",
      "Additional subcategory",
      "Listing title",
      "Description",
      "Link to a YouTube video",
      "Listing price",
      "What you paid for the item",
      "Shipping rate",
    ]);
    expect(formatted.photoSets[0].imageNames).toEqual(["front.jpg"]);
    expect(formatted.notes).toEqual([]);
  });
});
