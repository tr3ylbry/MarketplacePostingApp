import { z } from "zod";
import { listingSchema, type Listing } from "../domain/listing";
import { EbayMetadataError, type EbayCategoryRequirements } from "./ebayMetadata";
import { mapEbayPreparation, type EbayPreparationSelection, type EbayPreparationReview } from "./ebayPreparationMapping";
import { inventoryBindingSchema, inventoryPhotoBindingSchema, observationIsFresh, sameInventoryBinding,
  type InventoryBinding } from "./ebayInventoryDecisions";

const freshness = z.strictObject({ checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
const mediaObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ imageId: z.string().min(1).max(200), state: z.literal("unverified") }),
  z.strictObject({ imageId: z.string().min(1).max(200), state: z.literal("reported-confirmed"),
    binding: inventoryPhotoBindingSchema, checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime() }),
]);
export type InventoryMediaObservation = z.infer<typeof mediaObservationSchema>;
const snapshotSchema = z.strictObject({
  binding: inventoryBindingSchema, current: inventoryBindingSchema,
  metadata: freshness, photos: z.array(inventoryPhotoBindingSchema).max(40),
  media: z.array(mediaObservationSchema).max(40),
});
export interface InventoryPlannerInput extends z.infer<typeof snapshotSchema> {
  listing: Listing;
  selection: EbayPreparationSelection;
  requirements: EbayCategoryRequirements | null;
}
export type InventoryPlanReason = "invalid-snapshot" | "listing-invalid" | "snapshot-mismatch" | "metadata-unavailable"
  | "metadata-stale" | "metadata-invalid" | "selection-invalid" | "inventory-fields-invalid" | "photo-count"
  | "photo-source-unsupported" | "photo-snapshot-mismatch" | "media-missing" | "media-unverified"
  | "media-expired" | "media-mismatch" | "media-admission-disabled" | "staging-disabled";
export interface InventoryItemDraft {
  availability: { shipToLocationAvailability: { quantity: 1 } };
  condition: EbayPreparationReview["condition"]["inventoryEnum"];
  product: { title: string; description: string; aspects: Record<string, string[]> };
}
export interface InventoryStagingPlan {
  sku: string | null;
  binding: InventoryBinding | null;
  metadata: { categoryId: string; treeId: string; treeVersion: string; conditionId: string; checkedAt: string; expiresAt: string } | null;
  inventoryItem: InventoryItemDraft | null;
  photos: { imageId: string; order: number; sourceVersion: string | null;
    media: "missing" | "unverified" | "expired" | "mismatched" | "reported-current" }[];
  blockers: InventoryPlanReason[];
  canStage: false;
}
// Canonical descriptions are plain text. Escape for the API's HTML-capable description field.
function descriptionText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Pure internal plan, deliberately incomplete: no URLs, request builder, admission or send authority. */
export function planEbayInventory(input: InventoryPlannerInput, now: string): InventoryStagingPlan {
  const plan: InventoryStagingPlan = { sku: null, binding: null, metadata: null, inventoryItem: null, photos: [],
    blockers: ["media-admission-disabled", "staging-disabled"], canStage: false };
  const block = (reason: InventoryPlanReason) => { if (!plan.blockers.includes(reason)) plan.blockers.push(reason); };
  const snapshot = snapshotSchema.safeParse({ binding: input.binding, current: input.current, metadata: input.metadata, photos: input.photos, media: input.media });
  if (!snapshot.success || !z.iso.datetime().safeParse(now).success) { block("invalid-snapshot"); return plan; }
  const { binding, current, metadata, photos, media } = snapshot.data;
  plan.binding = binding;
  if (binding.environment !== "sandbox" || current.environment !== "sandbox" || !sameInventoryBinding(binding, current)) block("snapshot-mismatch");
  const parsed = listingSchema.safeParse(input.listing);
  if (!parsed.success) { block("listing-invalid"); return plan; }
  const listing = parsed.data;
  if (listing.id !== binding.listingId || listing.updatedAt !== binding.listingVersion) block("snapshot-mismatch");
  if (!observationIsFresh(metadata.checkedAt, metadata.expiresAt, now)) block("metadata-stale");
  if (!input.requirements) block("metadata-unavailable");
  else {
    try {
      z.object({ treeId: z.string().regex(/^[0-9]{1,20}$/), treeVersion: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/) }).parse(input.requirements.branch);
      // Reuse authoritative selection, category/condition and canonical price/listing validation.
      const review = mapEbayPreparation(listing, input.selection, input.requirements);
      plan.sku = review.sku;
      plan.metadata = { categoryId: review.category.id, treeId: review.category.treeId, treeVersion: review.category.treeVersion,
        conditionId: review.condition.id, ...metadata };
      const description = descriptionText(review.description);
      // The Inventory contract's aspect lengths are narrower than some taxonomy metadata.
      if (description.length > 4000 || Object.entries(review.aspects).some(([name, values]) => name.length > 40 || values.some(value => value.length > 50))) block("inventory-fields-invalid");
      else plan.inventoryItem = { availability: { shipToLocationAvailability: { quantity: review.quantity } },
        condition: review.condition.inventoryEnum,
        product: { title: review.title, description, aspects: review.aspects } };
    } catch (error) {
      block(error instanceof EbayMetadataError ? error.code === "listing" ? "listing-invalid" : "selection-invalid" : "metadata-invalid");
    }
  }
  if (listing.images.length < 1 || listing.images.length > 24) block("photo-count");
  if (photos.length !== listing.images.length || new Set(photos.map(p => p.imageId)).size !== photos.length ||
      photos.some(p => !listing.images.some(image => image.id === p.imageId))) block("photo-snapshot-mismatch");
  if (new Set(media.map(p => p.imageId)).size !== media.length || media.some(p => !listing.images.some(image => image.id === p.imageId))) block("media-mismatch");
  plan.photos = [...listing.images].sort((a, b) => a.order - b.order).map(image => {
    if (image.source.kind !== "vercel-blob" || !["image/jpeg", "image/png"].includes(image.source.contentType)) block("photo-source-unsupported");
    const photo = photos.find(p => p.imageId === image.id);
    const matches = !!photo && sameInventoryBinding(binding, photo) && photo.imageOrder === image.order;
    if (!matches) block("photo-snapshot-mismatch");
    const evidence = media.find(p => p.imageId === image.id);
    let status: InventoryStagingPlan["photos"][number]["media"] = "missing";
    if (!evidence) block("media-missing");
    else if (evidence.state === "unverified") { status = "unverified"; block("media-unverified"); }
    else if (!matches || evidence.imageId !== evidence.binding.imageId || !sameInventoryBinding(binding, evidence.binding) ||
        evidence.binding.sourceVersion !== photo.sourceVersion || evidence.binding.imageOrder !== image.order) {
      status = "mismatched"; block("media-mismatch");
    } else if (!observationIsFresh(evidence.checkedAt, evidence.expiresAt, now)) { status = "expired"; block("media-expired"); }
    else status = "reported-current";
    return { imageId: image.id, order: image.order, sourceVersion: matches ? photo.sourceVersion : null, media: status };
  });
  return plan;
}
