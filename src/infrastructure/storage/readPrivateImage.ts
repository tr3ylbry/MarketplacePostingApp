import type { BlobImageSource } from "../../domain/listingImage";
import { blobImageSourceSchema, MAX_IMAGE_BYTES } from "../../domain/listingImage";
import { PrivateImagePreparationError } from "../../application/ebayPrivateImages";

export async function collectPrivateImage(source: BlobImageSource, result: { pathname: string; size: number; contentType: string; stream: ReadableStream<Uint8Array> }, signal: AbortSignal): Promise<Buffer> {
  const reader = result.stream.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    blobImageSourceSchema.parse(source); signal.throwIfAborted();
    if (result.pathname !== source.pathname || result.size !== source.size || result.contentType !== source.contentType || result.size > MAX_IMAGE_BYTES) throw new Error();
    const bytes = Buffer.alloc(source.size); let length = 0;
    for (;;) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      if (next.value.byteLength > bytes.length - length) throw new Error();
      bytes.set(next.value, length); length += next.value.byteLength;
    }
    if (length !== bytes.length) throw new Error();
    return bytes;
  } catch { throw new PrivateImagePreparationError("invalid"); }
  finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
