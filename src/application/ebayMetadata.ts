import { z } from "zod";

export const ebayCategoryId = z.string().regex(/^[1-9][0-9]{0,19}$/);
export interface EbayCategory { id: string; name: string; leaf: boolean }
export interface EbayCategoryBranch {
  treeId: string;
  treeVersion: string;
  category: EbayCategory | null;
  children: EbayCategory[];
}
export interface EbayAspect {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  dataType: "STRING" | "NUMBER" | "DATE";
  format?: string;
  advancedType?: string;
  maxLength: number;
  values: { value: string; conditional: boolean }[];
}
export const usedConditionEnums = {
  "3000": "USED_EXCELLENT", "4000": "USED_VERY_GOOD", "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE", "7000": "FOR_PARTS_OR_NOT_WORKING",
} as const;
export interface EbayCondition { id: string; name: string; supported: boolean }
export interface EbayCategoryRequirements {
  branch: EbayCategoryBranch;
  aspects: EbayAspect[];
  conditions: EbayCondition[];
}
// There is deliberately no inventory, media, offer, delete or publish operation.
export interface EbayMetadataGateway {
  browse(categoryId?: string): Promise<EbayCategoryBranch>;
  requirements(categoryId: string): Promise<EbayCategoryRequirements>;
}
export class EbayMetadataError extends Error {
  constructor(readonly code: "unavailable" | "rate-limit" | "category" | "selection" | "listing" | "stale") {
    super({
      unavailable: "eBay metadata is unavailable. Try again later.",
      "rate-limit": "eBay limited these metadata requests. Wait before trying again.",
      category: "Choose a verified leaf category from the eBay category tree.",
      selection: "Check the selected condition and item aspects. Unsupported or conditional formats cannot be reviewed yet.",
      listing: "Use a title of at most 80 characters, a description of at most 4000 characters, and a positive USD asking price with no more than two decimal places.",
      stale: "The listing or eBay connection changed. Reload before preparing it again.",
    }[code]);
  }
}
