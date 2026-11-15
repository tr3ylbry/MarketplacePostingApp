import { render, screen, within } from "@testing-library/react";
import type { InventoryPage, ListingSummary } from "../../../application/inventory";
import { ListingDashboard } from "./ListingDashboard";
import { inventoryHref } from "../inventoryNavigation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../../app/listings/actions", () => ({ deleteListingAction: vi.fn() }));
const item: ListingSummary = { id: "item", title: "Synthetic guitar", askingPrice: { amount: 25, currency: "USD" }, status: "draft", condition: "good", categoryLabel: "Electric", createdAt: "2026-01-01T00:00:00.000Z" };
const page = (overrides: Partial<InventoryPage> = {}): InventoryPage => ({ items: [], query: "", matchingCount: 0, page: 1, pageSize: 25, totalPages: 1, ...overrides });

it("distinguishes empty inventory from no search matches, with an explicitly submitted GET search", () => {
  const view = render(<ListingDashboard query="" inventory={page()} />);
  expect(screen.getByText(/Your saved listings will appear/)).toBeVisible();
  expect(screen.getByRole("searchbox", { name: "Search inventory titles" })).toHaveAttribute("maxlength", "100");
  expect(screen.getByRole("form", { name: "Search saved inventory" })).toHaveAttribute("action", "/listings");
  expect(screen.getByRole("button", { name: "Search titles" })).toHaveAttribute("type", "submit");
  view.rerender(<ListingDashboard query="missing" inventory={page({ query: "missing" })} />);
  expect(screen.getByText(/No saved listings match/)).toBeVisible();
  expect(screen.getByText("0 matching")).toBeVisible();
  expect(screen.getByRole("link", { name: "Clear search" })).toHaveAttribute("href", "/listings");
  expect(screen.queryByRole("navigation", { name: "Inventory pages" })).toBeNull();
});

it("labels filtered counts/current page and preserves escaped search in previous and next links", () => {
  const query = "O'Reilly_%\\";
  render(<ListingDashboard query={query} inventory={page({ query, matchingCount: 51, page: 2, totalPages: 3, items: [item] })} />);
  expect(screen.getByText("51 matching")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 26–26 of 51 matching listings.");
  const navigation = screen.getByRole("navigation", { name: "Inventory pages" });
  expect(within(navigation).getByText("Page 2 of 3")).toHaveAttribute("aria-current", "page");
  expect(within(navigation).getByRole("link", { name: "Previous inventory page" })).toHaveAttribute("href", inventoryHref(query, 1));
  expect(within(navigation).getByRole("link", { name: "Next inventory page" })).toHaveAttribute("href", inventoryHref(query, 3));
  expect(screen.getByRole("link", { name: "Synthetic guitar" })).toHaveAttribute("href", "/listings/item");
  expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/listings/item/edit");
  expect(screen.getByText("$25.00")).toBeVisible();
  expect(screen.getByText("Electric · good")).toBeVisible();
});

it("renders invalid input safely without counts or cards and offers correction", () => {
  const query = '<script>alert("test")</script>';
  const view = render(<ListingDashboard query={query} invalidSearch error="Adjust the search." />);
  expect(screen.getByRole("searchbox")).toHaveValue(query);
  expect(screen.getByRole("searchbox")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("Adjust the search.");
  expect(view.container.querySelector("script")).toBeNull();
  expect(view.container.querySelector(".summary-pill")).toBeNull();
});

it("offers a real reload link for recoverable inventory failures", () => {
  render(<ListingDashboard query="guitar" error="Inventory unavailable." retryHref="/listings?q=guitar" />);
  expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/listings?q=guitar");
  expect(screen.getByRole("searchbox")).not.toHaveAttribute("aria-invalid");
});
