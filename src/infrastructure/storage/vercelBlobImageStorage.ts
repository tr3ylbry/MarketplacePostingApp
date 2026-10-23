import { del, get, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { blobImageSourceSchema } from "../../domain/listingImage";
import { ImageOperationError, matchesImageHeader, READ_TTL_MS, PROVIDER_READ_TTL_MS, type ProviderImageAccess, type ImageStorage, type ImageUpload } from "../../application/imageStorage";

// Credentials are resolved server-side by the SDK: OIDC + BLOB_STORE_ID preferred.
// This module is only wired through application/server (server-only).
export class VercelBlobImageStorage implements ImageStorage {
  async prepareUpload(upload: ImageUpload) {
    const scope = { pathname: upload.pathname, validUntil: Date.parse(upload.expiresAt),
      allowedContentTypes: [upload.contentType], maximumSizeInBytes: upload.size };
    const token = await issueSignedToken({ ...scope, operations: ["put"], abortSignal: AbortSignal.timeout(15000) });
    const { presignedUrl } = await presignUrl(token, { ...scope, operation: "put", access: "private",
      allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60 });
    return presignedUrl;
  }

  async verifyUpload(upload: ImageUpload) {
    const metadata = await head(upload.pathname, { abortSignal: AbortSignal.timeout(15000) });
    if (metadata.pathname !== upload.pathname || metadata.size !== upload.size || metadata.contentType !== upload.contentType) {
      throw new ImageOperationError("Uploaded image does not match its declared type or size.");
    }
    const result = await get(upload.pathname, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15000) });
    if (!result || result.statusCode !== 200) throw new ImageOperationError("Uploaded image is unavailable.");
    const reader = result.stream.getReader();
    const header = new Uint8Array(12);
    let length = 0;
    try {
      while (length < header.length) {
        const { value, done } = await reader.read();
        if (done) break;
        const part = value.subarray(0, header.length - length);
        header.set(part, length); length += part.length;
      }
    } finally { await reader.cancel(); }
    if (!matchesImageHeader(header.subarray(0, length), upload.contentType)) throw new ImageOperationError("The uploaded file is not a supported image.");
    return blobImageSourceSchema.parse({ kind: "vercel-blob", pathname: upload.pathname,
      originalFilename: upload.filename, contentType: metadata.contentType, size: metadata.size, uploadedAt: metadata.uploadedAt.toISOString() });
  }

  async createReadAccess(pathname: string) {
    return this.signRead(pathname, READ_TTL_MS);
  }
  async createProviderReadAccess(pathname: string) { return this.signRead(pathname, PROVIDER_READ_TTL_MS); }
  private async signRead(pathname: string, ttl: number) {
    const validUntil = Date.now() + ttl;
    const token = await issueSignedToken({ pathname, operations: ["get"], validUntil, abortSignal: AbortSignal.timeout(15000) });
    return (await presignUrl(token, { pathname, operation: "get", access: "private", validUntil, useCache: false })).presignedUrl;
  }

  async deleteObject(pathname: string) { await del(pathname, { abortSignal: AbortSignal.timeout(15000) }); }
}

export const imageStorage: ImageStorage & ProviderImageAccess = new VercelBlobImageStorage();
