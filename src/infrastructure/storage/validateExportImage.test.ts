// @vitest-environment node
import sharp from "sharp";
import { exportImageValidator } from "./validateExportImage";
import { MAX_IMAGE_BYTES } from "../../domain/listingImage";
const signal = () => AbortSignal.timeout(10000);
async function image(format: "png" | "jpeg" = "png", width = 500, height = 500) {
  const value = sharp({ create: { width, height, channels: 3, background: "#446688" } });
  return format === "png" ? value.png().toBuffer() : value.jpeg().toBuffer();
}
it.each(["png", "jpeg"] as const)("fully decodes a safe static %s without converting the original", async format => {
  const bytes = await image(format), copy = Buffer.from(bytes);
  expect(await exportImageValidator.validate(bytes, "image/" + format, signal())).toEqual({ width: 500, height: 500, size: bytes.length, contentType: "image/" + format });
  expect(bytes.equals(copy)).toBe(true);
});
it.each([[499, 499], [4097, 1], [1, 4097], [5000, 5000]])("rejects dimensions %s x %s", async (width, height) => {
  const bytes = await image("png", width, height); await expect(exportImageValidator.validate(bytes, "image/png", signal())).rejects.toMatchObject({ code: "invalid" });
});
it("accepts a portrait and the conservative side boundary", async () => {
  for (const [width, height] of [[100, 500], [4096, 1]]) expect(await exportImageValidator.validate(await image("png", width, height), "image/png", signal())).toMatchObject({ width, height });
});
it.each(["image/webp", "image/svg+xml", "application/octet-stream"])("rejects unsupported MIME %s", async type => {
  await expect(exportImageValidator.validate(await image(), type, signal())).rejects.toMatchObject({ code: "invalid" });
});
it("rejects MIME/signature mismatches and oversized input before decode", async () => {
  await expect(exportImageValidator.validate(await image(), "image/jpeg", signal())).rejects.toThrow();
  await expect(exportImageValidator.validate(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png", signal())).rejects.toThrow();
});
it.each(["png", "jpeg"] as const)("rejects corrupt and truncated %s data, including header-only files", async format => {
  const bytes = await image(format), corrupt = format === "jpeg" ? Buffer.concat([bytes.subarray(0, Math.floor(bytes.length / 2)), bytes.subarray(-2)]) : Buffer.from(bytes);
  if (format === "png") corrupt.fill(0, Math.floor(bytes.length / 2), Math.min(bytes.length - 12, Math.floor(bytes.length / 2) + 100));
  for (const value of [bytes.subarray(0, 20), bytes.subarray(0, bytes.length - 2), corrupt]) await expect(exportImageValidator.validate(value, "image/" + format, signal())).rejects.toThrow();
});
it("rejects PNG animation control, trailing bytes and invalid chunk lengths", async () => {
  const bytes = await image(), animated = Buffer.concat([bytes.subarray(0, 33), Buffer.from([0, 0, 0, 8, 97, 99, 84, 76, ...new Array(12).fill(0)]), bytes.subarray(33)]);
  const length = Buffer.from(bytes); length.writeUInt32BE(0xffffffff, 8);
  for (const value of [animated, Buffer.concat([bytes, Buffer.from("extra")]), length]) await expect(exportImageValidator.validate(value, "image/png", signal())).rejects.toThrow();
});
it("rejects CMYK and aborts before starting a decoder", async () => {
  const bytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: "red" } }).toColourspace("cmyk").jpeg().toBuffer();
  await expect(exportImageValidator.validate(bytes, "image/jpeg", signal())).rejects.toThrow();
  const controller = new AbortController(); controller.abort(); await expect(exportImageValidator.validate(await image(), "image/png", controller.signal)).rejects.toThrow();
});
it.each(["iCCP", "zTXt", "iTXt", "eXIf"])("rejects unsupported PNG metadata %s before native expansion", async type => {
  const bytes = await image(), chunk = Buffer.alloc(12); chunk.write(type, 4, "ascii");
  await expect(exportImageValidator.validate(Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]), "image/png", signal())).rejects.toThrow();
});
it("rejects higher-bit-depth pixels rather than converting them", async () => {
  const bytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#446688" } }).toColourspace("rgb16").png().toBuffer();
  expect((await sharp(bytes).metadata()).depth).toBe("ushort");
  await expect(exportImageValidator.validate(bytes, "image/png", signal())).rejects.toThrow();
});
it("honors cancellation after native validation starts", async () => {
  const bytes = await image("png", 1000, 1000), controller = new AbortController();
  const validating = exportImageValidator.validate(bytes, "image/png", controller.signal);
  queueMicrotask(() => controller.abort()); await expect(validating).rejects.toMatchObject({ code: "invalid" });
});
it("accepts progressive JPEG segments but rejects concatenated/trailing JPEG payloads", async () => {
  const bytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#446688" } }).jpeg({ progressive: true }).toBuffer();
  await expect(exportImageValidator.validate(bytes, "image/jpeg", signal())).resolves.toMatchObject({ width: 500, height: 500 });
  await expect(exportImageValidator.validate(Buffer.concat([bytes, bytes]), "image/jpeg", signal())).rejects.toThrow();
  await expect(exportImageValidator.validate(Buffer.concat([bytes, Buffer.from([0, 255, 217])]), "image/jpeg", signal())).rejects.toThrow();
});
