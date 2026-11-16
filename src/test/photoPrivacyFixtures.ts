import { readFileSync } from "node:fs";
import sharp from "sharp";

export const privacyFixture = (name: string) => readFileSync(new URL("./fixtures/photo-privacy/" + name, import.meta.url));
export function jpegSegment(marker: number, data: Buffer) {
  const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(data.length + 2, 2); return Buffer.concat([header, data]);
}
export function mapJpeg(bytes: Buffer, change: (marker: number, data: Buffer) => Buffer | null) {
  const parts = [bytes.subarray(0, 2)]; let p = 2;
  while (p < bytes.length) {
    if (bytes[p] !== 255) throw new Error("Invalid generated fixture.");
    const marker = bytes[p + 1], size = bytes.readUInt16BE(p + 2);
    if (marker === 218) { parts.push(bytes.subarray(p)); break; }
    const replacement = change(marker, bytes.subarray(p + 4, p + 2 + size));
    if (replacement) parts.push(jpegSegment(marker, replacement)); p += size + 2;
  }
  return Buffer.concat(parts);
}
export function orientationJpeg(value: number, xmp = value) {
  return mapJpeg(privacyFixture("metadata.jpg"), (marker, data) => {
    const result = Buffer.from(data);
    if (marker === 225 && data.toString("ascii", 0, 6) === "Exif\0\0") {
      const tiff = result.subarray(6), offset = tiff.readUInt32LE(4), count = tiff.readUInt16LE(offset);
      for (let i = 0; i < count; i++) if (tiff.readUInt16LE(offset + 2 + i * 12) === 274) tiff.writeUInt16LE(value, offset + 10 + i * 12);
    } else if (marker === 225) return Buffer.from(data.toString().replace(/tiff:Orientation="\d+"/, 'tiff:Orientation="' + xmp + '"'));
    return result;
  });
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
export function pngChunk(type: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  let value = 0xffffffff; for (const b of result.subarray(4, -4)) value = crcTable[(value ^ b) & 255] ^ value >>> 8;
  result.writeUInt32BE((value ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
export function mapPng(bytes: Buffer, change: (type: string, data: Buffer) => Buffer | null) {
  const parts = [bytes.subarray(0, 8)]; let p = 8;
  while (p < bytes.length) {
    const size = bytes.readUInt32BE(p), type = bytes.toString("ascii", p + 4, p + 8);
    const result = change(type, bytes.subarray(p + 8, p + 8 + size)); if (result) parts.push(pngChunk(type, result)); p += size + 12;
  }
  return Buffer.concat(parts);
}
export function extraPng(bytes: Buffer, type: string, data: Buffer) {
  return Buffer.concat([bytes.subarray(0, 33), pngChunk(type, data), bytes.subarray(33)]);
}
export const alphaPng = () => mapPng(privacyFixture("alpha.png"), (type, data) => type === "vpAg" ? null : data);
export async function solidPng(width = 500, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: "#446688" } }).png().toBuffer();
}
export function metadataBudgetJpeg(target: number) {
  const original = privacyFixture("metadata.jpg"); let existing = 0;
  mapJpeg(original, (marker, data) => { if (marker >= 224 || marker === 254) existing += data.length + 4; return data; });
  let remaining = target - existing; const parts: Buffer[] = [];
  while (remaining) {
    let size = Math.min(65537, remaining); if (remaining - size > 0 && remaining - size < 4) size -= 4;
    if (size < 4) throw new Error("Invalid generated metadata budget.");
    parts.push(jpegSegment(254, Buffer.alloc(size - 4, 65))); remaining -= size;
  }
  return Buffer.concat([original.subarray(0, 2), ...parts, original.subarray(2)]);
}
