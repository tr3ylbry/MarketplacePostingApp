import { convertImageForUpload } from "./photoUploadProcessing";
import heic2any from "heic2any";
vi.mock("heic2any", () => ({ default: vi.fn() }));
it("keeps normal image bytes unchanged", async () => {
  const file = new File(["bytes"], "photo.png", { type: "image/png" });
  expect(await convertImageForUpload(file)).toBe(file);
});
it.each(["photo.HEIC", "photo.heif", "photo"])("converts HEIC bytes and accurately names the JPEG: %s", async name => {
  vi.mocked(heic2any).mockResolvedValue(new Blob(["jpeg bytes"], { type: "image/jpeg" }));
  const file = await convertImageForUpload(new File(["heic bytes"], name, { type: "image/heic" }));
  expect(file.type).toBe("image/jpeg"); expect(file.name).toBe("photo.jpg"); expect(file.size).toBe(10);
});
