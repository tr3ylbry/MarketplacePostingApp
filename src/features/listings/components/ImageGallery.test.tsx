import { act, useState } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ImageGallery } from "./ImageGallery";
import { listingFixture } from "../../../test/fixtures";
import { imagesFromNames } from "../../../domain/listingImage";
import { removeImageAction, reorderImagesAction } from "../../../app/listings/imageActions";
import { BUNDLE_TIMEOUT_MS } from "../photoBundleDownload";

vi.mock("../../../app/listings/imageActions", () => ({ prepareImageAction: vi.fn(), finalizeImageAction: vi.fn(), removeImageAction: vi.fn(), reorderImagesAction: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function bundleListing(count: number, size = 1) {
  const listing = listingFixture({ selectedPlatforms: ["ebay", "craigslist", "reverb", "offerup", "facebook-marketplace"] });
  listing.images = imagesFromNames(listing.id, Array.from({ length: count }, (_, index) => `photo-${index}.png`)).map(image => ({ ...image, source: {
    kind: "vercel-blob", pathname: `images/${image.id}/test.png`, originalFilename: imageNameForTest(image.order), contentType: "image/png", size,
    uploadedAt: "2026-01-01T00:00:00.000Z",
  } }));
  return listing;
}
function imageNameForTest(order: number) { return `photo-${order}.png`; }
function bundleBrowser() {
  const NativeURL = URL;
  const create = vi.fn(() => "blob:synthetic-gallery-bundle"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  vi.stubGlobal("scheduler", { yield: vi.fn(async () => {}) });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { create, revoke, click };
}

it("rejects an oversized plan before any photo fetch", async () => {
  bundleBrowser(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<ImageGallery listing={bundleListing(4, 10 * 1024 * 1024)} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Photo Bundle" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/32 MiB/);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Download Photo Bundle" })).toBeEnabled();
});

it("downloads only needed identities and guards repeated clicks synchronously", async () => {
  const { create } = bundleBrowser(); const listing = bundleListing(40);
  const fetch = vi.fn(async () => new Response(new Uint8Array([42]))); vi.stubGlobal("fetch", fetch);
  const view = render(<ImageGallery listing={listing} />);
  const button = screen.getByRole("button", { name: "Download Photo Bundle" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Photo bundle prepared."));
  expect(fetch).toHaveBeenCalledTimes(25); expect(create).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.map(call => (call as unknown as [string])[0])).toEqual(listing.images.slice(0, 25).map(image => `/api/listings/${listing.id}/images/${image.id}`));
  view.unmount();
});

it("cancels a pending read, stops further fetches and restores meaningful focus", async () => {
  const { create } = bundleBrowser(); const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const fetch = vi.fn(async () => new Response(stream)); vi.stubGlobal("fetch", fetch);
  render(<ImageGallery listing={bundleListing(2)} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Photo Bundle" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel photo bundle" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Photo bundle cancelled."));
  expect(screen.getByRole("button", { name: "Download Photo Bundle" })).toHaveFocus();
  expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  expect(create).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
});

it("aborts on unmount and does not prepare a later download", async () => {
  const { create } = bundleBrowser(); const stream = new ReadableStream<Uint8Array>();
  const fetch = vi.fn(async () => new Response(stream)); vi.stubGlobal("fetch", fetch);
  const view = render(<ImageGallery listing={bundleListing(2)} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Photo Bundle" }));
  await waitFor(() => expect(stream.locked).toBe(true));
  const abortSignal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal;
  view.unmount();
  await waitFor(() => expect(stream.locked).toBe(false));
  expect(abortSignal?.aborted).toBe(true); expect(create).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cleans up a failed click and permits a deliberate retry", async () => {
  const { create, revoke, click } = bundleBrowser();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([42]))));
  click.mockImplementationOnce(() => { throw new Error("Synthetic click failure"); });
  const view = render(<ImageGallery listing={bundleListing(1)} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Photo Bundle" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic click failure");
  expect(revoke).toHaveBeenCalledTimes(1); expect(document.querySelector("a[download]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Download Photo Bundle" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Photo bundle prepared."));
  expect(create).toHaveBeenCalledTimes(2); expect(screen.queryByRole("alert")).toBeNull();
  view.unmount();
  await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2), { timeout: 1500 });
});

it("times out stalled work and returns a recoverable error", async () => {
  bundleBrowser(); const stream = new ReadableStream<Uint8Array>();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
  let expire: (() => void) | undefined;
  const nativeTimeout = setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    if (delay === BUNDLE_TIMEOUT_MS) expire = callback as () => void;
    return nativeTimeout(callback, delay, ...args);
  });
  render(<ImageGallery listing={bundleListing(1)} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Photo Bundle" }));
  await waitFor(() => expect(stream.locked).toBe(true));
  act(() => expire!());
  expect(await screen.findByRole("alert")).toHaveTextContent("Photo bundle timed out.");
  expect(screen.getByRole("button", { name: "Download Photo Bundle" })).toBeEnabled();
  expect(stream.locked).toBe(false);
});

it("announces removal and moves focus to a remaining photo, then to upload when empty", async () => {
  const initial = listingFixture(); initial.images = imagesFromNames(initial.id, ["first.png", "second.png"]);
  vi.mocked(removeImageAction).mockResolvedValueOnce({ ok: true, data: { ...initial, images: [{ ...initial.images[1], order: 0 }] } })
    .mockResolvedValueOnce({ ok: true, data: { ...initial, images: [] } });
  function Gallery() { const [listing, setListing] = useState(initial); return <ImageGallery listing={listing} onChange={setListing} />; }
  render(<Gallery />);
  fireEvent.click(screen.getByRole("button", { name: "Remove first.png" }));
  await waitFor(() => expect(screen.getByRole("listitem", { name: "Photo 1: second.png" })).toHaveFocus());
  expect(screen.getByRole("status")).toHaveTextContent("Photo removed from this local listing.");
  fireEvent.click(screen.getByRole("button", { name: "Remove second.png" }));
  await waitFor(() => expect(screen.getByLabelText("Upload photos")).toHaveFocus());
  expect(screen.getByText(/No photos yet/)).toBeVisible();
});

it("retains meaningful focus and announces the new position after reordering", async () => {
  const initial = listingFixture(); initial.images = imagesFromNames(initial.id, ["first.png", "second.png"]);
  vi.mocked(reorderImagesAction).mockResolvedValueOnce({ ok: true, data: { ...initial, images: [{ ...initial.images[1], order: 0 }, { ...initial.images[0], order: 1 }] } });
  function Gallery() { const [listing, setListing] = useState(initial); return <ImageGallery listing={listing} onChange={setListing} />; }
  render(<Gallery />); fireEvent.click(screen.getByRole("button", { name: "Move second.png earlier" }));
  await waitFor(() => expect(screen.getByRole("listitem", { name: "Photo 1: second.png" })).toHaveFocus());
  expect(screen.getByRole("status")).toHaveTextContent("Moved second.png to position 1 of 2.");
});

it("keeps server-rendered photo controls disabled until hydration attaches their handlers", async () => {
  const element = <ImageGallery listing={listingFixture()} onChange={vi.fn()} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  let root: Root | undefined;
  try {
    expect(within(container).getByLabelText("Upload photos")).toBeDisabled();
    await act(async () => { root = hydrateRoot(container, element); });
    expect(within(container).getByLabelText("Upload photos")).toBeEnabled();
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    container.remove();
  }
});
