import { fireEvent, render, screen } from "@testing-library/react";
import { EbayPreparation } from "./EbayPreparation";
import { requirementsFixture } from "../../test/ebay/preparationFixtures";
import { listingFixture } from "../../test/fixtures";
import { mapEbayPreparation } from "../../application/ebayPreparationMapping";

const { load, review } = vi.hoisted(() => ({ load: vi.fn(), review: vi.fn() }));
vi.mock("../../app/listings/[id]/ebay/actions", () => ({ loadEbayMetadataAction: load, reviewEbayPreparationAction: review }));
beforeEach(() => { vi.clearAllMocks(); });
it("does not request metadata on render and keeps a disconnected owner from loading options", () => {
  render(<EbayPreparation listingId="fixture" version="version" connected={false} brand="Boss" model="DS-1" />);
  expect(screen.getByRole("button", { name: "Load eBay categories" })).toBeDisabled();
  expect(load).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
});
it("omits an optional unsupported Model instead of trapping a prefilled value in a disabled field", async () => {
  const requirements = requirementsFixture();
  requirements.aspects[1] = { ...requirements.aspects[1], required: false, advancedType: "NUMERIC_RANGE" };
  load.mockResolvedValueOnce({ ok: true, data: { branch: requirements.branch, requirements } });
  review.mockImplementationOnce(async (_id, _version, selection) => ({ ok: true, data: mapEbayPreparation(listingFixture(), selection, requirements) }));
  render(<EbayPreparation listingId="fixture" version="version" connected brand="Boss" model="DS-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Load eBay categories" }));
  const model = await screen.findByLabelText(/^Model \(optional\)/);
  expect(model).toBeDisabled(); expect(model).toHaveValue("");
  fireEvent.change(screen.getByLabelText("eBay condition"), { target: { value: "3000" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare eBay review" }));
  expect(await screen.findByRole("heading", { name: "Read-only eBay review" })).toBeVisible();
  expect(review).toHaveBeenCalledWith("fixture", "version", { categoryId: "101", conditionId: "3000", aspects: [{ name: "Brand", values: ["Boss"] }] });
  requirements.aspects[1].required = true;
  expect(() => mapEbayPreparation(listingFixture(), { categoryId: "101", conditionId: "3000", aspects: [{ name: "Brand", values: ["Boss"] }] }, requirements)).toThrow();
});
it("loads only after explicit action and preserves whitespace while the user edits an aspect", async () => {
  const requirements = requirementsFixture();
  load.mockResolvedValueOnce({ ok: true, data: { branch: { ...requirements.branch, category: null, children: [requirements.branch.category] }, requirements: null } });
  load.mockResolvedValueOnce({ ok: true, data: { branch: requirements.branch, requirements } });
  render(<EbayPreparation listingId="fixture" version="version" connected brand="Boss" model="DS-1" />);
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load eBay categories" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select Synthetic pedals" }));
  const input = await screen.findByLabelText(/^Brand \(required\)/);
  fireEvent.change(input, { target: { value: "Boss " } });
  expect(input).toHaveValue("Boss ");
  expect(load).toHaveBeenCalledTimes(2); expect(review).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /stage|publish|upload/i })).not.toBeInTheDocument();
});
