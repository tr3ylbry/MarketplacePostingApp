import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { EbayPrivatePhotos } from "./EbayPrivatePhotos";
const prepare = vi.hoisted(() => vi.fn());
vi.mock("../../app/listings/[id]/ebay/actions", () => ({ prepareEbayPrivateImageAction: prepare }));
const props = { listingId: "listing", version: "version", connected: true, photos: [{ id: "image", order: 0, name: "synthetic.png", supported: true }] };
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());

it("expires a temporary review visibly without another provider or storage action", async () => {
  vi.useFakeTimers();
  prepare.mockResolvedValueOnce({ ok: true, data: { width: 500, height: 600, size: 1200, expiresAt: new Date(Date.now() + 1000).toISOString() } });
  render(<EbayPrivatePhotos {...props} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Validate photo 1" })));
  expect(screen.getByText(/Photo verified for local export review/)).toBeVisible();
  await act(async () => vi.advanceTimersByTime(1001));
  expect(screen.getByRole("status")).toHaveTextContent("Photo review expired. Validate this photo again.");
  expect(screen.queryByText(/Photo verified for local export review/)).not.toBeInTheDocument();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Validate photo 1" })).toBeEnabled();
});
it("makes no passive calls and keeps upload unavailable even after hydration", () => {
  const html = renderToString(<EbayPrivatePhotos {...props} />);
  expect(html).toContain('disabled=""'); expect(prepare).not.toHaveBeenCalled();
  render(<EbayPrivatePhotos {...props} />);
  expect(prepare).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Upload to eBay — unavailable" })).toBeDisabled();
  expect(screen.getByText(/Sending photos to eBay is not available yet/)).toBeVisible();
});
it("validates only the explicitly selected image and shows no source or provider capability", async () => {
  prepare.mockResolvedValueOnce({ ok: true, data: { imageId: "image", width: 500, height: 600, size: 1200, expiresAt: "2099-01-01T00:00:00.000Z", exportEnabled: false, exportStatus: "not-attempted" } });
  render(<EbayPrivatePhotos {...props} />); fireEvent.click(screen.getByRole("button", { name: "Validate photo 1" }));
  expect(await screen.findByText(/Photo verified for local export review/)).toHaveTextContent("500 × 600");
  expect(prepare).toHaveBeenCalledExactlyOnceWith("listing", "version", "image");
  expect(screen.getByText(/Export not attempted/)).toBeVisible(); expect(screen.getByRole("button", { name: "Upload to eBay — unavailable" })).toBeDisabled();
});
it.each(["unsupported", "disconnected", "empty"])("handles %s without a provider request", kind => {
  render(<EbayPrivatePhotos {...props} connected={kind !== "disconnected"} photos={kind === "empty" ? [] : [{ ...props.photos[0], supported: kind !== "unsupported" }]} />);
  if (kind === "empty") expect(screen.getByText(/No local photos/)).toBeVisible();
  else expect(screen.getByRole("button", { name: "Validate photo 1" })).toBeDisabled();
  expect(prepare).not.toHaveBeenCalled();
});
it("clears an earlier review when a repeated explicit check fails", async () => {
  prepare.mockResolvedValueOnce({ ok: true, data: { width: 500, height: 500, size: 1000, expiresAt: "2099-01-01T00:00:00.000Z" } }).mockResolvedValueOnce({ ok: false, error: "Photo changed. Reload." });
  render(<EbayPrivatePhotos {...props} />); const button = screen.getByRole("button", { name: "Validate photo 1" });
  fireEvent.click(button); await screen.findByText(/Photo verified for local export review/);
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Photo changed"); expect(screen.queryByText(/Photo verified for local export review/)).not.toBeInTheDocument();
});
