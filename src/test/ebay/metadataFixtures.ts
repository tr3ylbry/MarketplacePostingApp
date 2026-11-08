// Synthetic API-shaped metadata. These IDs/labels are not real Sandbox evidence.
const category = (id: string, name: string, leaf = false) => ({ category: { categoryId: id, categoryName: name }, ...(leaf ? { leafCategoryTreeNode: true } : {}) });
const leaf = category("101", "Synthetic effects pedals", true);
const secondLeaf = category("102", "Synthetic guitars", true);
const parent = { ...category("100", "Synthetic musical instruments"), childCategoryTreeNodes: [leaf, secondLeaf] };
const tree = { categoryTreeId: "0", categoryTreeVersion: "fixture-1" };
export const fixtureAspects = { aspects: ["Brand", "Model"].map(localizedAspectName => ({
  localizedAspectName, aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE", aspectDataType: "STRING", aspectMaxLength: 65 },
})) };
export const fixtureConditions = { itemConditionPolicies: [{ categoryId: "101", categoryTreeId: "0", itemConditionRequired: true, itemConditions: [
  { conditionId: "3000", conditionDescription: "Used", usage: "ALL" },
  { conditionId: "2000", conditionDescription: "Certified refurbished", usage: "RESTRICTED" },
] }] };
export function metadataFixture(path: string, query: URLSearchParams): unknown | undefined {
  if (path === "/commerce/taxonomy/v1/get_default_category_tree_id") return query.get("marketplace_id") === "EBAY_US" ? tree : undefined;
  if (path === "/commerce/taxonomy/v1/category_tree/0") return { ...tree, rootCategoryNode: { childCategoryTreeNodes: [parent] } };
  if (path === "/commerce/taxonomy/v1/category_tree/0/get_category_subtree") {
    const node = { "100": parent, "101": leaf, "102": secondLeaf }[query.get("category_id") ?? ""];
    return node ? { ...tree, categorySubtreeNode: node } : undefined;
  }
  if (path === "/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category" && query.get("category_id") === "101") return fixtureAspects;
  if (path === "/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies" && query.get("filter") === "categoryIds:{101}") return fixtureConditions;
  return undefined;
}
