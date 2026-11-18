import { listingFixture } from "../test/fixtures";
import { preparationSelection, requirementsFixture } from "../test/ebay/preparationFixtures";
import { ebaySku } from "./ebayPreparationMapping";
import { planEbayInventory, type InventoryPlannerInput } from "./ebayInventoryPlanner";
import type { InventoryBinding } from "./ebayInventoryDecisions";

const checkedAt = "2026-11-18T00:00:00.000Z", now = "2026-11-18T00:01:00.000Z", expiresAt = "2026-11-18T00:05:00.000Z";
function fixture(): InventoryPlannerInput {
  const listing = { ...listingFixture(), id: "11111111-1111-4111-8111-111111111111", updatedAt: checkedAt };
  listing.images = [1, 0].map(order => ({ id: `photo-${order}`, listingId: listing.id, order,
    source: { kind: "vercel-blob", pathname: `images/${listing.id}/photo-${order}.png`, originalFilename: "private-camera.png",
      contentType: "image/png", size: 500, uploadedAt: checkedAt } }));
  const binding: InventoryBinding = { ownerId: "owner-a", listingId: listing.id, listingVersion: listing.updatedAt,
    environment: "sandbox", sellerKey: "seller-a", connectionId: "connection-a", connectionVersion: "version-a",
    configHash: "1".repeat(64), grantHash: "2".repeat(64) };
  const photos = listing.images.map(image => ({ ...binding, imageId: image.id, imageOrder: image.order, sourceVersion: String(image.order + 3).repeat(64) }));
  return { listing, binding, current: { ...binding }, metadata: { checkedAt, expiresAt }, selection: preparationSelection(),
    requirements: requirementsFixture(), photos,
    media: photos.map(photo => ({ imageId: photo.imageId, state: "reported-confirmed", binding: { ...photo }, checkedAt, expiresAt })) };
}
function freeze(value: unknown) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}
it("maps only verified Inventory Item fields and keeps Offer data outside the item", () => {
  const input = fixture(), plan = planEbayInventory(input, now);
  expect(plan.inventoryItem).toEqual({ availability: { shipToLocationAvailability: { quantity: 1 } }, condition: "USED_EXCELLENT",
    product: { title: input.listing.title, description: input.listing.description, aspects: { Brand: ["Boss"], Model: ["DS-1"] } } });
  expect(plan.metadata).toEqual({ categoryId: "101", treeId: "0", treeVersion: "fixture-1", conditionId: "3000", checkedAt, expiresAt });
  expect(plan.sku).toBe(ebaySku(input.listing.id));
  expect(plan.canStage).toBe(false);
  expect(plan.blockers).toEqual(["media-admission-disabled", "staging-disabled"]);
  for (const field of ["sku", "categoryId", "marketplaceId", "format", "pricingSummary", "listingPolicies", "merchantLocationKey", "imageUrls"]) {
    expect(plan.inventoryItem).not.toHaveProperty(field);
    expect(plan.inventoryItem!.product).not.toHaveProperty(field);
  }
  expect(Object.keys(plan.inventoryItem!.product)).toEqual(["title", "description", "aspects"]);
  // Model is a validated item aspect, not an invented Product.model field.
  expect(plan.inventoryItem?.product.aspects.Model).toEqual(["DS-1"]);
});
it("is deterministic with explicit time, does not mutate inputs and returns detached data", () => {
  const input = fixture(), before = structuredClone(input); freeze(input);
  const first = planEbayInventory(input, now), second = planEbayInventory(input, now);
  expect(first).toEqual(second); expect(input).toEqual(before);
  first.inventoryItem!.product.aspects.Brand[0] = "Changed";
  first.binding!.connectionVersion = "changed";
  expect(input.selection.aspects[0].values).toEqual(["Boss"]);
  expect(input.binding.connectionVersion).toBe("version-a");
  expect(second.inventoryItem!.product.aspects.Brand).toEqual(["Boss"]);
});
it("uses canonical photo order without reordering inputs or emitting private paths", () => {
  const input = fixture(), plan = planEbayInventory(input, now);
  expect(plan.photos.map(p => [p.imageId, p.order, p.media])).toEqual([["photo-0", 0, "reported-current"], ["photo-1", 1, "reported-current"]]);
  expect(input.listing.images.map(p => p.order)).toEqual([1, 0]);
  input.listing.acquisitionCost = { amount: 12, currency: "USD" };
  input.listing.marketplaceDetails.craigslistPhoneNumber = "private-contact-fixture";
  input.listing.marketplaceDetails.craigslistStreet = "private-location-fixture";
  expect(JSON.stringify(planEbayInventory(input, now))).not.toMatch(/acquisitionCost|askingPrice|shippingRate|craigslist|private-contact|private-location|pathname|private-camera|https?:|accessToken|credential|receipt/i);
});
it("escapes canonical plain text for the HTML-capable description and never truncates", () => {
  const input = fixture(); input.listing.description = 'Plain <script> & "text" with apostrophe\'s.';
  expect(planEbayInventory(input, now).inventoryItem?.product.description).toBe("Plain &lt;script&gt; &amp; &quot;text&quot; with apostrophe&#39;s.");
  input.listing.description = "&".repeat(1000);
  expect(planEbayInventory(input, now)).toMatchObject({ inventoryItem: null, blockers: expect.arrayContaining(["inventory-fields-invalid"]) });
});
it.each(["ownerId", "sellerKey", "connectionId", "connectionVersion", "listingId", "listingVersion", "configHash", "grantHash", "environment"] as const)("blocks a stale/wrong current %s", key => {
  const input = fixture();
  const alternate = { ...input.current, ownerId: "owner-b", sellerKey: "seller-b", connectionId: "connection-b", connectionVersion: "version-b",
    listingId: "other-listing", listingVersion: now, configHash: "a".repeat(64), grantHash: "b".repeat(64), environment: "production" as const };
  Object.assign(input.current, { [key]: alternate[key] });
  expect(planEbayInventory(input, now).blockers).toContain("snapshot-mismatch");
});
it("blocks missing, expired and future metadata without falling back to scaffolded categories", () => {
  const input = fixture(); input.requirements = null;
  expect(planEbayInventory(input, now)).toMatchObject({ inventoryItem: null, blockers: expect.arrayContaining(["metadata-unavailable"]) });
  input.requirements = requirementsFixture(); input.metadata.expiresAt = now;
  expect(planEbayInventory(input, now).blockers).toContain("metadata-stale");
  input.metadata = { checkedAt: expiresAt, expiresAt: "2026-11-18T01:00:00.000Z" };
  expect(planEbayInventory(input, now).blockers).toContain("metadata-stale");
  input.requirements.branch.treeVersion = "";
  expect(planEbayInventory(input, now)).toMatchObject({ inventoryItem: null, blockers: expect.arrayContaining(["metadata-invalid"]) });
});
it.each(["category", "condition", "required-aspect", "unknown-aspect", "conditional", "format"])("retains preparation validation for %s", variant => {
  const input = fixture(), r = input.requirements!;
  if (variant === "category") input.selection.categoryId = "102";
  if (variant === "condition") input.selection.conditionId = "2000";
  if (variant === "required-aspect") input.selection.aspects = [];
  if (variant === "unknown-aspect") input.selection.aspects.push({ name: "Unknown", values: ["value"] });
  if (variant === "conditional") r.aspects[0].values = [{ value: "Boss", conditional: true }];
  if (variant === "format") r.aspects[0].format = "unsupported";
  expect(planEbayInventory(input, now)).toMatchObject({ inventoryItem: null, blockers: expect.arrayContaining(["selection-invalid"]) });
});
it.each([0, -1, 1.001, Infinity, NaN])("blocks invalid canonical price %s even though price belongs to the future Offer", amount => {
  const input = fixture(); input.listing.askingPrice.amount = amount;
  expect(planEbayInventory(input, now)).toMatchObject({ inventoryItem: null, blockers: expect.arrayContaining(["listing-invalid"]) });
});
it("blocks invalid listing identity, overlong title, duplicate image order and unsupported condition enums", () => {
  for (const mutate of [
    (i: InventoryPlannerInput) => { i.listing.id = ""; },
    (i: InventoryPlannerInput) => { i.listing.title = "x".repeat(81); },
    (i: InventoryPlannerInput) => { i.listing.images[0].order = 0; },
  ]) { const input = fixture(); mutate(input); expect(planEbayInventory(input, now).blockers).toContain("listing-invalid"); }
  const input = fixture(); input.requirements!.conditions = [{ id: "9999", name: "Unsupported", supported: true }]; input.selection.conditionId = "9999";
  expect(planEbayInventory(input, now).blockers).toContain("selection-invalid");
});
it("preserves the existing for-parts condition mapping", () => {
  const input = fixture(); input.requirements!.conditions = [{ id: "7000", name: "Parts", supported: true }]; input.selection.conditionId = "7000";
  expect(planEbayInventory(input, now).inventoryItem?.condition).toBe("FOR_PARTS_OR_NOT_WORKING");
});
it("enforces Inventory aspect lengths in addition to authoritative taxonomy validation", () => {
  const input = fixture(); input.selection.aspects[0].values = ["x".repeat(50)];
  expect(planEbayInventory(input, now).inventoryItem).not.toBeNull();
  input.selection.aspects[0].values = ["x".repeat(51)];
  expect(planEbayInventory(input, now).blockers).toContain("inventory-fields-invalid");
  input.selection.aspects[0] = { name: "x".repeat(41), values: ["value"] }; input.requirements!.aspects[0].name = "x".repeat(41);
  expect(planEbayInventory(input, now).blockers).toContain("inventory-fields-invalid");
});
it.each(["missing", "unverified", "expired", "mismatch"])("blocks %s media while real admission always remains closed", state => {
  const input = fixture();
  if (state === "missing") input.media = [];
  if (state === "unverified") input.media = input.media.map(m => ({ imageId: m.imageId, state: "unverified" }));
  if (state === "expired") input.media = input.media.map(m => m.state === "reported-confirmed" ? { ...m, expiresAt: now } : m);
  if (state === "mismatch") input.media = input.media.map(m => m.state === "reported-confirmed" ? { ...m, binding: { ...m.binding, sourceVersion: "f".repeat(64) } } : m);
  const plan = planEbayInventory(input, now);
  expect(plan.blockers).toContain({ missing: "media-missing", unverified: "media-unverified", expired: "media-expired", mismatch: "media-mismatch" }[state]);
  expect(plan.blockers).toContain("media-admission-disabled"); expect(plan.canStage).toBe(false);
});
it.each(["ownerId", "sellerKey", "connectionVersion", "grantHash", "imageOrder", "imageId", "listingVersion"] as const)("rejects media evidence bound to another %s", key => {
  const input = fixture(), media = input.media[0];
  if (media.state !== "reported-confirmed") throw Error("fixture");
  const other = { ownerId: "other", sellerKey: "other", connectionVersion: "other", grantHash: "f".repeat(64), imageOrder: 9, imageId: "other", listingVersion: now };
  Object.assign(media.binding, { [key]: other[key] });
  expect(planEbayInventory(input, now).blockers).toContain("media-mismatch");
});
it("rejects stale/duplicate/extra photo snapshots and does not return a foreign source binding", () => {
  const input = fixture(); input.photos[0].ownerId = "owner-b";
  expect(planEbayInventory(input, now).photos.find(p => p.imageId === input.photos[0].imageId)?.sourceVersion).toBeNull();
  expect(planEbayInventory(input, now).blockers).toContain("photo-snapshot-mismatch");
  input.photos = [input.photos[1], input.photos[1]];
  expect(planEbayInventory(input, now).blockers).toContain("photo-snapshot-mismatch");
  input.media.push(input.media[0]);
  expect(planEbayInventory(input, now).blockers).toContain("media-mismatch");
});
it("blocks filename-only, empty and over-budget photo sets without silently truncating", () => {
  const input = fixture(); input.listing.images[0].source = { kind: "filename", name: "legacy.png" };
  expect(planEbayInventory(input, now).blockers).toContain("photo-source-unsupported");
  input.listing.images = []; input.photos = []; input.media = [];
  expect(planEbayInventory(input, now).blockers).toContain("photo-count");
  const full = fixture(); full.listing.images = Array.from({ length: 25 }, (_, order) => ({ ...full.listing.images[0], id: `photo-${order}`, order }));
  expect(planEbayInventory(full, now).blockers).toContain("photo-count");
  expect(planEbayInventory(full, now).photos).toHaveLength(25);
});
it("fails closed on malformed observation times without returning arbitrary input", () => {
  const input = fixture(); input.metadata.expiresAt = "not-a-date";
  expect(planEbayInventory(input, now)).toMatchObject({ inventoryItem: null, binding: null, blockers: expect.arrayContaining(["invalid-snapshot"]) });
  expect(planEbayInventory(fixture(), "invalid").blockers).toContain("invalid-snapshot");
});
