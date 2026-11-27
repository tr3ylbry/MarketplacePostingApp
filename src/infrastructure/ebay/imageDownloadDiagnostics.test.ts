// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { DNS_NATIVE_CODES, ImageDnsRefusal, imageDnsDiagnostic } from "./imageDownloadDiagnostics";
import { verificationOutcome } from "../../../scripts/image-verification-report";
import { verificationEnvelope } from "../../application/ebayImageVerificationPersistence";
import { dnsNegativeFixtures } from "../../test/imageDnsFixtures";
vi.mock("server-only", () => ({}));

const result = (dns?: unknown) => ({
  state: "unknown", associated: false, retrieved: false,
  diagnostic: { outcome: "refused", reason: "dns", bytes: 0, mime: null, exceeded: false,
    unverified: true, associated: false, settlement: "unsettled", ...(dns ? { dns } : {}) },
  visual: null, acknowledgement: "recorded", settlement: "settled", reason: "completed",
});
it("enforces offline/private access guards", assertOfflineGuards);
it.each(DNS_NATIVE_CODES)("preserves only allowed native code %s", code => {
  const failure = new ImageDnsRefusal("connect", "native-error", { code, message: "PRIVATE-ERROR", address: "PRIVATE-ADDRESS", hostname: "PRIVATE-HOST", stack: "PRIVATE-STACK" });
  expect(failure.dns).toEqual({ phase: "connect", reason: "native-error", nativeCode: code });
  expect(Object.isFrozen(failure.dns)).toBe(true);
  expect(JSON.stringify(failure)).not.toContain("PRIVATE-");
});
it.each(["PRIVATE-CODE", "x".repeat(1024), 1, null, undefined])("drops unknown native metadata %#", code => {
  expect(imageDnsDiagnostic("exchange", "native-error", { code }).nativeCode).toBeNull();
});
it("does not expose an error getter failure or native metadata outside native errors", () => {
  expect(imageDnsDiagnostic("connect", "native-error", { get code() { throw Error("PRIVATE-GETTER"); } }).nativeCode).toBeNull();
  expect(imageDnsDiagnostic("parse", "invalid-message", { code: "EPERM" }).nativeCode).toBeNull();
});
it("allows bounded transient DNS reports while retaining legacy report compatibility", () => {
  const dns = imageDnsDiagnostic("connect", "native-error", { code: "EPERM" });
  const parsed = verificationOutcome(result(dns) as Parameters<typeof verificationOutcome>[0]);
  expect(parsed.diagnostic?.dns).toEqual(dns);
  expect(Buffer.byteLength(JSON.stringify(dns))).toBeLessThan(200);
  expect(verificationOutcome(result() as Parameters<typeof verificationOutcome>[0]).diagnostic).not.toHaveProperty("dns");
});
it.each([
  { phase: "PRIVATE-PHASE", reason: "native-error", nativeCode: "EPERM" },
  { phase: "connect", reason: "PRIVATE-REASON", nativeCode: null },
  { phase: "connect", reason: "native-error", nativeCode: "PRIVATE-CODE" },
  { phase: "connect", reason: "native-error", nativeCode: "EPERM", server: "PRIVATE-SERVER" },
  { phase: "parse", reason: "invalid-message", nativeCode: "EPERM" },
])("rejects unbounded, extra or contradictory report detail %#", dns => {
  expect(() => verificationOutcome(result(dns) as Parameters<typeof verificationOutcome>[0])).toThrow();
});
it("does not broaden the persisted SQL evidence envelope", () => {
  const persisted = { version: "diagnostic-verification-v1", event: "failure", reason: "transport", settlement: "unsettled",
    httpStatus: null, bytes: 0, exceeded: false, mime: null };
  expect(verificationEnvelope(persisted)).toEqual(persisted);
  expect(() => verificationEnvelope({ ...persisted, dns: imageDnsDiagnostic("connect", "native-error", { code: "EPERM" }) })).toThrow();
});
it.each([...dnsNegativeFixtures.map(v => v.reason), "negative-incomplete"] as const)("strictly bounds transient %s and never persists it", reason => {
  const dns = imageDnsDiagnostic("parse", reason, { code: "EPERM", message: "PRIVATE-MESSAGE", packet: "PRIVATE-PACKET" });
  expect(dns).toEqual({ phase: "parse", reason, nativeCode: null }); expect(Object.isFrozen(dns)).toBe(true);
  const parsed = verificationOutcome(result(dns) as Parameters<typeof verificationOutcome>[0]);
  expect(parsed.diagnostic?.dns).toEqual(dns); expect(Buffer.byteLength(JSON.stringify(dns))).toBeLessThan(120);
  expect(JSON.stringify(parsed)).not.toContain("PRIVATE-");
  const persisted = { version: "diagnostic-verification-v1", event: "failure", reason: "transport", settlement: "unsettled",
    httpStatus: null, bytes: 0, exceeded: false, mime: null };
  expect(() => verificationEnvelope({ ...persisted, dns })).toThrow();
  for (const extra of ["packet", "question", "address", "url", "server", "message", "stack", "errno"]) {
    expect(() => verificationOutcome(result({ ...dns, [extra]: "PRIVATE" }) as Parameters<typeof verificationOutcome>[0])).toThrow();
  }
  expect(() => verificationOutcome(result({ ...dns, nativeCode: "EPERM" }) as Parameters<typeof verificationOutcome>[0])).toThrow();
});
