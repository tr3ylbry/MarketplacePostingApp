import { createListing } from "../domain/listing";
import { reverbAdapter } from "./reverb";

describe("reverbAdapter", () => {
  it("returns Reverb-specific posting fields", () => {
    const listing = createListing({
      selectedPlatforms: ["reverb"],
      brand: "Gibson",
      model: "Les Paul Studio",
      type: "Electric Guitar",
      year: "2018",
      finish: "Smokehouse Burst",
      manufacturerCountry: "USA",
      ebayCategory: "",
      offerupCategory: "",
      offerupSubcategory: "",
      facebookCategory: "",
      craigslistCategory: "",
      reverbCategory: "Guitars",
      reverbSubcategory: "Electric Guitars",
      reverbAdditionalSubcategory: "Solid Body",
      title: "Gibson Les Paul Studio",
      description: "Solid guitar with hard case and recent setup.",
      price: 999,
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
      "Manufacturer's Country",
      "Category (Reverb)",
      "Subcategory (Reverb)",
      "Additional Subcategory (Reverb)",
      "Listing Title",
      "Description",
      "Link to a YouTube Video",
      "Listing Price",
      "What You Paid for the Item",
      "Shipping Rate",
    ]);
    expect(formatted.photoSets[0].imageNames).toEqual(["front.jpg"]);
    expect(formatted.notes).toContain(
      "Category values are scaffolded suggestions from the listing copy.",
    );
  });
});
