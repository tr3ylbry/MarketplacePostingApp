import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeleteListingButton } from "./DeleteListingButton";
import { deleteListingAction } from "../../../app/listings/actions";
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("../../../app/listings/actions", () => ({ deleteListingAction: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => vi.restoreAllMocks());

it.each([false, true])("preserves ordinary redirect behavior or refreshes the current inventory location (%s)", async stayOnPage => {
  vi.mocked(deleteListingAction).mockResolvedValue({ ok: true, data: undefined });
  render(<DeleteListingButton id="owned-id" stayOnPage={stayOnPage} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(deleteListingAction).toHaveBeenCalledWith("owned-id");
  if (stayOnPage) expect(push).not.toHaveBeenCalled(); else expect(push).toHaveBeenCalledWith("/listings");
});

it("keeps confirmation and recoverable error behavior", async () => {
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  render(<DeleteListingButton id="owned-id" stayOnPage />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(deleteListingAction).not.toHaveBeenCalled();
  vi.mocked(deleteListingAction).mockResolvedValue({ ok: false, error: "Deletion failed. Try again." });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Deletion failed.");
  expect(refresh).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
});
