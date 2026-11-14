import { z } from "zod";
import type { Listing } from "../domain/listing";

export const INVENTORY_PAGE_SIZE = 25;
export const MAX_INVENTORY_QUERY_LENGTH = 100;
export const inventoryQuerySchema = z.object({
  query: z.string().trim().max(MAX_INVENTORY_QUERY_LENGTH)
    .refine(value => value.length > MAX_INVENTORY_QUERY_LENGTH || ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), "Search cannot contain control characters.").default(""),
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
}).strict();
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type ListingSummary = Pick<Listing, "id" | "title" | "askingPrice" | "status" | "condition" | "createdAt"> & { categoryLabel: string };
export interface InventoryPage {
  items: ListingSummary[];
  query: string;
  page: number;
  pageSize: typeof INVENTORY_PAGE_SIZE;
  totalPages: number;
  matchingCount: number;
}
