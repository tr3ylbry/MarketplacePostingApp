import { PhotoDerivativeError } from "../../../application/photoDerivative";

// Deliberately bounded classic TIFF/EXIF, not a general metadata framework.
// Maker-note/identity values are never interpreted, copied or returned.
export function exifOrientation(bytes: Buffer, thumbnail: (bytes: Buffer) => void) {
  const invalid = (): never => { throw new PhotoDerivativeError("invalid"); };
  const little = bytes.toString("latin1", 0, 2) === "II";
  if (!little && bytes.toString("latin1", 0, 2) !== "MM") invalid();
  const range = (offset: number, size: number) => { if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length) invalid(); };
  const u16 = (p: number) => { range(p, 2); return little ? bytes.readUInt16LE(p) : bytes.readUInt16BE(p); };
  const u32 = (p: number) => { range(p, 4); return little ? bytes.readUInt32LE(p) : bytes.readUInt32BE(p); };
  if (u16(2) !== 42) invalid();
  const used: [number, number][] = [[0, 8]];
  const claim = (p: number, n: number) => {
    range(p, n); if (p % 2 || used.some(([start, end]) => p < end && p + n > start)) invalid(); used.push([p, p + n]);
  };
  let entries = 0, orientation: number | null = null, colorSpace: number | null = null, srgbInterop = false;
  function ifd(offset: number, kind: "main" | "exif" | "gps" | "interop" | "thumbnail", depth = 0) {
    if (depth > 3 || !offset) invalid();
    const count = u16(offset); entries += count;
    if (count > 256 || entries > 1024) invalid();
    claim(offset, 2 + count * 12 + 4);
    const tags = new Map<number, { type: number; count: number; data: number }>();
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12, tag = u16(p), type = u16(p + 2), n = u32(p + 4);
      const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      if (tags.has(tag) || !sizes[type] || !n || n > bytes.length / sizes[type]) invalid();
      const length = sizes[type] * n, data = length <= 4 ? p + 8 : u32(p + 8);
      if (length > 4) claim(data, length);
      range(data, length); tags.set(tag, { type, count: n, data });
      if (type === 2 && (bytes[data + length - 1] !== 0 || bytes.subarray(data, data + length).some(v => v > 127))) invalid();
      if (type === 5 || type === 10) for (let j = 0; j < n; j++) if (u32(data + 8 * j + 4) === 0) invalid();
      if (tag === 274) {
        if (kind !== "main" || type !== 3 || n !== 1 || u16(data) < 1 || u16(data) > 8) invalid();
        orientation = u16(data);
      }
      if (tag === 40961) {
        if (kind !== "exif" || type !== 3 || n !== 1 || ![1, 65535].includes(u16(data))) invalid();
        colorSpace = u16(data);
      }
      if (kind === "interop" && tag === 1) {
        if (type !== 2 || bytes.toString("latin1", data, data + length) !== "R98\0") invalid();
        srgbInterop = true;
      }
      // Uncompressed/multi-image TIFF or nested XMP is not this EXIF subset.
      if ([262, 273, 279, 301, 318, 319, 330, 700, 33723, 42240].includes(tag)) invalid();
    }
    const scalar = (tag: number, type = 4) => {
      const v = tags.get(tag); if (!v || v.type !== type || v.count !== 1) return invalid();
      return type === 3 ? u16(v.data) : u32(v.data);
    };
    for (const [tag, target, parent] of [[34665, "exif", "main"], [34853, "gps", "main"], [40965, "interop", "exif"]] as const) {
      if (tags.has(tag)) { if (kind !== parent) invalid(); ifd(scalar(tag), target, depth + 1); }
    }
    if (kind === "thumbnail") {
      if (scalar(259, 3) !== 6) invalid();
      const position = scalar(513), length = scalar(514); claim(position, length); thumbnail(bytes.subarray(position, position + length));
    } else if (tags.has(513) || tags.has(514)) invalid();
    const next = u32(offset + 2 + count * 12);
    if (next) { if (kind !== "main") invalid(); ifd(next, "thumbnail", depth + 1); }
  }
  ifd(u32(4), "main"); return { orientation, colorSpace, srgbInterop };
}
