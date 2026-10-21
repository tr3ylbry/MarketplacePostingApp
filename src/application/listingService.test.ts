import { createListingService } from "./listingService";
import { ListingConflictError, type ListingRepository } from "./listingRepository";
import { listingFixture } from "../test/fixtures";

function setup() {
  const repository: ListingRepository = {
    list: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue(null),
    create: vi.fn(async value => value), update: vi.fn(async value => value),
    delete: vi.fn().mockResolvedValue(undefined), importListings: vi.fn().mockResolvedValue({ imported: 1, skipped: 0 }),
  };
  return { repository, service: createListingService(repository) };
}
it("creates server-owned IDs, timestamps and status and discards injected publication state", async () => {
  const { repository, service } = setup();
  const input = listingFixture();
  const result = await service.createListing({ ...input, id: "injected", status: "sold", createdAt: "2000-01-01T00:00:00.000Z", imageNames: ["front.jpg"] });
  expect(result.id).not.toBe("injected");
  expect(result.status).toBe("draft");
  expect(result.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
  expect(result.images[0].listingId).toBe(result.id);
  expect(repository.create).toHaveBeenCalledOnce();
});
it("rejects invalid mutations and imports before repository access", async () => {
  const { repository, service } = setup();
  await expect(service.createListing({ askingPrice: { amount: -1 } })).rejects.toThrow();
  await expect(service.importListings([{}])).rejects.toThrow();
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.importListings).not.toHaveBeenCalled();
});
it("rejects missing or stale edits", async () => {
  const { repository, service } = setup();
  const listing = listingFixture();
  await expect(service.updateListing(listing.id, listing, listing.updatedAt)).rejects.toBeInstanceOf(ListingConflictError);
  vi.mocked(repository.getById).mockResolvedValue(listing);
  await expect(service.updateListing(listing.id, listing, "2000-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(ListingConflictError);
  expect(repository.update).not.toHaveBeenCalled();
});
it("passes validated reads, deletion and imports to the repository", async () => {
  const { repository, service } = setup();
  await service.listListings(); await service.getListing("item"); await service.deleteListing("item");
  expect(repository.list).toHaveBeenCalledOnce();
  expect(repository.getById).toHaveBeenCalledWith("item");
  expect(repository.delete).toHaveBeenCalledWith("item");
  expect(await service.importListings([listingFixture()])).toEqual({ imported: 1, skipped: 0 });
});
