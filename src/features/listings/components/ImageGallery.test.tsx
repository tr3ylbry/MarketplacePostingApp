import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/react";
import { ImageGallery } from "./ImageGallery";
import { listingFixture } from "../../../test/fixtures";

vi.mock("../../../app/listings/imageActions", () => ({ prepareImageAction: vi.fn(), finalizeImageAction: vi.fn(), removeImageAction: vi.fn(), reorderImagesAction: vi.fn() }));

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
