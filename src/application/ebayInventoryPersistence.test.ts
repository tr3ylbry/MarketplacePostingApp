// @vitest-environment node
import { inventoryClaimInput, inventoryClaimSchema, inventoryDigest, inventoryIntentSchema, normalizeInventoryEvidence, type InventoryEvidence } from "./ebayInventoryPersistence";
const hash = inventoryDigest("synthetic");
const data = (): InventoryEvidence => ({ version: "inventory-local-v1", kind: "inspection", startedAt: "2026-11-19T12:00:00.000Z",
  finishedAt: "2026-11-19T12:00:01.000Z", item: "absent", coverage: "complete", outcome: "observed", code: "none",
  contentDigest: null, related: [], httpStatus: 200, overflow: false });

it("retains a legitimate normalized observation without admitting ownership", () => {
  const input = data(), value = normalizeInventoryEvidence(input); expect(value).toEqual(input); expect(value).not.toBe(input);
  expect(value).not.toHaveProperty("ownership"); expect(value).not.toHaveProperty("canStage");
});
it("accepts exactly 250 safe related references", () => {
  const value = normalizeInventoryEvidence({ ...data(), related: Array.from({ length: 250 }, (_, n) => ({ kind: "offer", id: "test_" + n })) });
  expect(value.related).toHaveLength(250); expect(value.coverage).toBe("complete");
});
it("downgrades overflow to unknown rather than fabricated absence", () => {
  const value = normalizeInventoryEvidence({ ...data(), related: Array.from({ length: 251 }, (_, n) => ({ kind: "offer", id: "test_" + n })) });
  expect(value).toMatchObject({ item: "unknown", coverage: "incomplete", outcome: "uncertain", code: "overflow", related: [], overflow: true });
});
it("preserves an explicit overflow marker as incomplete even with a small envelope", () => {
  expect(normalizeInventoryEvidence({ ...data(), overflow: true, item: "present", contentDigest: hash })).toMatchObject({ item: "unknown", contentDigest: null, overflow: true });
});
it.each(["recreation","integrity","conflict"] as const)("overflow never weakens an existing %s classification", code => {
  expect(normalizeInventoryEvidence({ ...data(),code,overflow:true })).toMatchObject({ code,coverage:"incomplete",item:"unknown" });
});
it.each(["accessToken", "refreshToken", "authorization", "rawBody", "imageBytes", "pathname", "filename", "signedUrl", "ownership", "canStage"])("rejects unknown private/authority field %s", key => {
  expect(() => normalizeInventoryEvidence({ ...data(), [key]: "synthetic-forbidden" })).toThrow();
});
it.each([
  { version: "provider-success-v1" }, { item: "confirmed" }, { coverage: null }, { httpStatus: 999 }, { contentDigest: "not-a-digest" },
  { finishedAt: "2026-11-19T11:59:59.000Z" }, { related: [{ kind: "offer", id: "a".repeat(201) }] },
  { related: [{ kind: "offer", id: "https://example.invalid/private" }] }, { related: [{ kind: "offer", id: "safe", accountName: "private" }] },
])("rejects malformed normalized evidence %#", change => { expect(() => normalizeInventoryEvidence({ ...data(), ...change })).toThrow(); });
it("allows bounded 200-character identifiers and rejects 201", () => {
  expect(normalizeInventoryEvidence({ ...data(), related: [{ kind: "group", id: "a".repeat(200) }] }).related).toHaveLength(1);
});
it("requires all immutable context and one-use claim fields", () => {
  const value = { ownerId: "owner", listingId: "listing", listingVersion: data().startedAt, connectionId: "connection", connectionVersion: "version",
    configHash: hash, grantHash: hash, sessionId: "session", actionHash: hash, operation: "inspect" };
  expect(inventoryClaimInput.safeParse(value).success).toBe(true);
  expect(inventoryClaimInput.safeParse({ ...value, operation: "publish" }).success).toBe(false);
  expect(inventoryClaimInput.safeParse({ ...value, ownerId: "legacy-unclaimed" }).success).toBe(false);
  expect(inventoryClaimInput.safeParse({ ...value, grantHash: undefined }).success).toBe(false);
  expect(inventoryClaimSchema.safeParse({}).success).toBe(false);
  expect(inventoryIntentSchema.safeParse({ payloadDigest: hash, mediaManifestDigest: hash }).success).toBe(true);
  expect(inventoryIntentSchema.safeParse({ payloadDigest: hash, mediaManifestDigest: hash, ownership: "confirmed" }).success).toBe(false);
});
