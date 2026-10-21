import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ListingEditor } from "./ListingEditor";
import { listingFixture } from "../../../test/fixtures";

const { update, push, replace } = vi.hoisted(() => ({ update: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));
vi.mock("../../../app/listings/actions", () => ({ updateListingAction: update, createListingAction: vi.fn(), deleteListingAction: vi.fn() }));
vi.mock("../../../app/listings/imageActions", () => ({ prepareImageAction: vi.fn(), finalizeImageAction: vi.fn(), removeImageAction: vi.fn(), reorderImagesAction: vi.fn() }));

it("keeps edits and shows the server failure instead of claiming a successful save", async () => {
  update.mockResolvedValue({ ok: false, error: "The listing changed. Reload before saving." });
  render(<ListingEditor initialListing={listingFixture()} />);
  const title = screen.getByLabelText(/Title/);
  fireEvent.change(title, { target: { value: "Unsaved guitar edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Reload before saving");
  expect(title).toHaveValue("Unsaved guitar edit");
  expect(screen.queryByText("Saved!")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("Saving changes…")).not.toBeInTheDocument());
});
