// @vitest-environment node
import { assertOfflineGuards } from "../test/offlinePrototypeGuards";
import { verificationEnvelope, verificationIntentSchema, verificationPolicySchema, IMAGE_VERIFICATION_POLICY, IMAGE_VERIFICATION_POLICY_CUTOFF, VerificationPersistenceError } from "./ebayImageVerificationPersistence";
import { IMAGE_ADDRESS_POLICY_DATA } from "../infrastructure/ebay/imagePublicAddressPolicyData";
const good = { version: "diagnostic-verification-v1", event: "response", reason: "bounded-response", settlement: "settled", httpStatus: 200, bytes: 17, exceeded: false, mime: "image/png" };
it("blocks external and private configuration access", assertOfflineGuards);
it("pins the accepted public-data tuple without importing a runtime gateway", () => {
  expect(IMAGE_VERIFICATION_POLICY.addressPolicyVersion).toBe(IMAGE_ADDRESS_POLICY_DATA.manifest.policyVersion);
  expect(IMAGE_VERIFICATION_POLICY.addressPolicyDataHash).toBe(IMAGE_ADDRESS_POLICY_DATA.manifest.normalizedSha256);
  expect(IMAGE_VERIFICATION_POLICY_CUTOFF).toBe(IMAGE_ADDRESS_POLICY_DATA.manifest.reviewCutoff);
  expect(verificationPolicySchema.parse(IMAGE_VERIFICATION_POLICY)).toEqual(IMAGE_VERIFICATION_POLICY);
});
it.each([0, 1, 1_048_576])("accepts a bounded legitimate diagnostic control with %i bytes", bytes => {
  expect(verificationEnvelope({ ...good, bytes })).toEqual({ ...good, bytes });
});
it.each([100, 200, 599])("accepts bounded HTTP status %i as an unverified fact", httpStatus => {
  expect(verificationEnvelope({ ...good, httpStatus }).httpStatus).toBe(httpStatus);
});
it.each([
  { bytes: -1 }, { bytes: 1.5 }, { bytes: 1_048_577 }, { httpStatus: 99 }, { httpStatus: 600 }, { httpStatus: "200" },
  { mime: "text/plain" }, { version: "unreviewed" }, { reason: "PRIVATE-MARKER" }, { event: "unreviewed" },
  { extra: "PRIVATE-MARKER" }, { query: "PRIVATE-MARKER" }, { reason: "x".repeat(2049) }, { bytes: Infinity },
  { event: "response", settlement: "unsettled" }, { event: "response", httpStatus: null },
  { event: "cancelled", reason: "cancelled", settlement: "settled" }, { event: "settlement", reason: "transport" },
])("refuses extra/unbounded/contradictory envelope case %#", changes => {
  expect(() => verificationEnvelope({ ...good, ...changes })).toThrow();
});
it("accepts cancelled and settled controls without calling either a provider success", () => {
  expect(verificationEnvelope({ ...good, event: "cancelled", reason: "cancelled", settlement: "unsettled", httpStatus: null, bytes: 0, mime: null }).event).toBe("cancelled");
  expect(verificationEnvelope({ ...good, event: "settlement", reason: "settled" }).event).toBe("settlement");
  expect(new VerificationPersistenceError().message).toBe("Diagnostic persistence refused or unavailable.");
});
it.each(["contractVersion", "addressPolicyVersion", "addressPolicyDataHash"])("rejects an unknown %s", field => {
  expect(() => verificationPolicySchema.parse({ ...IMAGE_VERIFICATION_POLICY, [field]: "unknown" })).toThrow();
});
it("requires syntactic UTC times without claiming they authenticate a response", () => {
  expect(verificationIntentSchema.parse({ responseReceivedAt: "2026-11-22T22:00:00.123456Z", providerExpiresAt: "2026-11-23T22:00:00Z" })).toBeDefined();
  expect(() => verificationIntentSchema.parse({ responseReceivedAt: "wrong", providerExpiresAt: "wrong" })).toThrow();
});
