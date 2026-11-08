import type { EbayCategoryRequirements } from "../../application/ebayMetadata";

export const requirementsFixture = (): EbayCategoryRequirements => ({
  branch: { treeId: "0", treeVersion: "fixture-1", category: { id: "101", name: "Synthetic pedals", leaf: true }, children: [] },
  aspects: ["Brand", "Model"].map(name => ({ name, required: true, mode: "FREE_TEXT", cardinality: "SINGLE", dataType: "STRING", maxLength: 65, values: [] })),
  conditions: [{ id: "3000", name: "Used", supported: true }],
});
export const preparationSelection = () => ({
  categoryId: "101", conditionId: "3000",
  aspects: [{ name: "Brand", values: ["Boss"] }, { name: "Model", values: ["DS-1"] }],
});
