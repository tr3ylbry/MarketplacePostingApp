import { realMediaContentSchema, realMediaContextSchema, RealMediaError, safeRealMediaFailure } from "../../application/ebayRealMedia";
import { admittedMediaReceipt, admitRealMediaEvidence, parseSyntheticMediaReceipt } from "./realMediaEvidence";
import { mediaRuntime } from "./mediaRuntime";
const location = "https://media-contract.invalid.test/image/test_resource_" + "a".repeat(16);
const imageUrl = "https://eps-contract.invalid.test/photo/test_visual_" + "b".repeat(16) + ".png";
const body = () => ({ imageUrl, expirationDate: "2030-01-01T00:00:00.000Z" });
const raw = () => ({ status: 201, location, body: body() });
it("keeps real admission closed and the original runtime disabled", () => {
  expect(() => admitRealMediaEvidence(raw())).toThrow(RealMediaError); expect(mediaRuntime()).toEqual({ enabled: false });
});
it("requires unforgeable DB/owner/attempt-bound evidence, never a validated boolean", () => {
  expect(() => admittedMediaReceipt({ validated: true, ...parseSyntheticMediaReceipt(raw()) }, "marketplace_real_media_" + "a".repeat(24) + "_test", "owner", "attempt")).toThrow(RealMediaError);
});
it("validates independent synthetic resource and visual IDs without an inferred identity equality", () => {
  expect(parseSyntheticMediaReceipt(raw())).toMatchObject({ level: "complete", resourceId: "test_resource_" + "a".repeat(16), imageUrl });
  expect(Object.isFrozen(parseSyntheticMediaReceipt(raw()))).toBe(true);
});
it.each(["http://eps-contract.invalid.test/photo/test_visual_", "https://eps-contract.invalid.test.evil/photo/test_visual_",
  "https://user@eps-contract.invalid.test/photo/test_visual_", "https://eps-contract.invalid.test:444/photo/test_visual_",
  "https://eps-contract.invalid.test/photo/../test_visual_", "https://eps-contract.invalid.test/photo/%74est_visual_"])("rejects synthetic URL variant %s", prefix => {
  const result = parseSyntheticMediaReceipt({ ...raw(), body: { ...body(), imageUrl: prefix + "b".repeat(16) + ".png" } });
  expect(result.level).toBe("partial"); expect(result.imageUrl).toBeNull(); expect(result.location).toBe(location);
});
it.each(["?token=private", "#fragment", "\n"])("does not admit a URL suffix %s", suffix => {
  expect(parseSyntheticMediaReceipt({ ...raw(), body: { ...body(), imageUrl: imageUrl + suffix } }).imageUrl).toBeNull();
});
it.each([null, {}, "private raw body", { imageUrl }, { expirationDate: body().expirationDate }, { ...body(), expirationDate: "not a date" }, { ...body(), maxDimensionImageUrl: "https://foreign.invalid" }])("preserves independently valid Location on incomplete body %j", value => {
  expect(parseSyntheticMediaReceipt({ ...raw(), body: value })).toMatchObject({ level: "partial", location });
});
it("preserves a valid image URL when expiry is malformed and rejects ambiguous Locations", () => {
  expect(parseSyntheticMediaReceipt({ ...raw(), body: { ...body(), expirationDate: null } })).toMatchObject({ imageUrl, expiresAt: null, level: "partial" });
  expect(parseSyntheticMediaReceipt({ ...raw(), location: [location, location] })).toMatchObject({ location: null, level: "conflict" });
});
it("identical normalized acknowledgements have stable fingerprints", () => {
  expect(parseSyntheticMediaReceipt(raw()).fingerprint).toBe(parseSyntheticMediaReceipt(raw()).fingerprint);
  expect(() => parseSyntheticMediaReceipt({ ...raw(), validated: true })).toThrow(RealMediaError);
});
it.each([0, 10485761])("rejects encoded size %s", size => {
  expect(realMediaContentSchema.safeParse({ sourceDigest: "a".repeat(64), derivativeDigest: "b".repeat(64), recipe: "recipe-v1", contentType: "image/png", size, width: 500, height: 600 }).success).toBe(false);
});
it.each([[499, 499], [4097, 500], [500, 0]])("rejects dimension budget %j", (width, height) => {
  expect(realMediaContentSchema.safeParse({ sourceDigest: "a".repeat(64), derivativeDigest: "b".repeat(64), recipe: "recipe-v1", contentType: "image/png", size: 1024, width, height }).success).toBe(false);
});
it("rejects legacy owners, arbitrary payload fields and private recipe controls", () => {
  const c = { ownerId: "legacy-unclaimed", listingId: "listing", imageId: "image", listingVersion: new Date().toISOString(), sessionHash: "a".repeat(64), actionHash: "b".repeat(64), configHash: "c".repeat(64), recipe: "private\nvalue" };
  expect(realMediaContextSchema.safeParse(c).success).toBe(false);
});
it.each([new Error("Bearer private ciphertext path"), { code: "23505", detail: "foreign seller details" }, { cause: { code: "40P01" } }])("returns bounded safe errors without causes", error => {
  const result = safeRealMediaFailure(error); expect(result).toBeInstanceOf(RealMediaError);
  expect(JSON.stringify(result) + result.message).not.toMatch(/Bearer|ciphertext|path|foreign|details/); expect(Object.prototype.hasOwnProperty.call(result, "cause")).toBe(false);
});
