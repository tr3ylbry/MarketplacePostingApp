import { createListing } from "../domain/listing";
import { offerupFacebookAdapter } from "./offerupFacebook";

describe("offerupFacebookAdapter", () => {
  it("returns combined OfferUp and Facebook fields and photo caps", () => {
    const listing = createListing({
      selectedPlatforms: ["offerup", "facebook-marketplace"],
      brand: "Boss",
      model: "RC-505",
      type: "Looper",
      year: "",
      finish: "",
      manufacturerCountry: "",
      ebayCategory: "",
      offerupCategory: "Pro Audio",
      offerupSubcategory: "Loopers",
      facebookCategory: "Music Gear",
      craigslistCategory: "",
      reverbCategory: "",
      reverbSubcategory: "",
      reverbAdditionalSubcategory: "",
      title: "Boss RC-505 Loop Station",
      description: "Clean looper with power supply and original packaging.",
      price: 399,
      condition: "Good",
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
      imageNames: Array.from({ length: 14 }, (_, index) => `photo-${index + 1}.jpg`),
    });

    const formatted = offerupFacebookAdapter.formatListing(listing);

    expect(formatted.platform).toBe("OfferUp / Facebook Marketplace");
    expect(formatted.fields.map((field) => field.label)).toEqual([
      "Title",
      "Price",
      "Category (OfferUp)",
      "Category (Facebook Marketplace)",
      "Sub-category (OfferUp)",
      "Condition",
      "Brand (OfferUp)",
      "Type (OfferUp)",
      "Description",
    ]);
    expect(formatted.photoSets).toEqual([
      {
        key: "offerup",
        label: "OfferUp",
        limit: 12,
        imageNames: Array.from({ length: 12 }, (_, index) => `photo-${index + 1}.jpg`),
      },
      {
        key: "facebook-marketplace",
        label: "Facebook Marketplace",
        limit: 10,
        imageNames: Array.from({ length: 10 }, (_, index) => `photo-${index + 1}.jpg`),
      },
    ]);
  });
});
