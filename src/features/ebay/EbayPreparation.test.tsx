import { fireEvent, render, screen } from "@testing-library/react";
import { EbayPreparation } from "./EbayPreparation";
import { requirementsFixture } from "../../test/ebay/preparationFixtures";

const { load, review } = vi.hoisted(() => ({ load: vi.fn(), review: vi.fn() }));
vi.mock("../../app/listings/[id]/ebay/actions", () => ({ loadEbayMetadataAction: load, reviewEbayPreparationAction: review }));
beforeEach(() => { vi.clearAllMocks(); });
it("does not request metadata on render and keeps a disconnected owner from loading options", () => {
  render(<EbayPreparation listingId="fixture" version="version" connected={false} brand="Boss" model="DS-1" />);
  expect(screen.getByRole("button", { name: "Load eBay categories" })).toBeDisabled();
  expect(load).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
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
