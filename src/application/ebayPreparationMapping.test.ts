import { listingFixture } from "../test/fixtures";
import { ebaySku, mapEbayPreparation } from "./ebayPreparationMapping";
import { requirementsFixture, preparationSelection as selection } from "../test/ebay/preparationFixtures";
it("maps a strict review allowlist with stable SKU, USD decimal string, quantity one and no remote staging authority", () => {
  const listing = listingFixture({ askingPrice: { amount: 19.99, currency: "USD" }, acquisitionCost: { amount: 5, currency: "USD" } });
  listing.marketplaceDetails.craigslistPhoneNumber = "private-fixture";
  const review = mapEbayPreparation(listing, selection(), requirementsFixture());
  expect(review).toMatchObject({ price: { value: "19.99", currency: "USD" }, quantity: 1, environment: "sandbox", canStage: false, condition: { inventoryEnum: "USED_EXCELLENT" } });
  expect(review.sku).toMatch(/^mpa-ebay-[a-f0-9]{32}$/);
  expect(ebaySku(listing.id)).toBe(review.sku);
  expect(mapEbayPreparation({ ...listing, title: "Different title" }, selection(), requirementsFixture()).sku).toBe(review.sku);
  expect(JSON.stringify(review)).not.toMatch(/acquisitionCost|craigslist|private-fixture|pathname|https?:\/\//);
});
it.each([10.005, 0, -1, Infinity])("rejects invalid or excess-precision asking price %s", amount => {
  expect(() => mapEbayPreparation({ ...listingFixture(), askingPrice: { amount, currency: "USD" } }, selection(), requirementsFixture())).toThrow();
});
it("does not silently truncate an overlong title", () => {
  expect(() => mapEbayPreparation({ ...listingFixture(), title: "x".repeat(81) }, selection(), requirementsFixture())).toThrow();
});
it("requires real leaf, allowed condition and every required aspect", () => {
  expect(() => mapEbayPreparation(listingFixture(), { ...selection(), categoryId: "102" }, requirementsFixture())).toThrow();
  expect(() => mapEbayPreparation(listingFixture(), { ...selection(), conditionId: "2000" }, requirementsFixture())).toThrow();
  expect(() => mapEbayPreparation(listingFixture(), { ...selection(), aspects: [] }, requirementsFixture())).toThrow();
});
it("rejects unknown/duplicate names, excessive cardinality and prototype keys", () => {
  for (const aspects of [
    [...selection().aspects, { name: "Secret", values: ["fixture"] }],
    [...selection().aspects, selection().aspects[0]],
    [{ name: "Brand", values: ["Boss", "Other"] }, selection().aspects[1]],
    [{ name: "__proto__", values: ["fixture"] }],
  ]) expect(() => mapEbayPreparation(listingFixture(), { ...selection(), aspects }, requirementsFixture())).toThrow();
});
it("enforces selection membership, conditional-value exclusion and unsupported-format failure", () => {
  const requirements = requirementsFixture();
  requirements.aspects[0] = { ...requirements.aspects[0], mode: "SELECTION_ONLY", values: [{ value: "Boss", conditional: true }] };
  expect(() => mapEbayPreparation(listingFixture(), selection(), requirements)).toThrow();
  requirements.aspects[0].values = [{ value: "Other", conditional: false }];
  expect(() => mapEbayPreparation(listingFixture(), selection(), requirements)).toThrow();
  requirements.aspects[0] = { ...requirements.aspects[0], mode: "FREE_TEXT", dataType: "NUMBER" };
  expect(() => mapEbayPreparation(listingFixture(), selection(), requirements)).toThrow();
});
