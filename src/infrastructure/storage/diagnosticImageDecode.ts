import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { IMAGE_COMPARISON as policy, ImageComparisonError } from "../../application/imageComparison";
import { jpegSegments, pngChunks } from "./photoDerivative/photoContainer";
import { exifOrientation } from "./photoDerivative/exifOrientation";

const srgb = "c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353";
const digest = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const refuse = (): never => { throw new ImageComparisonError("unsupported"); };
function geometry(width: number, height: number) {
  if (width !== policy.width || height !== policy.height) throw new ImageComparisonError("geometry", { width, height });
}
// Framing helpers are shared, not the local derivative's metadata/encoder
// allowlist. Provider responses may have standard metadata/progressive scans.
export function inspectDiagnosticContainer(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > policy.encodedBytes) refuse();
  let metadata = 0;
  const budget = (n: number) => { metadata += n; if (metadata > policy.metadataBytes) refuse(); };
  if (mime === "image/png") {
    const chunks = pngChunks(bytes), h = chunks[0].data, seen = new Set<string>();
    if (chunks.length > policy.chunks || h.length !== 13 || h[8] !== 8 || h[9] !== 2 || h[10] || h[11] || h[12] > 1) refuse();
    geometry(h.readUInt32BE(0), h.readUInt32BE(4));
    for (const { type, data, encoded } of chunks.slice(1)) {
      if (type === "IDAT" || type === "IEND") continue;
      budget(encoded.length);
      if (!["pHYs", "sRGB", "gAMA", "cHRM", "tEXt", "tIME"].includes(type) || type !== "tEXt" && seen.has(type)) refuse();
      seen.add(type);
      if (type === "pHYs" && (data.length !== 9 || data[8] > 1)) refuse();
      if (type === "sRGB" && (data.length !== 1 || data[0] > 3)) refuse();
      if (type === "gAMA" && (data.length !== 4 || data.readUInt32BE(0) !== 45455)) refuse();
      if (type === "cHRM" && (data.length !== 32 || [31270,32900,64000,33000,30000,60000,15000,6000].some((v,i) => data.readUInt32BE(i*4) !== v))) refuse();
      if (type === "tEXt" && (!/^(Comment|Software)\0/.test(data.toString("latin1")) || data.subarray(data.indexOf(0) + 1).includes(0))) refuse();
      if (type === "tIME" && data.length !== 7) refuse();
    }
    if ((seen.has("gAMA") || seen.has("cHRM")) && !seen.has("sRGB")) refuse();
    return "png" as const;
  }
  if (mime !== "image/jpeg") refuse();
  const segments = jpegSegments(bytes), frames = segments.filter(s => [192,193,194].includes(s.marker));
  if (segments.length > policy.chunks || frames.length !== 1 || ![192,194].includes(frames[0].marker)) refuse();
  const h = frames[0].data;
  if (h.length !== 15 || h[0] !== 8 || h[5] !== 3) refuse();
  geometry(h.readUInt16BE(3), h.readUInt16BE(1));
  let exif = false, jfif = false, count = 0;
  const profiles = new Map<number, Buffer>();
  for (const { marker, data } of segments) {
    if (marker < 224 && marker !== 254) continue;
    budget(data.length + 4);
    if (marker === 254) continue;
    if (marker === 224 && !jfif && data.toString("latin1",0,5) === "JFIF\0") {
      jfif = true;
      if (data.length < 14 || data[5] !== 1 || data[6] > 2 || data[7] > 2 || data.length !== 14 + 3*data[12]*data[13]) refuse();
    } else if (marker === 225 && !exif && data.toString("latin1",0,6) === "Exif\0\0") {
      exif = true; const parsed = exifOrientation(data.subarray(6), thumbnail => { jpegSegments(thumbnail); });
      if (parsed.orientation !== 1 || parsed.colorSpace !== null && parsed.colorSpace !== 1) refuse();
    } else if (marker === 226 && data.toString("latin1",0,12) === "ICC_PROFILE\0" && data.length > 14) {
      const n=data[12], total=data[13];
      if (!n || n>total || total>16 || count && total!==count || profiles.has(n)) refuse();
      count=total; profiles.set(n,data.subarray(14));
    } else refuse();
  }
  if (count && (profiles.size !== count || digest(Buffer.concat(Array.from({length:count},(_,i)=>profiles.get(i+1)!))) !== srgb)) refuse();
  return "jpeg" as const;
}

export const IMAGE_COMPARISON_RECIPE = `${policy.version};sharp=${sharp.versions.sharp};vips=${sharp.versions.vips};lcms=${sharp.versions.lcms};exact-500x600;rgb8;no-resize-orient-search;mae8;rmse16;tile22;anchor10;cue6-marker144-exact-margin72`;
export async function decodeDiagnosticImage(input: Uint8Array, mime: string, check: () => void, remainingMs: () => number, signal: AbortSignal): Promise<Buffer> {
  check(); if (!input?.length || input.length > policy.encodedBytes) refuse();
  const bytes = Buffer.from(input); let image: ReturnType<typeof sharp> | undefined, raw: Buffer | undefined;
  const timeout = () => { check(); const seconds = Math.floor(Math.min(policy.processingMs,remainingMs())/1000); if (seconds < 1) throw new ImageComparisonError("deadline"); return seconds; };
  try {
    const format = inspectDiagnosticContainer(bytes,mime); check();
    image = sharp(bytes, { failOn:"warning",limitInputPixels:policy.width*policy.height,limitInputChannels:3,sequentialRead:true,unlimited:false,animated:false }).timeout({seconds:timeout()});
    // Do not race/release on destroy or stream close. Native callback promise
    // settlement owns these bytes and capacity, even after cancellation.
    const m = await image.metadata(); check();
    if (m.format !== format || m.width !== policy.width || m.height !== policy.height || m.depth !== "uchar" || m.space !== "srgb" || m.channels !== 3 || m.hasAlpha ||
      (m.pages ?? 1) !== 1 || m.gainMap || (m.orientation ?? 1) !== 1 || m.xmp || m.iptc || m.icc && digest(m.icc) !== srgb) refuse();
    const decoded = await image.toColourspace("srgb").timeout({seconds:timeout()}).raw({depth:"uchar"}).toBuffer({resolveWithObject:true});
    raw=decoded.data; check();
    if (decoded.info.width !== policy.width || decoded.info.height !== policy.height || decoded.info.channels !== 3 || raw.length !== policy.width*policy.height*3) refuse();
    const output=raw;raw=undefined;return output;
  } catch(error) {
    if (error instanceof ImageComparisonError) throw error;
    throw new ImageComparisonError(signal.aborted ? "cancelled" : "decode");
  } finally { raw?.fill(0);image?.destroy();bytes.fill(0); }
}
