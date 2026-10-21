import { blobImageSourceSchema, listingImageSchema, imagesFromNames } from "./listingImage";
import { imagePathname, uploadInputSchema, matchesImageHeader } from "../application/imageStorage";
import { imageFromRow, imageToRow } from "../infrastructure/repositories/imageMapping";

const input = { filename: "../../Guitar photo.png", contentType: "image/png" as const, size: 12 };
const id = "4ea3182c-53f6-49ba-b208-aadf2e4d6e5b";
const source = { kind: "vercel-blob" as const, pathname: imagePathname(id, input), originalFilename: input.filename, contentType: input.contentType, size: input.size, uploadedAt: "2026-01-01T00:00:00.000Z" };
it("validates durable metadata without persisting a signed URL and safely generates unique paths", () => {
  expect(blobImageSourceSchema.parse(source)).toEqual(source);
  expect(source.pathname).toBe(`images/${id}/______Guitar_photo.png`);
  expect(imagePathname(crypto.randomUUID(), input)).not.toBe(source.pathname);
  expect(blobImageSourceSchema.safeParse({ ...source, pathname: "https://example.com/signed?token=x" }).success).toBe(false);
});
it.each([{ size: -1 }, { size: 0 }, { size: 10485761 }, { contentType: "image/svg+xml" }, { uploadedAt: "yesterday" }])("rejects invalid source metadata %j", override => {
  expect(blobImageSourceSchema.safeParse({ ...source, ...override }).success).toBe(false);
});
it("round trips both legacy and durable source columns with order and alt text", () => {
  const legacy = imagesFromNames("listing", ["old.png"])[0];
  const stored = listingImageSchema.parse({ id, listingId: "listing", source, order: 2, altText: "Front" });
  for (const image of [legacy, stored]) {
    const row = imageToRow(image);
    expect(imageFromRow({ ...row, pathname: row.pathname ?? null, contentType: row.contentType ?? null, byteSize: row.byteSize ?? null, uploadedAt: row.uploadedAt ?? null, altText: row.altText ?? null })).toEqual(image);
  }
});
it("rejects extra browser authority fields and checks intentional file signatures", () => {
  expect(uploadInputSchema.safeParse({ ...input, pathname: source.pathname }).success).toBe(false);
  expect(matchesImageHeader(new Uint8Array([255, 216, 255]), "image/jpeg")).toBe(true);
  expect(matchesImageHeader(new Uint8Array([60, 115, 118, 103]), "image/png")).toBe(false);
});
