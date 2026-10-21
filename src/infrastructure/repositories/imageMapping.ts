import { listingImageSchema, type ListingImage } from "../../domain/listingImage";
import { listingImages } from "../db/schema";

export function imageToRow(image: ListingImage): typeof listingImages.$inferInsert {
  const value = listingImageSchema.parse(image), source = value.source;
  return {
    id: value.id, listingId: value.listingId, order: value.order, altText: value.altText ?? null,
    storageProvider: source.kind, originalFilename: source.kind === "filename" ? source.name : source.originalFilename,
    pathname: source.kind === "filename" ? null : source.pathname,
    contentType: source.kind === "filename" ? null : source.contentType,
    byteSize: source.kind === "filename" ? null : source.size,
    uploadedAt: source.kind === "filename" ? null : source.uploadedAt,
  };
}
export function imageFromRow(row: typeof listingImages.$inferSelect): ListingImage {
  return listingImageSchema.parse({ id: row.id, listingId: row.listingId, order: row.order, altText: row.altText ?? undefined,
    source: row.storageProvider === "filename" ? { kind: "filename", name: row.originalFilename } : {
      kind: row.storageProvider, pathname: row.pathname, originalFilename: row.originalFilename,
      contentType: row.contentType, size: row.byteSize, uploadedAt: row.uploadedAt ? new Date(row.uploadedAt).toISOString() : null,
    },
  });
}
