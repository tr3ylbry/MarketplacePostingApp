import { collectPrivateImage } from "./readPrivateImage";
import { blobImageSourceSchema } from "../../domain/listingImage";
const source = blobImageSourceSchema.parse({ kind: "vercel-blob", pathname: "images/4ea3182c-53f6-49ba-b208-aadf2e4d6e5b/photo.png", originalFilename: "photo.png", contentType: "image/png", size: 12, uploadedAt: "2026-11-10T10:00:00.000Z" });
const signal = () => AbortSignal.timeout(1000);
function stream(parts: number[], closed = true) {
  const cancel = vi.fn(), value = new ReadableStream<Uint8Array>({ start(controller) { parts.forEach(size => controller.enqueue(new Uint8Array(size))); if (closed) controller.close(); }, cancel });
  return { stream: value, cancel };
}
it("reads exact-length chunks without exposing a URL", async () => {
  const s = stream([5, 7]); expect((await collectPrivateImage(source, { ...source, ...s }, signal())).length).toBe(12);
});
it.each(["pathname", "size", "contentType"])("cancels before buffering mismatched %s", async key => {
  const s = stream([], false), result = { ...source, ...s, [key]: key === "size" ? 13 : "wrong" };
  await expect(collectPrivateImage(source, result, signal())).rejects.toMatchObject({ code: "invalid" }); expect(s.cancel).toHaveBeenCalledOnce();
});
it.each([{ parts: [13] }, { parts: [5, 8] }, { parts: [11] }])("rejects excessive or truncated byte chunks %o", async ({ parts }) => {
  const s = stream(parts); await expect(collectPrivateImage(source, { ...source, ...s }, signal())).rejects.toMatchObject({ code: "invalid" });
});
it("cancels a stalled reader on abort", async () => {
  const s = stream([], false), controller = new AbortController();
  const read = collectPrivateImage(source, { ...source, ...s }, controller.signal); controller.abort();
  await expect(read).rejects.toMatchObject({ code: "invalid" }); expect(s.cancel).toHaveBeenCalledOnce();
});
it("rejects and closes already-aborted streams", async () => {
  const s = stream([], false), controller = new AbortController(); controller.abort();
  await expect(collectPrivateImage(source, { ...source, ...s }, controller.signal)).rejects.toThrow(); expect(s.cancel).toHaveBeenCalled();
});
it("maps failed streams to a safe error without returning provider details", async () => {
  const value = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("Bearer private-token https://private.invalid/image")); } });
  await expect(collectPrivateImage(source, { ...source, stream: value }, signal())).rejects.toThrow("photo could not be verified");
});
