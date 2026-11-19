import { z } from "zod";
import type { Listing } from "../domain/listing";
import type { InventoryBinding, InventoryPhotoBinding } from "./ebayInventoryDecisions";
import { inventoryHash, inventoryId, type InventoryClaim, type InventoryClaimInput, type InventoryEvidence } from "./ebayInventoryPersistence";
import type { InventoryPlannerInput } from "./ebayInventoryPlanner";

// Application budgets for synthetic fixtures, never an eBay HTTP contract.
export const INSPECTION_REVIEW_MS = 300_000, INSPECTION_WORK_MS = 10_000;
export interface InspectionActor { ownerId: string; id: string; expiresAt: string }
export interface InspectionSnapshot {
  listing: Listing; binding: InventoryBinding; photos: InventoryPhotoBinding[];
  sessionExpiresAt: string; credentialExpiresAt: string; checkedAt: string;
}
const reference = z.strictObject({ kind: z.enum(["offer", "listing", "group"]), id: inventoryId });
const sampleSchema = z.strictObject({
  item: z.enum(["absent", "present", "unknown"]), content: z.enum(["matches", "different", "unknown"]), contentDigest: inventoryHash.nullable(),
  offersComplete: z.boolean(), listings: z.enum(["none", "present", "unknown"]), groups: z.enum(["none", "present", "unknown"]),
  related: z.array(reference), code: z.enum(["none", "collision", "stale", "conflict", "recreation", "integrity"]),
});
export type InspectionSample = z.infer<typeof sampleSchema>;
export interface InspectionFixture { version: "inventory-inspection-fixture-v1"; samples: InspectionSample[] }
export function unknownInspection(): InspectionSample {
  return { item: "unknown", content: "unknown", contentDigest: null, offersComplete: false, listings: "unknown", groups: "unknown", related: [], code: "integrity" };
}
function keys(value: object, allowed: string[]) {
  let count=0;
  for(const key in value) { if(!Object.prototype.hasOwnProperty.call(value,key) || !allowed.includes(key) || ++count>allowed.length)return false; }
  return count===allowed.length;
}
export function boundedInspection(input: unknown): { samples: InspectionSample[]; overflow: boolean } {
  // Check collection lengths before Zod traversal, copying or serialization.
  // Unread/malformed data is integrity ambiguity, never fabricated absence or
  // a weaker replacement for a possible recreation/conflict warning.
  let warning:InspectionSample["code"]="integrity";
  const unknown = () => ({ samples: [{...unknownInspection(),code:warning}], overflow: true });
  if (!input || typeof input !== "object") return unknown();
  const root = input as Record<string, unknown>;
  if (!keys(root,["version","samples"]) || root.version !== "inventory-inspection-fixture-v1" || !Array.isArray(root.samples) || root.samples.length < 1 || root.samples.length > 3) return unknown();
  // Preserve explicit warnings in the bounded header set before checking a
  // sample's potentially oversized reference collection. Unread batches still
  // become integrity ambiguity, never a clean result.
  const warnings=root.samples.map(raw=>raw && typeof raw==="object"?(raw as Record<string,unknown>).code:undefined);
  if(warnings.includes("recreation"))warning="recreation";else if(warnings.includes("integrity"))warning="integrity";else if(warnings.includes("conflict"))warning="conflict";
  let references = 0;
  for (const raw of root.samples) {
    if (!raw || typeof raw !== "object" || !keys(raw,["item","content","contentDigest","offersComplete","listings","groups","related","code"])) return unknown();
    const sample=raw as Record<string,unknown>,related = sample.related;
    if (!Array.isArray(related) || related.length > 250 || (references += related.length) > 250) return unknown();
    for(const key of ["item","content","listings","groups","code"])if(typeof sample[key]!=="string" || sample[key].length>20)return unknown();
    if(sample.contentDigest!==null && (typeof sample.contentDigest!=="string" || sample.contentDigest.length!==64))return unknown();
    for(const ref of related)if(!ref || typeof ref!=="object" || !keys(ref,["kind","id"]) || typeof ref.id!=="string" || ref.id.length>200 || typeof ref.kind!=="string" || ref.kind.length>10)return unknown();
  }
  const parsed = z.array(sampleSchema).max(3).safeParse(root.samples);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 65_536) return unknown();
  return { samples: parsed.data, overflow: false };
}
export interface InspectionReview { readonly simulation: true; readonly expiresAt: string }
export interface InspectionSummary {
  simulation: true; ownership: "unproven"; canStage: false; canDelete: false;
  state: "refused" | "stale" | "cancelled" | "unknown"; reasons: string[]; checkedAt: string;
}
export interface InspectionDependencies {
  session(): Promise<InspectionActor | null>;
  load(actor: InspectionActor, listingId: string): Promise<InspectionSnapshot>;
  time(): Promise<string>;
  lease(claim: InventoryClaim): Promise<string>;
  repository: {
    claim(input: InventoryClaimInput): Promise<InventoryClaim>;
    acknowledge(claim: InventoryClaim, value: InventoryEvidence): Promise<{ revision: number; late: boolean }>;
  };
  // In-memory observation only. No host, credentials, PUT/DELETE or upload port.
  observer: { inspect(sku: string, signal: AbortSignal): Promise<unknown> };
  planning(snapshot: InspectionSnapshot): Pick<InventoryPlannerInput, "selection" | "requirements">;
}
export class InventoryInspectionError extends Error {
  constructor(readonly code: "stale" | "busy" | "unavailable" | "isolation") {
    super({ stale: "Prepare a new one-use inspection review.", busy: "Inspection is busy. Wait, then prepare a new review.",
      unavailable: "The simulated inspection could not be completed.", isolation: "Isolated Inventory tests are required." }[code]);
  }
}
