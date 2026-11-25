import { del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { blobImageSourceSchema } from "../../domain/listingImage";
import { ImageOperationError, imagePathname, matchesImageHeader, READ_TTL_MS, PROVIDER_READ_TTL_MS, uploadInputSchema, type ProviderImageSigner, type ImageStorage, type ImageUpload } from "../../application/imageStorage";
import { PrivateImagePreparationError, type PrivateImageReader } from "../../application/ebayPrivateImages";
import { collectPrivateImage } from "./readPrivateImage";

// Resolve configured credentials ourselves; the SDK's implicit OIDC path can
// read CLI credentials or refresh before trying its static-token fallback.
// This module is only wired through application/server (server-only).
export class VercelBlobImageStorage implements ImageStorage, PrivateImageReader {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  private credentials() {
    const valid = (value: string | undefined): value is string => !!value && value.length <= 16000 && !/[^\x21-\x7e]/.test(value);
    const { VERCEL_OIDC_TOKEN: oidcToken, BLOB_STORE_ID: storeId, BLOB_READ_WRITE_TOKEN: token } = this.env;
    const normalizedStore = storeId?.replace(/^store_/, "");
    if (valid(oidcToken) && storeId && normalizedStore && /^[A-Za-z0-9_-]{1,100}$/.test(normalizedStore)) return { oidcToken, storeId };
    if (valid(token)) return { token };
    throw new ImageOperationError("Private image storage is unavailable. Ask the operator to check its configuration.");
  }
  async readPrivateImage(source: Parameters<PrivateImageReader["readPrivateImage"]>[0], signal: AbortSignal) {
    const trusted = blobImageSourceSchema.parse(source);
    signal.throwIfAborted();
    const result = await get(trusted.pathname, { ...this.credentials(), access: "private", useCache: false, abortSignal: signal });
    if (!result || result.statusCode !== 200) throw new PrivateImagePreparationError("invalid");
    return collectPrivateImage(trusted, { ...result.blob, stream: result.stream }, signal);
  }
  async prepareUpload(upload: ImageUpload) {
    const scope = { pathname: upload.pathname, validUntil: Date.parse(upload.expiresAt),
      allowedContentTypes: [upload.contentType], maximumSizeInBytes: upload.size };
    const token = await issueSignedToken({ ...this.credentials(), ...scope, operations: ["put"], abortSignal: AbortSignal.timeout(15000) });
    const { presignedUrl } = await presignUrl(token, { ...scope, operation: "put", access: "private",
      allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60 });
    return presignedUrl;
  }

  // Internal generated-only operator setup. The dedicated process must disable
  // the SDK's environment-controlled retries before this method is reachable.
  // No ambient environment mutation, multipart fallback or returned-URL use.
  async writeGeneratedFixture(upload: ImageUpload, bytes: Buffer, signal: AbortSignal) {
    signal.throwIfAborted();
    const input = uploadInputSchema.parse({ filename: upload.filename, contentType: upload.contentType, size: upload.size });
    if (process.env.VERCEL_BLOB_RETRIES !== "0" || input.filename !== "generated.png" || input.contentType !== "image/png" ||
      bytes.length !== input.size || bytes.length > 1_048_576 || !matchesImageHeader(bytes, "image/png") ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(upload.id) ||
      upload.pathname !== imagePathname(upload.id, input) || !(Date.parse(upload.expiresAt) > Date.now())) throw new ImageOperationError("Generated image setup is unavailable.");
    await put(upload.pathname, bytes, { ...this.credentials(), access: "private", contentType: "image/png", addRandomSuffix: false,
      allowOverwrite: false, multipart: false, maximumSizeInBytes: input.size, cacheControlMaxAge: 60,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    signal.throwIfAborted();
  }

  async verifyUpload(upload: ImageUpload, signal = AbortSignal.timeout(15_000)) {
    signal.throwIfAborted();
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const credentials = this.credentials();
    const metadata = await head(upload.pathname, { ...credentials, abortSignal: bounded });
    bounded.throwIfAborted();
    if (metadata.pathname !== upload.pathname || metadata.size !== upload.size || metadata.contentType !== upload.contentType) {
      throw new ImageOperationError("Uploaded image does not match its declared type or size.");
    }
    const result = await get(upload.pathname, { ...credentials, access: "private", useCache: false, abortSignal: bounded });
    bounded.throwIfAborted();
    if (!result || result.statusCode !== 200) throw new ImageOperationError("Uploaded image is unavailable.");
    const reader = result.stream.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    bounded.addEventListener("abort", cancel, { once: true });
    const header = new Uint8Array(12);
    let length = 0;
    try {
      while (length < header.length) {
        const { value, done } = await reader.read();
        bounded.throwIfAborted();
        if (done) break;
        const part = value.subarray(0, header.length - length);
        header.set(part, length); length += part.length;
      }
    } finally { bounded.removeEventListener("abort", cancel); await reader.cancel(); reader.releaseLock(); }
    if (!matchesImageHeader(header.subarray(0, length), upload.contentType)) throw new ImageOperationError("The uploaded file is not a supported image.");
    return blobImageSourceSchema.parse({ kind: "vercel-blob", pathname: upload.pathname,
      originalFilename: upload.filename, contentType: metadata.contentType, size: metadata.size, uploadedAt: metadata.uploadedAt.toISOString() });
  }

  async createReadAccess(pathname: string) {
    return this.signRead(pathname, Date.now() + READ_TTL_MS);
  }
  async signProviderReadAccess(pathname: string, validUntil: number) {
    if (!Number.isFinite(validUntil) || validUntil <= Date.now() || validUntil > Date.now() + PROVIDER_READ_TTL_MS) throw new ImageOperationError("Provider image access expired or is invalid.");
    return this.signRead(pathname, validUntil);
  }
  private async signRead(pathname: string, validUntil: number) {
    const token = await issueSignedToken({ ...this.credentials(), pathname, operations: ["get"], validUntil, abortSignal: AbortSignal.timeout(15000) });
    return (await presignUrl(token, { pathname, operation: "get", access: "private", validUntil, useCache: false })).presignedUrl;
  }

  async deleteObject(pathname: string) { await del(pathname, { ...this.credentials(), abortSignal: AbortSignal.timeout(15000) }); }
}

export const imageStorage: ImageStorage & ProviderImageSigner & PrivateImageReader = new VercelBlobImageStorage();
