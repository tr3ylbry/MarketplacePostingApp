import { localOperatorVerificationPins } from "../../scripts/local-image-operator-pins";
import { LocalOperatorError } from "../application/localImageOperator";

const source = { reviewedHead: "a".repeat(40), listingId: "listing", imageId: "image", sellerKey: "b".repeat(64),
  connectedVersion: "version", sourceDigest: "c".repeat(64), derivativeDigest: "d".repeat(64), listingVersion: "2026-11-25T17:00:00.123Z" };

it.each([
  ["2026-11-25T17:00:00.123Z", "2026-11-25T17:00:00.123Z"],
  ["2026-11-25 17:00:00.123+00", "2026-11-25T17:00:00.123Z"],
  ["2026-11-25 17:00:00.123000+00", "2026-11-25T17:00:00.123Z"],
  ["2026-11-25 17:00:00+00", "2026-11-25T17:00:00.000Z"],
  ["2026-11-25 17:00:00.1+00", "2026-11-25T17:00:00.100Z"],
  ["2026-11-25 17:00:00.12+00:00", "2026-11-25T17:00:00.120Z"],
  ["2026-11-25 10:00:00.123-07", "2026-11-25T17:00:00.123Z"],
  ["2026-11-26T00:30:00.123+0730", "2026-11-25T17:00:00.123Z"],
  ["2024-02-29 00:00:00+00", "2024-02-29T00:00:00.000Z"],
  ["2026-01-01 00:30:00+01", "2025-12-31T23:30:00.000Z"],
])("canonicalizes only the exact millisecond listing pin %s", (input, expected) => {
  const result = localOperatorVerificationPins({ ...source, listingVersion: input }, "synthetic_test");
  expect(result).toEqual({ head: source.reviewedHead, database: "synthetic_test", listing: source.listingId, image: source.imageId,
    listingVersion: expected, seller: source.sellerKey, connectionVersion: source.connectedVersion, sourceDigest: source.sourceDigest, derivativeDigest: source.derivativeDigest });
});

it.each(["", "infinity", "-infinity", "2026-11-25 17:00:00.123001+00", "2026-11-25T17:00:00.000100Z",
  "2026-11-25 17:00:00.1234567+00", "2026-11-25 17:00:00", "2026-02-30 17:00:00+00", "2026-11-25 24:00:00+00",
  "2026-11-25 17:00:60+00", "2026-11-25 17:00:00+24", "2026-11-25 17:00:00+00:60", " 2026-11-25T17:00:00.123Z",
  "2026-11-25T17:00:00.123Z\n", "2026-11-25T17:00:00.123Zsuffix", "2025-02-29 00:00:00+00",
  "9999-12-31 23:59:59.999-01", "0000-01-01 00:00:00+01"])("rejects invalid or lossy listing pin %j", listingVersion => {
  expect(() => localOperatorVerificationPins({ ...source, listingVersion }, "synthetic_test")).toThrow(LocalOperatorError);
});

it.each(["listingId", "imageId", "listingVersion", "connectedVersion", "sourceDigest", "derivativeDigest"] as const)("preserves missing %s rejection", key => {
  expect(() => localOperatorVerificationPins({ ...source, [key]: null }, "synthetic_test")).toThrow(LocalOperatorError);
});
