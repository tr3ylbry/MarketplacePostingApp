import { act, useState } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ImageGallery } from "./ImageGallery";
import { listingFixture } from "../../../test/fixtures";
import { imagesFromNames } from "../../../domain/listingImage";
import { removeImageAction, reorderImagesAction } from "../../../app/listings/imageActions";

vi.mock("../../../app/listings/imageActions", () => ({ prepareImageAction: vi.fn(), finalizeImageAction: vi.fn(), removeImageAction: vi.fn(), reorderImagesAction: vi.fn() }));

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
