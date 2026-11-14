import { inventoryQuerySchema, MAX_INVENTORY_QUERY_LENGTH } from "../../application/inventory";

export type InventorySearchParams = Record<string, string | string[] | undefined>;

export function readInventoryLocation(params: InventorySearchParams) {
  const rawQuery = typeof params.q === "string" ? params.q : params.q?.[0] ?? "";
  let page = 1;
  if (typeof params.page === "string" && /^[1-9]\d{0,15}$/.test(params.page)) {
    const value = Number(params.page);
    if (Number.isSafeInteger(value)) page = value;
  }
  const parsed = inventoryQuerySchema.safeParse({ query: rawQuery, page });
  if (!Array.isArray(params.q) && parsed.success) return { ...parsed.data, error: undefined };
  // Never execute a truncated/repeated/invalid search. Bound only the field shown for correction.
  const query = [...rawQuery.trim().slice(0, MAX_INVENTORY_QUERY_LENGTH)].filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("");
  const error = Array.isArray(params.q) ? "Use a single title search. Adjust the text or clear the search."
    : rawQuery.trim().length > MAX_INVENTORY_QUERY_LENGTH ? "Search must be 100 characters or fewer. The field shows the first 100 for editing."
    : "Search cannot contain control characters. Adjust the text or clear the search.";
  return { query, page: 1, error };
}

export function inventoryHref(query: string, page = 1) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return `/listings${suffix ? `?${suffix}` : ""}`;
}

export function isCanonicalInventoryLocation(params: InventorySearchParams, query: string, page: number) {
  return Object.keys(params).filter(key => params[key] !== undefined).every(key => key === "q" || key === "page")
    && params.q === (query || undefined) && params.page === (page > 1 ? String(page) : undefined);
}
