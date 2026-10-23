import { ImageOperationError, matchesImageHeader, type ImageStorage, type ImageUpload } from "../../application/imageStorage";
import type { BlobImageSource } from "../../domain/listingImage";

export class MemoryImageStorage implements ImageStorage {
  uploads = new Map<string, ImageUpload>();
  objects = new Map<string, { bytes: Uint8Array; type: string }>();
  deleted: string[] = [];
  failDelete = false;
  async prepareUpload(upload: ImageUpload) { this.uploads.set(upload.id, upload); return `https://test.invalid/put/${upload.id}`; }
  async verifyUpload(upload: ImageUpload): Promise<BlobImageSource> {
    const object = this.objects.get(upload.pathname);
    if (!object || object.bytes.length !== upload.size || object.type !== upload.contentType || !matchesImageHeader(object.bytes, upload.contentType)) throw new ImageOperationError("Image verification failed.");
    return { kind: "vercel-blob", pathname: upload.pathname, originalFilename: upload.filename, contentType: upload.contentType, size: upload.size, uploadedAt: new Date().toISOString() };
  }
  async createReadAccess(pathname: string) { return `https://test.invalid/read/${encodeURIComponent(pathname)}`; }
  async deleteObject(pathname: string) { if (this.failDelete) throw new Error("Unavailable"); this.deleted.push(pathname); this.objects.delete(pathname); }
}
