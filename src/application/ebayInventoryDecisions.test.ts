import { assessInventoryCleanup, assessInventoryPreflight, assessInventoryReconciliation, type InventoryBinding,
  type InventoryDecisionReason, type InventoryObservation } from "./ebayInventoryDecisions";
import { ebaySku } from "./ebayPreparationMapping";

const checkedAt = "2026-11-18T00:00:00.000Z", now = "2026-11-18T00:01:00.000Z", expiresAt = "2026-11-18T00:05:00.000Z";
const binding = (): InventoryBinding => ({ ownerId: "owner-a", sellerKey: "seller-a", listingId: "listing-a", listingVersion: checkedAt,
  connectionId: "connection-a", connectionVersion: "version-a", environment: "sandbox", configHash: "1".repeat(64), grantHash: "2".repeat(64) });
function observation(present = false): InventoryObservation {
  const expected = binding(), sku = ebaySku(expected.listingId);
  return { binding: expected, sku, checkedAt, expiresAt, item: present ? "present" : "absent", content: present ? "matches" : "unknown",
    offers: { complete: true, scope: "all-marketplaces-and-formats", count: 0 }, listings: "none", groups: "none",
    ownership: present ? { state: "confirmed", recordId: "durable-record-a", sku, binding: { ...expected } } : { state: "unproven" },
    priorWrite: present ? "confirmed" : "none", reconciliation: "complete", media: "reported-current" };
}
const functions = [assessInventoryPreflight, assessInventoryReconciliation, assessInventoryCleanup];
it("fresh absence remains a manual creation-race decision, never send authority", () => {
  expect(assessInventoryPreflight(binding(), observation(), now)).toEqual({ outcome: "manual-review", reasons: ["external-create-race"], canStage: false, canDelete: false });
});
it("never replaces even an app-owned matching item during initial staging", () => {
  const result = assessInventoryPreflight(binding(), observation(true), now);
  expect(result.outcome).toBe("blocked"); expect(result.reasons).toContain("existing-sku"); expect(result.reasons).toContain("previous-write");
});
it("describes an exactly bound confirmed item without adopting or authorizing an operation", () => {
  expect(assessInventoryReconciliation(binding(), observation(true), now)).toEqual({ outcome: "consistent", reasons: [], canStage: false, canDelete: false });
});
it("reports absence after a confirmed write without clearing ownership history or retry fences", () => {
  const input = observation(true); input.item = "absent"; input.content = "unknown";
  const before = structuredClone(input);
  expect(assessInventoryReconciliation(binding(), input, now)).toMatchObject({ outcome: "observed-absent", reasons: [] });
  expect(assessInventoryPreflight(binding(), input, now).reasons).toContain("previous-write");
  expect(assessInventoryCleanup(binding(), input, now)).toMatchObject({ outcome: "observed-absent", canDelete: false });
  expect(input).toEqual(before);
});
it("does not adopt or delete an item on prefix/body similarity without prior app-ownership evidence", () => {
  const input = observation(true); input.ownership = { state: "unproven" }; input.priorWrite = "none";
  expect(input.sku).toMatch(/^mpa-ebay-/); expect(input.content).toBe("matches");
  for (const assess of functions) {
    const result = assess(binding(), input, now);
    expect(result.reasons).toContain("ownership-unproven"); expect(result.canStage).toBe(false); expect(result.canDelete).toBe(false);
  }
});
it("requires manual cleanup review despite fresh confirmed ownership and complete absence of related resources", () => {
  expect(assessInventoryCleanup(binding(), observation(true), now)).toEqual({ outcome: "manual-review", reasons: ["external-delete-race"], canStage: false, canDelete: false });
});
it.each([false, true])("retains uncertain earlier writes when present=%s", present => {
  const input = observation(present); input.priorWrite = "uncertain";
  for (const assess of functions) {
    const result = assess(binding(), input, now);
    expect(result.reasons).toContain("uncertain-write"); expect(result.outcome).not.toBe("consistent"); expect(result.outcome).not.toBe("observed-absent");
  }
});
it.each([
  ["ownerId", "owner-b", "owner-mismatch"], ["sellerKey", "seller-b", "seller-mismatch"],
  ["environment", "production", "environment-mismatch"], ["connectionId", "connection-b", "stale-snapshot"],
  ["connectionVersion", "version-b", "stale-snapshot"], ["listingId", "listing-b", "stale-snapshot"],
  ["listingVersion", now, "stale-snapshot"], ["configHash", "a".repeat(64), "stale-snapshot"], ["grantHash", "b".repeat(64), "stale-snapshot"],
] as const)("rejects a wrong/stale %s across all decisions", (key, value, reason) => {
  const input = observation(true); Object.assign(input.binding, { [key]: value });
  for (const assess of functions) expect(assess(binding(), input, now).reasons).toContain(reason);
});
it("rejects production on both sides rather than treating equal production context as supported", () => {
  const input = observation(), expected = binding(); expected.environment = "production"; input.binding.environment = "production";
  for (const assess of functions) expect(assess(expected, input, now).reasons).toContain("environment-mismatch");
});
it.each([
  ["partial offers", (i: InventoryObservation) => { i.offers.complete = false; }, "offers-incomplete"],
  ["filtered offers", (i: InventoryObservation) => { i.offers.scope = "filtered"; }, "offers-incomplete"],
  ["related offers", (i: InventoryObservation) => { i.offers.count = 1; }, "related-offers"],
  ["related listing", (i: InventoryObservation) => { i.listings = "present"; }, "related-listings"],
  ["group membership", (i: InventoryObservation) => { i.groups = "present"; }, "related-groups"],
  ["unknown groups", (i: InventoryObservation) => { i.groups = "unknown"; }, "related-state-unknown"],
  ["unknown listings", (i: InventoryObservation) => { i.listings = "unknown"; }, "related-state-unknown"],
  ["unknown item", (i: InventoryObservation) => { i.item = "unknown"; i.content = "unknown"; }, "item-state-unknown"],
  ["unfinished reconciliation", (i: InventoryObservation) => { i.reconciliation = "incomplete"; }, "reconciliation-incomplete"],
  ["wrong sku", (i: InventoryObservation) => { i.sku = "mpa-ebay-foreign"; }, "sku-mismatch"],
  ["expired reads", (i: InventoryObservation) => { i.expiresAt = now; }, "stale-observation"],
  ["future reads", (i: InventoryObservation) => { i.checkedAt = expiresAt; i.expiresAt = "2026-11-18T01:00:00.000Z"; }, "stale-observation"],
] satisfies [string, (i: InventoryObservation) => void, InventoryDecisionReason][])("fails closed on %s", (_name, mutate, reason) => {
  const input = observation(true); mutate(input);
  for (const assess of functions) {
    const result = assess(binding(), input, now);
    expect(result.reasons).toContain(reason); expect(result.outcome).toBe("blocked");
  }
});
it.each(["ownerId", "sellerKey", "connectionVersion", "listingId", "grantHash"] as const)("does not accept foreign/stale ownership evidence for %s", key => {
  const input = observation(true);
  if (input.ownership.state !== "confirmed") throw Error("fixture");
  Object.assign(input.ownership.binding, { [key]: key === "grantHash" ? "f".repeat(64) : "foreign" });
  for (const assess of functions) expect(assess(binding(), input, now).reasons).toContain("ownership-mismatch");
});
it("rejects contradictory ownership SKU and contradictory absent-item content", () => {
  const input = observation(true);
  if (input.ownership.state !== "confirmed") throw Error("fixture");
  input.ownership.sku = "foreign-sku";
  for (const assess of functions) expect(assess(binding(), input, now).reasons).toContain("ownership-mismatch");
  input.item = "absent";
  for (const assess of functions) expect(assess(binding(), input, now).reasons).toContain("invalid-observation");
});
it.each(["different", "unknown"] as const)("does not call %s content consistent or safe to delete", content => {
  const input = observation(true); input.content = content;
  for (const assess of [assessInventoryReconciliation, assessInventoryCleanup]) {
    const result = assess(binding(), input, now);
    expect(result.reasons).toContain(content === "different" ? "content-conflict" : "content-unverified");
    expect(result.canDelete).toBe(false);
  }
});
it.each(["missing", "expired", "mismatched", "unverified"] as const)("preflight blocks %s media observations", media => {
  const input = observation(); input.media = media;
  expect(assessInventoryPreflight(binding(), input, now).reasons).toContain({ missing: "media-missing", expired: "media-stale", mismatched: "media-mismatch", unverified: "media-unverified" }[media]);
});
it("requires durable prior ownership for cleanup even if the item is already absent", () => {
  const result = assessInventoryCleanup(binding(), observation(), now);
  expect(result.reasons).toContain("ownership-unproven"); expect(result.canDelete).toBe(false);
});
it("returns bounded reasons, not malformed provider data or private values", () => {
  const input = observation(); Object.assign(input, { offers: { complete: true, scope: "all-marketplaces-and-formats", count: -1 }, token: "private-fixture" });
  for (const assess of functions) {
    const result = assess(binding(), input, now);
    expect(result).toEqual({ outcome: "blocked", reasons: ["invalid-observation"], canStage: false, canDelete: false });
    expect(JSON.stringify(result)).not.toMatch(/private-fixture|owner-a|seller-a|connection-a/);
  }
});
it("uses explicit time and leaves normalized observations unchanged across repeated decisions", () => {
  const input = observation(true), before = structuredClone(input);
  for (const assess of functions) {
    expect(assess(binding(), input, now)).toEqual(assess(binding(), input, now));
    expect(assess(binding(), input, expiresAt).reasons).toContain("stale-observation");
  }
  expect(input).toEqual(before);
});
