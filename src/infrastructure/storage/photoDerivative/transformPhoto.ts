import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { MAX_EXPORT_IMAGE_PIXELS } from "../../../application/ebayPrivateImages";
import { PhotoDerivativeError, type PhotoTransformer } from "../../../application/photoDerivative";
import { classifyPhoto, dimensions, encodedBudget, finalContainer } from "./photoContainer";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const PHOTO_RECIPE = "photo-export-v1;sharp=" + sharp.versions.sharp + ";vips=" + sharp.versions.vips + ";lcms=" + sharp.versions.lcms +
  ";jpeg=95,444,baseline,huffman,qtable0;png=6,adaptive,rgba;srgb-untagged;omit-phys";
type Source = ReturnType<typeof classifyPhoto>;
type Encoder = (bytes: Buffer, contentType: string, source: Source, signal: AbortSignal, deadline: number) => Promise<Buffer>;

function eligible(signal: AbortSignal, deadline: number) {
  if (signal.aborted || performance.now() >= deadline) throw new PhotoDerivativeError("aborted");
}
function seconds(signal: AbortSignal, deadline: number) {
  eligible(signal, deadline);
  const remaining = Math.min(10, Math.floor((deadline - performance.now()) / 1000));
  if (remaining < 1) throw new PhotoDerivativeError("aborted");
  return remaining;
}
async function decoder<T>(bytes: Buffer, signal: AbortSignal, deadline: number, operation: (image: ReturnType<typeof sharp>) => Promise<T>) {
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_EXPORT_IMAGE_PIXELS, limitInputChannels: 4, sequentialRead: true })
    .timeout({ seconds: seconds(signal, deadline) });
  const cancel = () => image.destroy(); signal.addEventListener("abort", cancel, { once: true });
  try { eligible(signal, deadline); const result = await operation(image); eligible(signal, deadline); return result; }
  finally { signal.removeEventListener("abort", cancel); image.destroy(); }
}
const encode: Encoder = (bytes, contentType, source, signal, deadline) => decoder(bytes, signal, deadline, async image => {
  const m = await image.metadata(); eligible(signal, deadline);
  if (m.format !== (contentType === "image/jpeg" ? "jpeg" : "png") || m.width !== source.width || m.height !== source.height ||
    m.depth !== "uchar" || !["srgb", "b-w"].includes(m.space ?? "") || (m.channels ?? 5) > 4 || (m.pages ?? 1) !== 1 || m.gainMap ||
    (m.orientation ?? 1) !== source.orientation || (m.icc ? digest(m.icc) : null) !== source.profileDigest) throw new PhotoDerivativeError("invalid");
  const output = image.autoOrient().toColourspace("srgb").timeout({ seconds: seconds(signal, deadline) });
  return contentType === "image/jpeg"
    ? output.jpeg({ quality: 95, chromaSubsampling: "4:4:4", progressive: false, optimiseCoding: true, mozjpeg: false,
      trellisQuantisation: false, overshootDeringing: false, optimiseScans: false, quantisationTable: 0 }).toBuffer()
    : output.png({ compressionLevel: 6, adaptiveFiltering: true, palette: false, progressive: false }).toBuffer();
});

export function createPhotoTransformer(encoder: Encoder = encode): PhotoTransformer {
  return {
    async transform(bytes, contentType, signal, deadline) {
      try {
        eligible(signal, deadline); const source = classifyPhoto(bytes, contentType); eligible(signal, deadline);
        const sourceDigest = digest(bytes);
        const encoded = await encoder(bytes, contentType, source, signal, deadline); eligible(signal, deadline);
        // Independently framed, allowlisted container; pHYs is deliberately
        // omitted before verifying/hashing the exact final export buffer.
        const output = finalContainer(encoded, contentType); encodedBudget(output);
        const width = source.orientation >= 5 ? source.height : source.width;
        const height = source.orientation >= 5 ? source.width : source.height; dimensions(width, height);
        await decoder(output, signal, deadline, async image => {
          const m = await image.metadata(); eligible(signal, deadline);
          if (m.width !== width || m.height !== height || m.format !== (contentType === "image/jpeg" ? "jpeg" : "png") ||
            m.depth !== "uchar" || m.space !== "srgb" || ![3, 4].includes(m.channels ?? 0) || (m.pages ?? 1) !== 1 ||
            m.exif || m.icc || m.xmp || m.iptc || m.orientation || m.gainMap) throw new PhotoDerivativeError("invalid");
          const decoded = await image.timeout({ seconds: seconds(signal, deadline) }).raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
          eligible(signal, deadline);
          if (decoded.info.width !== width || decoded.info.height !== height ||
            decoded.info.channels !== m.channels || decoded.data.length !== width * height * m.channels || decoded.data.length > 4 * MAX_EXPORT_IMAGE_PIXELS) throw new PhotoDerivativeError("invalid");
        });
        eligible(signal, deadline);
        if (digest(bytes) !== sourceDigest) throw new PhotoDerivativeError("invalid");
        return { bytes: output, width, height, contentType: contentType as "image/jpeg" | "image/png", size: output.length,
          sourceDigest, derivativeDigest: digest(output), recipe: PHOTO_RECIPE };
      } catch (error) {
        if (error instanceof PhotoDerivativeError) throw error;
        throw new PhotoDerivativeError(signal.aborted || performance.now() >= deadline ? "aborted" : "invalid");
      }
    },
  };
}
export const photoTransformer = createPhotoTransformer();
