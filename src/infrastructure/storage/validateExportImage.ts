import sharp from "sharp";
import { MAX_IMAGE_BYTES } from "../../domain/listingImage";
import { matchesImageHeader } from "../../application/imageStorage";
import { MAX_EXPORT_IMAGE_PIXELS, MAX_EXPORT_IMAGE_SIDE, MIN_EXPORT_IMAGE_LONG_SIDE, PrivateImagePreparationError, type ExportImageValidator } from "../../application/ebayPrivateImages";

function singlePng(bytes: Buffer) {
  let offset = 8, ended = false, chunks = 0;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    // Compressed metadata can expand independently of the pixel limit. This
    // conservative subset rejects it before invoking the native decoder.
    if (++chunks > 4096 || size > bytes.length - offset - 12 || ["acTL", "iCCP", "zTXt", "iTXt", "eXIf"].includes(type)) throw new Error();
    offset += size + 12;
    if (type === "IEND") { if (size !== 0 || offset !== bytes.length) throw new Error(); ended = true; break; }
  }
  if (!ended) throw new Error();
}
function singleJpeg(bytes: Buffer) {
  let offset = 2, segments = 0, scanned = false;
  while (offset < bytes.length) {
    if (++segments > 4096 || bytes[offset++] !== 255) throw new Error();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) { if (!scanned || offset !== bytes.length) throw new Error(); return; }
    if (marker === 1) continue;
    if (!marker || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) throw new Error();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) throw new Error();
    offset += length;
    if (marker !== 218) continue;
    scanned = true;
    // Scan entropy bytes without interpreting escaped FF bytes or restart
    // markers as segment boundaries. Progressive JPEG can have more scans.
    while (offset < bytes.length) {
      if (bytes[offset] !== 255) { offset++; continue; }
      const boundary = offset++;
      while (bytes[offset] === 255) offset++;
      const next = bytes[offset];
      if (next === 0 || next >= 208 && next <= 215) { offset++; continue; }
      offset = boundary; break;
    }
  }
  throw new Error();
}
export const exportImageValidator: ExportImageValidator = {
  async validate(bytes, contentType, signal) {
    let decoder: ReturnType<typeof sharp> | undefined;
    const cancel = () => decoder?.destroy();
    try {
      signal.throwIfAborted();
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !["image/jpeg", "image/png"].includes(contentType) || !matchesImageHeader(bytes, contentType)) throw new Error();
      if (contentType === "image/png") singlePng(bytes);
      else singleJpeg(bytes);
      decoder = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_EXPORT_IMAGE_PIXELS, limitInputChannels: 4, sequentialRead: true }).timeout({ seconds: 10 });
      signal.addEventListener("abort", cancel, { once: true });
      const metadata = await decoder.metadata(); signal.throwIfAborted();
      const { width, height } = metadata;
      if (!width || !height || width > MAX_EXPORT_IMAGE_SIDE || height > MAX_EXPORT_IMAGE_SIDE || width * height > MAX_EXPORT_IMAGE_PIXELS || Math.max(width, height) < MIN_EXPORT_IMAGE_LONG_SIDE ||
        metadata.format !== (contentType === "image/png" ? "png" : "jpeg") || (metadata.pages ?? 1) !== 1 || !["srgb", "b-w"].includes(metadata.space ?? "") || (metadata.channels ?? 5) > 4 || metadata.depth !== "uchar") throw new Error();
      // Full decode detects corrupt/truncated payloads, not just valid headers.
      // RGBA output is bounded to 4 * 16 Mi pixels = 64 MiB and discarded here.
      const decoded = await decoder.raw().toBuffer({ resolveWithObject: true }); signal.throwIfAborted();
      if (decoded.info.width !== width || decoded.info.height !== height || decoded.info.channels > 4 || decoded.data.length > 4 * MAX_EXPORT_IMAGE_PIXELS) throw new Error();
      return { width, height, contentType: contentType as "image/jpeg" | "image/png", size: bytes.length };
    } catch { throw new PrivateImagePreparationError("invalid"); }
    finally { signal.removeEventListener("abort", cancel); decoder?.destroy(); }
  },
};
