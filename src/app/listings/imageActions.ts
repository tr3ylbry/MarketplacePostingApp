"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "../../auth/session";
import { imageService, listingService } from "../../application/server";
import { ImageOperationError } from "../../application/imageStorage";
import { ListingUnavailableError } from "../../application/listingRepository";

async function perform<T>(operation: (owner: string) => Promise<T>) {
  const user = await requireUser();
  try { return { ok: true as const, data: await operation(user.id) }; }
  catch (error) {
    if (error instanceof ZodError) return { ok: false as const, error: "Use JPEG, PNG, or WebP files up to 10 MiB, with filenames up to 255 characters." };
    if (error instanceof ImageOperationError || error instanceof ListingUnavailableError) return { ok: false as const, error: error.message };
    console.warn("Image operation failed; provider/database details withheld.");
    return { ok: false as const, error: "The image operation could not be completed. Reload and try again." };
  }
}
export async function prepareImageAction(listingId: string, input: unknown) {
  return perform(owner => imageService().prepare(owner, listingId, input));
}
async function updated(owner: string, listingId: string) {
  revalidatePath("/listings", "layout");
  const listing = await listingService().getListing(owner, listingId);
  if (!listing) throw new ListingUnavailableError();
  return listing;
}
export async function finalizeImageAction(listingId: string, imageId: string) {
  return perform(async owner => { await imageService().finalize(owner, listingId, imageId); return updated(owner, listingId); });
}
export async function removeImageAction(listingId: string, imageId: string) {
  return perform(async owner => { await imageService().remove(owner, listingId, imageId); return updated(owner, listingId); });
}
export async function reorderImagesAction(listingId: string, imageIds: unknown) {
  return perform(async owner => { await imageService().reorder(owner, listingId, imageIds); return updated(owner, listingId); });
}
