import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ReverbManagement } from "./ReverbManagement";
import ReverbDraftPage from "../../app/listings/[id]/reverb/page";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), load: vi.fn(), remove: vi.fn(), routerRefresh: vi.fn(),
  localState: vi.fn(), options: vi.fn(), shop: vi.fn(), categories: vi.fn(), conditions: vi.fn(), findBySku: vi.fn(), createDraft: vi.fn(), deleteDraft: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }), notFound: () => { throw new Error("Not found"); } }));
vi.mock("../../auth/session", () => ({ requireUser: async () => ({ id: "owner" }) }));
vi.mock("../../application/server", () => ({ listingService: () => ({ getListing: async () => ({ id: "listing" }) }) }));
vi.mock("../../application/reverbServer", () => ({ reverbService: () => mocks }));
vi.mock("../../app/settings/integrations/reverb/actions", () => ({
  loadReverbOptions: mocks.load, refreshReverbStatus: mocks.refresh, deleteReverbDraft: mocks.remove,
  prepareReverb: vi.fn(), createReverbDraft: mocks.createDraft,
}));
const state = { environment: "sandbox" as const, connected: true, shopName: "Test shop", publication: undefined };
beforeEach(() => { vi.clearAllMocks(); mocks.localState.mockResolvedValue(state); });
it("server page rendering and hydration never call provider methods or actions", async () => {
  render(await ReverbDraftPage({ params: Promise.resolve({ id: "listing" }) }));
  expect(screen.getByRole("heading", { name: "Reverb — SANDBOX" })).toBeVisible();
  expect(mocks.localState).toHaveBeenCalledWith("owner", "listing");
  for (const [key, mock] of Object.entries(mocks)) if (key !== "localState") expect(mock).not.toHaveBeenCalled();
});
it("loads provider options only after the explicit button action", async () => {
  mocks.load.mockResolvedValue({ ok: true, data: { ...state, categories: [], conditions: [], shippingProfiles: [], unavailableImages: 0, shippingRate: 0 } });
  render(<ReverbManagement listingId="listing" initialState={state} />);
  expect(mocks.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load Reverb Options" }));
  await screen.findByLabelText("Reverb category"); expect(mocks.load).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.createDraft).not.toHaveBeenCalled();
});
it("explicit refresh updates persisted state without loading options", async () => {
  mocks.refresh.mockResolvedValue({ ok: true, data: { ...state, message: "Checked" } });
  render(<ReverbManagement listingId="listing" initialState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh Reverb Status" }));
  await screen.findByText("Checked"); expect(mocks.refresh).toHaveBeenCalledWith("listing"); expect(mocks.load).not.toHaveBeenCalled();
});
it("requires confirmation and offers delete only for a persisted draft identity", async () => {
  const publication = { id: "p", listingId: "listing", marketplace: "reverb" as const, status: "draft" as const, externalListingId: "remote", providerState: "draft" };
  const view = render(<ReverbManagement listingId="listing" initialState={{ ...state, publication }} />);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Delete Reverb Draft" })); expect(mocks.remove).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); mocks.remove.mockResolvedValue({ ok: true, data: { ...state, message: "Missing" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete Reverb Draft" })); await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  view.rerender(<ReverbManagement listingId="listing" initialState={{ ...state, publication: { ...publication, providerState: "live" } }} />);
  expect(screen.queryByRole("button", { name: "Delete Reverb Draft" })).not.toBeInTheDocument(); confirm.mockRestore();
});
