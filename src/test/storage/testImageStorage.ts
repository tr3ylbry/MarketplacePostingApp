// Build-time-only replacement. Normal Next builds resolve the real adapter.
import type { ImageStorage, ImageUpload } from "../../application/imageStorage";
import { blobImageSourceSchema } from "../../domain/listingImage";

async function control(operation: string, payload: unknown): Promise<unknown> {
  const secret = process.env.TEST_STORAGE_SECRET;
  if (!secret || process.env.VERCEL || process.env.MARKETPLACE_TEST_BUILD !== "1") throw new Error("Test storage is unavailable.");
  const response = await fetch(`http://127.0.0.1:4311/control/${operation}`, { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Test storage operation failed.");
  return response.json();
}
export const imageStorage: ImageStorage = {
  async prepareUpload(upload: ImageUpload) { return String(await control("prepare", upload)); },
  async verifyUpload(upload: ImageUpload) { return blobImageSourceSchema.parse(await control("verify", upload)); },
  async createReadAccess(pathname: string) { return String(await control("read", { pathname })); },
  async deleteObject(pathname: string) { await control("delete", { pathname }); },
};
