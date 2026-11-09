import { z } from "zod";
import type { ListingRepository } from "./listingRepository";
import type { EbayConnectionRepository } from "./ebayConnection";
import { EbayError } from "./ebayConnection";
import { ownerIdSchema } from "./owner";
import { EbayMetadataError, ebayCategoryId, type EbayMetadataGateway } from "./ebayMetadata";
import { ebaySelectionSchema, mapEbayPreparation } from "./ebayPreparationMapping";

export function createEbayPreparationService(
  listings: ListingRepository, connections: EbayConnectionRepository, metadata: EbayMetadataGateway,
  fingerprint: string, clock = () => new Date(),
) {
  async function snapshot(owner: string, id: string, expectedVersion: string) {
    ownerIdSchema.parse(owner); z.string().min(1).max(200).parse(id);
    if (!z.iso.datetime().safeParse(expectedVersion).success) throw new EbayMetadataError("stale");
    const listing = await listings.getById(owner, id);
    if (!listing) throw new EbayMetadataError("stale");
    const connection = await connections.connection(owner);
    if (!connection || connection.ownerId !== owner || connection.environment !== "sandbox" || connection.status !== "connected" ||
        connection.configHash !== fingerprint || !connection.sellerId || !connection.refreshExpiresAt || connection.refreshExpiresAt <= clock().toISOString()) throw new EbayError("auth");
    if (listing.updatedAt !== expectedVersion) throw new EbayMetadataError("stale");
    return { listing, connection };
  }
  async function unchanged(owner: string, id: string, before: Awaited<ReturnType<typeof snapshot>>) {
    const after = await snapshot(owner, id, before.listing.updatedAt);
    if (after.connection.version !== before.connection.version || after.connection.id !== before.connection.id) throw new EbayMetadataError("stale");
  }
  return {
    async load(owner: string, id: string, expectedVersion: string, categoryId?: string) {
      if (categoryId !== undefined && !ebayCategoryId.safeParse(categoryId).success) throw new EbayMetadataError("category");
      const before = await snapshot(owner, id, expectedVersion);
      const branch = await metadata.browse(categoryId);
      const requirements = branch.category?.leaf ? await metadata.requirements(branch.category.id) : null;
      await unchanged(owner, id, before);
      return { branch: requirements?.branch ?? branch, requirements };
    },
    async review(owner: string, id: string, expectedVersion: string, input: unknown) {
      const selection = ebaySelectionSchema.safeParse(input);
      if (!selection.success) throw new EbayMetadataError("selection");
      const before = await snapshot(owner, id, expectedVersion);
      // Read-only provider I/O is outside repository transactions. Revalidate both versions afterward.
      const requirements = await metadata.requirements(selection.data.categoryId);
      await unchanged(owner, id, before);
      return mapEbayPreparation(before.listing, selection.data, requirements);
    },
  };
}
