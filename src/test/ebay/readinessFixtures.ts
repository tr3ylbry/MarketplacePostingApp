// Synthetic API-shaped existing settings, never created on a real seller account.
export function readinessFixture(path: string, query: URLSearchParams, missing = false): unknown {
  if (path === "/sell/account/v1/privilege") return { sellerRegistrationCompleted: !missing, sellingLimit: { quantity: missing ? 0 : 100, amount: { value: "private-fixture", currency: "USD" } } };
  if (path === "/sell/account/v1/program/get_opted_in_programs") return { programs: missing ? [] : [{ programType: "SELLING_POLICY_MANAGEMENT" }] };
  for (const [i, kind] of ["fulfillment", "payment", "return"].entries()) {
    if (path === `/sell/account/v1/${kind}_policy` && query.get("marketplace_id") === "EBAY_US") return {
      total: missing ? 0 : 1, [kind + "Policies"]: missing ? [] : [{ [kind + "PolicyId"]: String(100 + i), name: `Fixture ${kind}`,
        marketplaceId: "EBAY_US", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }], description: "private-fixture" }],
    };
  }
  // Observed real Sandbox empty response: explicit array, no paging metadata.
  if (path === "/sell/inventory/v1/location" && missing) return { locations: [] };
  if (path === "/sell/inventory/v1/location") return { total: 2, limit: 100, offset: 0, locations: ["ENABLED", "DISABLED"].map((merchantLocationStatus, i) => ({
    merchantLocationKey: "fixture-warehouse-" + i, merchantLocationStatus, name: "Fixture warehouse", locationTypes: ["WAREHOUSE"],
    location: { address: { country: "US", postalCode: "00000", addressLine1: "private-fixture" } }, phone: "private-fixture",
  })) };
  return undefined;
}
