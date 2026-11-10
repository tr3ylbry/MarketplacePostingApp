// Build-time-only replacement. Normal Next builds resolve the real adapter.
import type { ImageStorage, ImageUpload, ProviderImageSigner } from "../../application/imageStorage";
import { blobImageSourceSchema } from "../../domain/listingImage";
import type { PrivateImageReader } from "../../application/ebayPrivateImages";
import { collectPrivateImage } from "../../infrastructure/storage/readPrivateImage";

async function control(operation: string, payload: unknown): Promise<unknown> {
  const secret = process.env.TEST_STORAGE_SECRET;
  if (!secret || process.env.VERCEL || process.env.MARKETPLACE_TEST_BUILD !== "1") throw new Error("Test storage is unavailable.");
  const response = await fetch(`http://127.0.0.1:4311/control/${operation}`, { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Test storage operation failed.");
  return response.json();
}
export const imageStorage: ImageStorage & ProviderImageSigner & PrivateImageReader = {
  async readPrivateImage(source, signal) {
    if (!process.env.TEST_STORAGE_SECRET || process.env.VERCEL || process.env.MARKETPLACE_TEST_BUILD !== "1") throw new Error("Test storage is unavailable.");
    const result = await fetch("http://127.0.0.1:4311/control/bytes", { method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TEST_STORAGE_SECRET}` }, body: JSON.stringify({ pathname: source.pathname }) });
    if (!result.ok || !result.body) throw new Error("Test object is unavailable.");
    return collectPrivateImage(source, { pathname: source.pathname, size: Number(result.headers.get("content-length")), contentType: result.headers.get("content-type") ?? "", stream: result.body }, signal);
  },
  async signProviderReadAccess(pathname: string) { return String(await control("read", { pathname })); },
  async prepareUpload(upload: ImageUpload) { return String(await control("prepare", upload)); },
  async verifyUpload(upload: ImageUpload) { return blobImageSourceSchema.parse(await control("verify", upload)); },
  async createReadAccess(pathname: string) { return String(await control("read", { pathname })); },
  async deleteObject(pathname: string) { await control("delete", { pathname }); },
};
