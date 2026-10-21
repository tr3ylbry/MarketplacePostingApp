import { createListingService } from "./listingService";
import { ListingConflictError, type ListingRepository } from "./listingRepository";
import { listingFixture } from "../test/fixtures";
const ownerId = "user-a";

function setup() {
  const repository: ListingRepository = {
    list: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (_ownerId, value) => value), update: vi.fn(async (_ownerId, value) => value),
    delete: vi.fn().mockResolvedValue(undefined), importListings: vi.fn().mockResolvedValue({ imported: 1, skipped: 0 }),
  };
  return { repository, service: createListingService(repository) };
}
it("creates server-owned IDs, timestamps and status and discards injected publication state", async () => {
  const { repository, service } = setup();
  const input = listingFixture();
  const result = await service.createListing(ownerId, { ...input, ownerId: "user-b", id: "injected", status: "sold", createdAt: "2000-01-01T00:00:00.000Z", imageNames: ["front.jpg"] });
  expect(result.id).not.toBe("injected");
  expect(result.status).toBe("draft");
  expect(result.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
  expect(result.images[0].listingId).toBe(result.id);
  expect(repository.create).toHaveBeenCalledOnce();
  expect(repository.create).toHaveBeenCalledWith(ownerId, result);
  expect(result).not.toHaveProperty("ownerId");
});
it("rejects invalid mutations and imports before repository access", async () => {
  const { repository, service } = setup();
  await expect(service.createListing(ownerId, { askingPrice: { amount: -1 } })).rejects.toThrow();
  await expect(service.importListings(ownerId, [{}])).rejects.toThrow();
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.importListings).not.toHaveBeenCalled();
});
it("rejects missing or stale edits", async () => {
  const { repository, service } = setup();
  const listing = listingFixture();
  await expect(service.updateListing(ownerId, listing.id, listing, listing.updatedAt)).rejects.toBeInstanceOf(ListingConflictError);
  vi.mocked(repository.getById).mockResolvedValue(listing);
  await expect(service.updateListing(ownerId, listing.id, listing, "2000-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(ListingConflictError);
  expect(repository.update).not.toHaveBeenCalled();
});
it("passes validated reads, deletion and imports to the repository", async () => {
  const { repository, service } = setup();
  await service.listListings(ownerId); await service.getListing(ownerId, "item"); await service.deleteListing(ownerId, "item");
  expect(repository.list).toHaveBeenCalledOnce();
  expect(repository.getById).toHaveBeenCalledWith(ownerId, "item");
  expect(repository.delete).toHaveBeenCalledWith(ownerId, "item");
  expect(await service.importListings(ownerId, [listingFixture()])).toEqual({ imported: 1, skipped: 0 });
});
it("rejects missing and migration-holder identities before persistence", async () => {
  const { repository, service } = setup();
  for (const id of ["", "legacy-unclaimed"]) {
    await expect(service.createListing(id, listingFixture())).rejects.toThrow();
    expect(() => service.listListings(id)).toThrow();
  }
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.list).not.toHaveBeenCalled();
});
