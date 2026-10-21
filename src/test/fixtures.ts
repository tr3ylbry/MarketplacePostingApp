import { createListing, type CreateListingInput } from "../domain/listing";
import { createMoney } from "../domain/money";

export function listingFixture(overrides: Partial<CreateListingInput> = {}) {
  return createListing({
    title: "Fender Guitar", description: "Clean guitar with a case and working electronics.",
    askingPrice: createMoney(250), shippingRate: createMoney(0),
    category: "Guitars", condition: "good", attributes: { brand: "Fender", model: "Strat" },
    selectedPlatforms: ["ebay", "reverb"], ...overrides,
  });
}
