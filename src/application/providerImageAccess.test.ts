import { createProviderImageAccess } from "./providerImageAccess";
import { CLEANUP_GRACE_MS, PROVIDER_READ_TTL_MS } from "./imageStorage";

const repository = { retainForProvider: vi.fn(async () => "images/trusted/photo.png") };
const signer = { signProviderReadAccess: vi.fn(async () => "https://private.example/capability") };
const service = createProviderImageAccess(repository, signer);
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it("commits owner-scoped retention before signing with the same absolute expiry despite latency", async () => {
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
  repository.retainForProvider.mockImplementationOnce(async () => {
    expect(signer.signProviderReadAccess).not.toHaveBeenCalled();
    vi.mocked(Date.now).mockReturnValue(now + 30000);
    return "images/trusted/photo.png";
  });
  await service.createProviderReadAccess("owner", "listing", "image");
  expect(repository.retainForProvider).toHaveBeenCalledWith("owner", "listing", "image", new Date(now + PROVIDER_READ_TTL_MS + CLEANUP_GRACE_MS).toISOString());
  expect(signer.signProviderReadAccess).toHaveBeenCalledWith("images/trusted/photo.png", now + PROVIDER_READ_TTL_MS);
});
it("never signs if durable retention fails", async () => {
  repository.retainForProvider.mockRejectedValueOnce(new Error("DB failure"));
  await expect(service.createProviderReadAccess("owner", "listing", "image")).rejects.toThrow("DB failure");
  expect(signer.signProviderReadAccess).not.toHaveBeenCalled();
});
it("does not undo retention or retry signing after a signing failure", async () => {
  signer.signProviderReadAccess.mockRejectedValueOnce(new Error("Signing failed"));
  await expect(service.createProviderReadAccess("owner", "listing", "image")).rejects.toThrow("Signing failed");
  expect(repository.retainForProvider).toHaveBeenCalledOnce();
  expect(signer.signProviderReadAccess).toHaveBeenCalledOnce();
});
it("validates identity before retention or signing", async () => {
  for (const args of [["", "listing", "image"], ["owner", "", "image"], ["owner", "listing", ""]]) {
    await expect(service.createProviderReadAccess(args[0], args[1], args[2])).rejects.toThrow();
  }
  expect(repository.retainForProvider).not.toHaveBeenCalled(); expect(signer.signProviderReadAccess).not.toHaveBeenCalled();
});
