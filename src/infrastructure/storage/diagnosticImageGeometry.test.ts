// @vitest-environment node
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { mapJpeg, mapPng } from "../../test/photoPrivacyFixtures";
import { realMediaDigest } from "../../application/ebayRealMedia";
import { acquirePhotoCapacity, releasePhotoCapacity } from "../../application/photoCapacity";
import { ImageComparisonError } from "../../application/imageComparison";
import { generateVerificationFixture } from "./verificationFixture";
import { discardImageReference, prepareImageReference, startImageComparison } from "./diagnosticImageComparison";

vi.mock("server-only", () => ({}));
vi.mock("sharp", async original => {
  const actual = await original<typeof import("sharp")>();
  return { default: Object.assign(vi.fn(actual.default), actual.default) };
});
let png: Buffer, jpeg: Buffer;
beforeAll(async () => {
  png = (await generateVerificationFixture()).bytes;
  jpeg = await sharp(png).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
});
afterAll(() => { png?.fill(0); jpeg?.fill(0); });
const window = () => ({ wallUntil: Date.now() + 20_000, monoUntil: performance.now() + 20_000 });

async function compare(bytes: Buffer, mime: string, nativeExpected: boolean) {
  const lease = acquirePhotoCapacity(), controller = new AbortController();
  const binding = { operationId: randomUUID(), derivativeDigest: realMediaDigest(png) };
  let ref: Awaited<ReturnType<typeof prepareImageReference>> | undefined;
  let op: ReturnType<typeof startImageComparison> | undefined;
  const original = Buffer.from(bytes);
  try {
    ref = await prepareImageReference(png, binding, window(), controller.signal, lease);
    const before = vi.mocked(sharp).mock.calls.length;
    op = startImageComparison(ref, binding, bytes, mime, window(), controller.signal, lease);
    const result = await op.result;
    await op.settled;
    expect(vi.mocked(sharp).mock.calls.length - before).toBe(nativeExpected ? 1 : 0);
    expect(bytes).toEqual(original);
    expect(result).toMatchObject({ associated: false, settlement: "settled" });
    return result;
  } finally {
    op?.cancel(); if (op) await op.settled;
    discardImageReference(ref); releasePhotoCapacity(lease); original.fill(0);
  }
}

it("guards offline dependencies", assertOfflineGuards);
it.each(["image/png", "image/jpeg"])("reports exact dimensions for a legitimate %s control", async mime => {
  expect(await compare(mime === "image/png" ? png : jpeg, mime, true)).toMatchObject({
    verdict: "match", decoding: "passed", geometry: "passed", encodedDimensions: { width: 500, height: 600 },
  });
});
it.each(["png", "jpeg"])("reports a genuinely rotated %s without decoding or transformation search", async format => {
  const image = sharp(png).rotate(90);
  const rotated = await (format === "png" ? image.png() : image.jpeg()).toBuffer();
  try {
    expect(await compare(rotated, "image/" + format, false)).toMatchObject({
      verdict: "inconclusive", reason: "geometry", geometry: "failed", decoding: "not-run",
      encodedDimensions: { width: 600, height: 500 }, orientation: "not-run", marker: "not-run",
      color: "not-run", similarity: "not-run", metrics: null,
    });
  } finally { rotated.fill(0); }
});
it.each([[499, 600], [500, 599], [250, 300], [1000, 1200], [0, 600], [0xffffffff, 0xffffffff]])(
  "bounds and reports PNG IHDR claims %i×%i before native allocation", async (width, height) => {
    const bytes = mapPng(png, (type, data) => {
      const copy = Buffer.from(data);
      if (type === "IHDR") { copy.writeUInt32BE(width, 0); copy.writeUInt32BE(height, 4); }
      return copy;
    });
    try {
      const result = await compare(bytes, "image/png", false);
      expect(result).toMatchObject({ verdict: "inconclusive", reason: "geometry", decoding: "not-run", geometry: "failed", encodedDimensions: { width, height }, metrics: null });
      expect(Object.isFrozen(result.encodedDimensions)).toBe(true);
    } finally { bytes.fill(0); }
  });
it.each([[499, 600], [500, 599], [0, 600], [65535, 65535]])(
  "reports JPEG SOF claims %i×%i in width/height order without decoding", async (width, height) => {
    const bytes = mapJpeg(jpeg, (marker, data) => {
      const copy = Buffer.from(data);
      if ([192, 194].includes(marker)) { copy.writeUInt16BE(width, 3); copy.writeUInt16BE(height, 1); }
      return copy;
    });
    try {
      expect(await compare(bytes, "image/jpeg", false)).toMatchObject({ verdict: "inconclusive", reason: "geometry", decoding: "not-run", geometry: "failed", encodedDimensions: { width, height }, metrics: null });
    } finally { bytes.fill(0); }
  });
it.each(["truncated", "crc", "unsupported-header", "unsupported-mime", "oversized", "malformed-sof"])(
  "does not invent dimensions for %s input", async kind => {
    let bytes = Buffer.from(png), mime = "image/png";
    if (kind === "truncated") bytes = bytes.subarray(0, 30);
    if (kind === "crc") bytes[29] ^= 1;
    if (kind === "unsupported-header") bytes = mapPng(png, (type, data) => { const copy = Buffer.from(data); if (type === "IHDR") copy[9] = 6; return copy; });
    if (kind === "unsupported-mime") mime = "image/gif";
    if (kind === "oversized") bytes = Buffer.alloc(1_048_577);
    if (kind === "malformed-sof") { mime = "image/jpeg"; bytes = mapJpeg(jpeg, (marker, data) => [192, 194].includes(marker) ? data.subarray(0, 5) : data); }
    try {
      expect(await compare(bytes, mime, false)).toMatchObject({ verdict: "inconclusive", encodedDimensions: null, metrics: null });
    } finally { bytes.fill(0); }
  });
it.each([-1, 0x100000000, 1.5, NaN, Infinity])("does not report an invalid dimension %s", width => {
  expect(new ImageComparisonError("geometry", { width, height: 600 }).encodedDimensions).toBeNull();
});
it("copies only bounded numeric dimensions from a geometry error", () => {
  const dimensions = { width: 600, height: 500, privateMetadata: "must not be reported" };
  const error = new ImageComparisonError("geometry", dimensions);
  dimensions.width = 1;
  expect(error.encodedDimensions).toEqual({ width: 600, height: 500 });
  expect(Object.isFrozen(error.encodedDimensions)).toBe(true);
  expect(new ImageComparisonError("decode", dimensions).encodedDimensions).toBeNull();
});
