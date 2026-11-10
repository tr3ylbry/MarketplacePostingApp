import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformPreview } from "./PlatformPreview";
import { listingFixture } from "../../../test/fixtures";

it("navigates registered previews, shows validation, and copies a generated field", async () => {
  const user = userEvent.setup();
  const listing = listingFixture({ category: "" });
  render(<PlatformPreview listing={listing} />);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Copy Item Title/i }));
  expect(await navigator.clipboard.readText()).toBe(listing.title);
  expect(screen.getByRole("status", { name: "Marketplace preview position" })).toHaveTextContent("1 / 2");
  expect(screen.getByText("Preview text copied.")).toHaveAttribute("role", "status");
  await user.click(screen.getByRole("button", { name: "Next marketplace preview" }));
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(screen.getByText(/Category is required for Reverb/)).toBeInTheDocument();
  expect(screen.getByText("0.00")).toBeInTheDocument();
});

it("explains clipboard rejection without claiming the text was copied", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Denied"));
  render(<PlatformPreview listing={listingFixture()} />);
  await user.click(screen.getByRole("button", { name: /Copy Item Title/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select and copy the preview text manually.");
  expect(screen.queryByText("Preview text copied.")).not.toBeInTheDocument();
});

it("handles a listing with no selected marketplaces", () => {
  render(<PlatformPreview listing={listingFixture({ selectedPlatforms: [] })} />);
  expect(screen.getByText("No listing selected yet")).toBeInTheDocument();
});
