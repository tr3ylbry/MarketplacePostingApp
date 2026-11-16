import { createHash } from "node:crypto";
import { MAX_IMAGE_BYTES } from "../../../domain/listingImage";
import { MAX_EXPORT_IMAGE_PIXELS, MAX_EXPORT_IMAGE_SIDE, MIN_EXPORT_IMAGE_LONG_SIDE } from "../../../application/ebayPrivateImages";
import { MAX_PHOTO_METADATA_BYTES, PhotoDerivativeError } from "../../../application/photoDerivative";
import { exifOrientation } from "./exifOrientation";
import { xmpOrientation } from "./xmpOrientation";

const invalid = (): never => { throw new PhotoDerivativeError("invalid"); };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
// Exact 480-byte built-in profiles shipped by pinned Sharp/libvips, not an
// arbitrary "looks like RGB" ICC parser. Other otherwise-valid profiles fail.
const JPEG_PROFILE_DIGESTS = new Set([
  "c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353", // sRGB
  "231752984cd4a5278e1b8d2390fe496767d4511fc81f54e1a5c69ae9ab4c42b5", // Display P3
]);
export function encodedBudget(bytes: Buffer) { if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) invalid(); }
export function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > MAX_EXPORT_IMAGE_SIDE ||
    height > MAX_EXPORT_IMAGE_SIDE || width * height > MAX_EXPORT_IMAGE_PIXELS || Math.max(width, height) < MIN_EXPORT_IMAGE_LONG_SIDE) invalid();
}
type Segment = { marker: number; data: Buffer };
// Frame and entropy boundaries are checked independently of the native codec.
export function jpegSegments(bytes: Buffer): Segment[] {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) invalid();
  const result: Segment[] = []; let p = 2, scanned = false;
  while (p < bytes.length) {
    if (result.length >= 4096 || bytes[p++] !== 255) invalid();
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 217) { if (!scanned || p !== bytes.length) invalid(); return result; }
    if (![192, 193, 194, 196, 219, 221, 218, 254].includes(marker) && !(marker >= 224 && marker <= 239) || p + 2 > bytes.length) invalid();
    const size = bytes.readUInt16BE(p); if (size < 2 || p + size > bytes.length) invalid();
    const data = bytes.subarray(p + 2, p + size); result.push({ marker, data }); p += size;
    if (marker !== 218) continue;
    if (data.length < 6 || data[0] < 1 || data[0] > 3 || data.length !== 4 + 2 * data[0]) invalid();
    scanned = true;
    while (p < bytes.length) {
      if (bytes[p] !== 255) { p++; continue; }
      const start = p++;
      while (bytes[p] === 255) p++;
      if (bytes[p] === 0 || bytes[p] >= 208 && bytes[p] <= 215) { p++; continue; }
      p = start; break;
    }
  }
  return invalid();
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
function crc(bytes: Buffer) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
export function pngChunks(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid();
  const chunks: { type: string; data: Buffer; encoded: Buffer }[] = []; let p = 8, dataEnded = false, seenData = false;
  while (p + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(p), type = bytes.toString("latin1", p + 4, p + 8);
    if (chunks.length >= 4096 || size > bytes.length - p - 12 || !/^[A-Za-z]{4}$/.test(type) ||
      crc(bytes.subarray(p + 4, p + 8 + size)) !== bytes.readUInt32BE(p + 8 + size)) invalid();
    if (chunks.length === 0 && type !== "IHDR" || chunks.length > 0 && type === "IHDR") invalid();
    if (type === "IDAT" && dataEnded) invalid();
    if (type !== "IDAT" && seenData) dataEnded = true;
    if (type === "IDAT") seenData = true;
    chunks.push({ type, data: bytes.subarray(p + 8, p + 8 + size), encoded: bytes.subarray(p, p + 12 + size) }); p += 12 + size;
    if (type === "IEND") { if (size || p !== bytes.length || !seenData) invalid(); return chunks; }
  }
  return invalid();
}
function iptc(bytes: Buffer) {
  if (!bytes.subarray(0, 14).equals(Buffer.from("Photoshop 3.0\0"))) invalid();
  let p = 14, resources = 0;
  while (p < bytes.length) {
    if (++resources > 64 || p + 12 > bytes.length || bytes.toString("ascii", p, p + 4) !== "8BIM" || bytes.readUInt16BE(p + 4) !== 0x0404) invalid();
    p += 6; const name = bytes[p] + 1; p += name + name % 2;
    if (p + 4 > bytes.length) invalid(); const length = bytes.readUInt32BE(p); p += 4;
    if (length > bytes.length - p) invalid(); const end = p + length;
    while (p < end) {
      if (p + 5 > end || bytes[p] !== 0x1c || ![1, 2].includes(bytes[p + 1])) invalid();
      const n = bytes.readUInt16BE(p + 3); if (n & 0x8000 || n > end - p - 5) invalid(); p += 5 + n;
    }
    p += length % 2; if (p > bytes.length) invalid();
  }
}
export function classifyPhoto(bytes: Buffer, contentType: string) {
  encodedBudget(bytes);
  let metadataBytes = 0;
  const metadata = (n: number) => { metadataBytes += n; if (metadataBytes > MAX_PHOTO_METADATA_BYTES) invalid(); };
  if (contentType === "image/png") {
    const chunks = pngChunks(bytes), header = chunks[0].data, unique = new Set<string>();
    if (header.length !== 13 || header[8] !== 8 || ![0, 2, 4, 6].includes(header[9]) || header[10] || header[11] || header[12] > 1) invalid();
    const width = header.readUInt32BE(0), height = header.readUInt32BE(4); dimensions(width, height);
    let seenData = false;
    for (const chunk of chunks.slice(1)) {
      const { type, data } = chunk;
      if (type === "IDAT") { seenData = true; continue; } if (type === "IEND") continue;
      metadata(chunk.encoded.length);
      if (!["tEXt", "pHYs", "sRGB", "gAMA", "cHRM", "tRNS"].includes(type) || seenData) invalid();
      if (type !== "tEXt" && unique.has(type)) invalid(); unique.add(type);
      if (type === "tEXt") {
        const end = data.indexOf(0), keyword = data.subarray(0, end);
        if (end < 1 || end > 79 || keyword[0] === 32 || keyword[keyword.length - 1] === 32 || keyword.some(v => v < 32 || v > 126 && v < 161) ||
          / {2}/.test(keyword.toString("latin1")) || data.subarray(end + 1).includes(0)) invalid();
      }
      if (type === "pHYs" && (data.length !== 9 || data[8] > 1)) invalid();
      if (type === "sRGB" && (data.length !== 1 || data[0] > 3)) invalid();
      if (type === "gAMA" && (data.length !== 4 || data.readUInt32BE(0) !== 45455)) invalid();
      if (type === "cHRM" && (data.length !== 32 || [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000].some((v, i) => data.readUInt32BE(i * 4) !== v))) invalid();
      if (type === "tRNS" && (header[9] !== 0 && header[9] !== 2 || data.length !== (header[9] === 0 ? 2 : 6) ||
        Array.from({ length: data.length / 2 }, (_, i) => data.readUInt16BE(i * 2)).some(v => v > 255))) invalid();
    }
    if ((unique.has("gAMA") || unique.has("cHRM")) && !unique.has("sRGB")) invalid();
    return { width, height, orientation: 1, profileDigest: null, metadataBytes };
  }
  if (contentType !== "image/jpeg") invalid();
  const segments = jpegSegments(bytes), frames = segments.filter(s => [192, 193, 194].includes(s.marker));
  if (frames.length !== 1) invalid(); const frame = frames[0].data;
  if (frame.length < 6 || frame[0] !== 8 || ![1, 3].includes(frame[5]) || frame.length !== 6 + frame[5] * 3) invalid();
  const width = frame.readUInt16BE(3), height = frame.readUInt16BE(1); dimensions(width, height);
  let exif: number | null = null, xmp: number | null = null, colorSpace: number | null = null, srgbInterop = false;
  let seenExif = false, seenXmp = false, seenJfif = false, seenIptc = false;
  const profiles = new Map<number, Buffer>(); let profileCount = 0;
  for (const { marker, data } of segments) {
    if (marker < 224 && marker !== 254) continue; metadata(data.length + 4);
    if (marker === 254) continue;
    if (marker === 224 && !seenJfif && data.toString("latin1", 0, 5) === "JFIF\0") {
      if (data.length < 14 || data[5] !== 1 || data[6] > 2 || data[7] > 2 || data.length !== 14 + 3 * data[12] * data[13]) invalid();
      seenJfif = true; continue;
    }
    if (marker === 225 && data.toString("latin1", 0, 6) === "Exif\0\0" && !seenExif) {
      seenExif = true;
      const parsed = exifOrientation(data.subarray(6), b => {
        const frames = jpegSegments(b).filter(s => [192, 193, 194].includes(s.marker));
        if (frames.length !== 1 || frames[0].data.length < 6 || frames[0].data[0] !== 8) invalid();
      });
      exif = parsed.orientation; colorSpace = parsed.colorSpace; srgbInterop = parsed.srgbInterop; continue;
    }
    const xmpHeader = "http://ns.adobe.com/xap/1.0/\0";
    if (marker === 225 && data.subarray(0, xmpHeader.length).equals(Buffer.from(xmpHeader)) && !seenXmp) {
      seenXmp = true; xmp = xmpOrientation(data.subarray(xmpHeader.length)); continue;
    }
    if (marker === 226 && data.toString("latin1", 0, 12) === "ICC_PROFILE\0" && data.length > 14) {
      const sequence = data[12], count = data[13];
      if (!sequence || sequence > count || count > 16 || profileCount && profileCount !== count || profiles.has(sequence)) invalid();
      profileCount = count; profiles.set(sequence, data.subarray(14)); continue;
    }
    if (marker === 237 && !seenIptc) { seenIptc = true; iptc(data); continue; }
    invalid();
  }
  if (xmp !== null && (exif === null ? xmp !== 1 : xmp !== exif)) invalid();
  let profileDigest: string | null = null;
  if (profileCount) {
    if (profiles.size !== profileCount) invalid();
    profileDigest = hash(Buffer.concat(Array.from({ length: profileCount }, (_, i) => profiles.get(i + 1)!)));
    if (!JPEG_PROFILE_DIGESTS.has(profileDigest)) invalid();
  }
  if (colorSpace === 65535 && !profileDigest || (colorSpace === 1 || srgbInterop) && profileDigest &&
    profileDigest !== "c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353") invalid();
  return { width, height, orientation: exif ?? 1, profileDigest, metadataBytes };
}

// Only pHYs emitted by this pinned encoder may be removed; unexpected output
// chunks fail rather than being silently blessed as safe. JPEG copies no APPs.
export function finalContainer(encoded: Buffer, contentType: string): Buffer {
  encodedBudget(encoded);
  if (contentType === "image/jpeg") {
    const segments = jpegSegments(encoded);
    if (segments.some(s => ![192, 196, 219, 221, 218].includes(s.marker))) invalid();
    const frames = segments.filter(s => s.marker === 192);
    if (frames.length !== 1 || frames[0].data[5] !== 3 || frames[0].data.length !== 15 ||
      [0, 1, 2].some(i => frames[0].data[7 + 3 * i] !== 0x11)) invalid();
    return encoded;
  }
  if (contentType !== "image/png") invalid(); const chunks = pngChunks(encoded);
  if (chunks.some(c => !["IHDR", "pHYs", "IDAT", "IEND"].includes(c.type)) || chunks.filter(c => c.type === "pHYs").length > 1 ||
    chunks.some(c => c.type === "pHYs" && c.data.length !== 9)) invalid();
  const result = Buffer.concat([encoded.subarray(0, 8), ...chunks.filter(c => c.type !== "pHYs").map(c => c.encoded)]);
  classifyPhoto(result, "image/png"); return result;
}
