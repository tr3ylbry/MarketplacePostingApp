import { createHash } from "node:crypto";
import { z } from "zod";
import type { Listing } from "../domain/listing";
import { ebayCategoryId, EbayMetadataError, usedConditionEnums, type EbayCategoryRequirements } from "./ebayMetadata";

const value = z.string().trim().min(1).max(200).refine(s => !/[<>]/.test(s) && ![...s].some(c => c.charCodeAt(0) < 32));
export const ebaySelectionSchema = z.object({
  categoryId: ebayCategoryId,
  conditionId: z.string().regex(/^[0-9]{1,5}$/),
  aspects: z.array(z.object({ name: value, values: z.array(value).min(1).max(30) })).max(300),
});
export type EbayPreparationSelection = z.infer<typeof ebaySelectionSchema>;

export function ebaySku(listingId: string) {
  return "mpa-ebay-" + createHash("sha256").update("ebay-sandbox-inventory-v1\0" + listingId).digest("hex").slice(0, 32);
}

/** Pure review data, not a request body or permission to stage/publish remotely. */
export function mapEbayPreparation(listing: Listing, input: unknown, requirements: EbayCategoryRequirements) {
  const parsed = ebaySelectionSchema.safeParse(input);
  if (!parsed.success) throw new EbayMetadataError("selection");
  const selection = parsed.data;
  const category = requirements.branch.category;
  if (!category?.leaf || category.id !== selection.categoryId) throw new EbayMetadataError("category");
  const condition = requirements.conditions.find(c => c.id === selection.conditionId && c.supported);
  if (!condition || !Object.prototype.hasOwnProperty.call(usedConditionEnums, condition.id)) throw new EbayMetadataError("selection");
  if (new Set(selection.aspects.map(a => a.name)).size !== selection.aspects.length) throw new EbayMetadataError("selection");
  // Server Actions return ordinary serializable records; reserved names are rejected below.
  const aspects: Record<string, string[]> = {};
  for (const selected of selection.aspects) {
    const metadata = requirements.aspects.find(a => a.name === selected.name);
    if (!metadata || ["__proto__", "constructor", "prototype"].includes(selected.name) ||
        metadata.dataType !== "STRING" || metadata.format || metadata.advancedType ||
        (metadata.cardinality === "SINGLE" && selected.values.length !== 1) ||
        new Set(selected.values).size !== selected.values.length) throw new EbayMetadataError("selection");
    for (const chosen of selected.values) {
      if (chosen.length > metadata.maxLength) throw new EbayMetadataError("selection");
      const option = metadata.values.find(v => v.value === chosen);
      // Conditional values need a later explicitly reviewed dependency evaluator.
      if (option?.conditional || (metadata.mode === "SELECTION_ONLY" && !option)) throw new EbayMetadataError("selection");
    }
    aspects[selected.name] = selected.values;
  }
  if (requirements.aspects.some(a => a.required && !Object.prototype.hasOwnProperty.call(aspects, a.name))) throw new EbayMetadataError("selection");

  const title = listing.title.trim();
  const price = String(listing.askingPrice.amount);
  if (title.length < 1 || title.length > 80 || listing.description.length > 4000 ||
      listing.askingPrice.currency !== "USD" || listing.askingPrice.amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(price)) {
    throw new EbayMetadataError("listing");
  }
  const [whole, cents = ""] = price.split(".");
  return {
    environment: "sandbox" as const, marketplace: "EBAY_US" as const, format: "FIXED_PRICE" as const,
    sku: ebaySku(listing.id), listingVersion: listing.updatedAt,
    category: { id: category.id, name: category.name, treeId: requirements.branch.treeId, treeVersion: requirements.branch.treeVersion },
    title, description: listing.description, condition: { id: condition.id, name: condition.name, inventoryEnum: usedConditionEnums[condition.id as keyof typeof usedConditionEnums] },
    aspects, price: { value: whole + "." + cents.padEnd(2, "0"), currency: "USD" as const }, quantity: 1 as const,
    photos: { durable: listing.images.filter(i => i.source.kind === "vercel-blob").length, unavailable: listing.images.filter(i => i.source.kind !== "vercel-blob").length },
    canStage: false as const,
    remaining: ["Private-photo export to EPS", "Seller location and policy readiness", "Inventory staging, reconciliation and guarded cleanup"],
  };
}
export type EbayPreparationReview = ReturnType<typeof mapEbayPreparation>;
