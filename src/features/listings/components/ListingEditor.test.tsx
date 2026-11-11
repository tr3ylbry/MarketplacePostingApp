import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ListingEditor } from "./ListingEditor";
import { listingFixture } from "../../../test/fixtures";

const { update, push, replace } = vi.hoisted(() => ({ update: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));
vi.mock("../../../app/listings/actions", () => ({ updateListingAction: update, createListingAction: vi.fn(), deleteListingAction: vi.fn() }));
vi.mock("../../../app/listings/imageActions", () => ({ prepareImageAction: vi.fn(), finalizeImageAction: vi.fn(), removeImageAction: vi.fn(), reorderImagesAction: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it("blocks a repeated save while the first request is pending", async () => {
  const listing = listingFixture();
  let finish!: (result: { ok: true; data: typeof listing }) => void;
  update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ListingEditor initialListing={listing} />);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Pending save fixture" } });
  const save = screen.getByRole("button", { name: "Save Changes" });
  fireEvent.click(save);
  expect(save).toBeDisabled(); expect(screen.getByText("Saving changes…")).toHaveAttribute("role", "status");
  fireEvent.click(save); expect(update).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true, data: { ...listing, title: "Pending save fixture" } }));
  expect(screen.getByText("Saved!")).toBeVisible();
});

it("lets an invalid save explain missing fields and focuses the error summary without saving", async () => {
  render(<ListingEditor initialListing={listingFixture()} />);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Bad" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  const summary = await screen.findByRole("alert", { name: "Complete These Fields" });
  expect(summary).toHaveTextContent("Title must be at least 4 characters.");
  expect(summary).toHaveFocus();
  expect(screen.getByLabelText(/Title/)).toHaveAttribute("aria-required", "true");
  expect(update).not.toHaveBeenCalled();
});

it("starts new contact fields blank rather than copying a developer's personal defaults", () => {
  render(<ListingEditor initialListing={null} />);
  const marketplace = screen.getByRole("button", { name: "Craigslist" });
  expect(marketplace).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(marketplace);
  expect(marketplace).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  for (const label of [/City/, /Phone Number/, /Contact Name/, /^Street/, /Cross Street/]) expect(screen.getByLabelText(label)).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save Listing" }));
  expect(screen.getByRole("alert", { name: "Complete These Fields" })).toHaveFocus();
});

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
