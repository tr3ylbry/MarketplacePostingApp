import { createListingAction, updateListingAction, deleteListingAction, importListingsAction } from "./actions";
import { listingFixture } from "../../test/fixtures";

const { requireUser, create, update, remove, importBatch } = vi.hoisted(() => ({ requireUser: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), importBatch: vi.fn() }));
vi.mock("../../auth/session", () => ({ requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../application/server", () => ({ listingService: () => ({ createListing: create, updateListing: update, deleteListing: remove, importListings: importBatch }) }));
beforeEach(() => { vi.resetAllMocks(); });

it("denies every unauthenticated mutation before reaching the service", async () => {
  requireUser.mockRejectedValue(new Error("redirect:/sign-in"));
  const listing = listingFixture();
  for (const action of [() => createListingAction(listing), () => updateListingAction(listing.id, listing, listing.updatedAt), () => deleteListingAction(listing.id), () => importListingsAction([listing])]) {
    await expect(action()).rejects.toThrow("redirect:/sign-in");
  }
  for (const fn of [create, update, remove, importBatch]) expect(fn).not.toHaveBeenCalled();
});

it("uses only server-derived user identity for every mutation and returns generic failures", async () => {
  requireUser.mockResolvedValue({ id: "session-user", name: "User" });
  const listing = { ...listingFixture(), ownerId: "attacker-supplied" };
  await createListingAction(listing);
  await updateListingAction(listing.id, listing, listing.updatedAt);
  await deleteListingAction(listing.id);
  await importListingsAction([listing]);
  expect(create).toHaveBeenCalledWith("session-user", listing);
  expect(update).toHaveBeenCalledWith("session-user", listing.id, listing, listing.updatedAt);
  expect(remove).toHaveBeenCalledWith("session-user", listing.id);
  expect(importBatch).toHaveBeenCalledWith("session-user", [listing]);
  create.mockRejectedValue(new Error("private SQL/connection details"));
  const result = await createListingAction(listing);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private SQL");
});
