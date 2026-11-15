import { render, screen } from "@testing-library/react";
import ListingsPage from "./page";

const { requireUser, listInventory, listListings, redirect } = vi.hoisted(() => ({
  requireUser: vi.fn(), listInventory: vi.fn(), listListings: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("../../auth/session", () => ({ requireUser }));
vi.mock("../../application/server", () => ({ listingService: () => ({ listInventory, listListings }) }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ importListingsAction: vi.fn(), deleteListingAction: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); requireUser.mockResolvedValue({ id: "session-owner" }); });

it("uses only session ownership and the focused summary service", async () => {
  listInventory.mockResolvedValue({ items: [], query: "guitar", page: 2, pageSize: 25, totalPages: 2, matchingCount: 26 });
  await ListingsPage({ searchParams: Promise.resolve({ q: "guitar", page: "2" }) });
  expect(listInventory).toHaveBeenCalledWith("session-owner", { query: "guitar", page: 2 });
  expect(listListings).not.toHaveBeenCalled();
});

it("normalizes malformed/repeated pages and unsupported owner parameters before database access", async () => {
  for (const params of [{ q: " guitar ", page: "-1" }, { q: "guitar", page: ["2", "3"] }, { q: "guitar", ownerId: "foreign" }]) {
    await expect(ListingsPage({ searchParams: Promise.resolve(params) })).rejects.toThrow("redirect:/listings?q=guitar");
  }
  expect(listInventory).not.toHaveBeenCalled();
});

it("normalizes stale final-page URLs after the count-based repository clamp", async () => {
  listInventory.mockResolvedValue({ items: [], query: "guitar", page: 1, pageSize: 25, totalPages: 1, matchingCount: 25 });
  await expect(ListingsPage({ searchParams: Promise.resolve({ q: "guitar", page: "2" }) })).rejects.toThrow("redirect:/listings?q=guitar");
});

it("never executes invalid searches and bounds the value shown for editing", async () => {
  render(await ListingsPage({ searchParams: Promise.resolve({ q: "x".repeat(101) }) }));
  expect(screen.getByRole("alert")).toHaveTextContent(/100/);
  expect(screen.getByRole("searchbox")).toHaveValue("x".repeat(100));
  expect(listInventory).not.toHaveBeenCalled();
});

it("keeps database details out of recoverable errors and propagates authentication redirects", async () => {
  listInventory.mockRejectedValue(new Error("private SQL/connection information"));
  const view = render(await ListingsPage({ searchParams: Promise.resolve({ q: "guitar" }) }));
  expect(screen.getByRole("alert")).toHaveTextContent("Saved inventory could not be loaded.");
  expect(view.container.textContent).not.toContain("private SQL");
  requireUser.mockRejectedValue(new Error("redirect:/sign-in"));
  await expect(ListingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/sign-in");
  expect(listInventory).toHaveBeenCalledTimes(1);
});
