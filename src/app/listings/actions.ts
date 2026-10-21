"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { listingService } from "../../application/server";
import { ListingConflictError, ListingUnavailableError } from "../../application/listingRepository";
import { requireUser } from "../../auth/session";

async function perform<T>(operation: (ownerId: string) => Promise<T>) {
  // Outside the error handler: Next redirects must propagate, not become save errors.
  const user = await requireUser();
  try {
    const data = await operation(user.id);
    revalidatePath("/listings", "layout");
    return { ok: true as const, data };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false as const, error: "Invalid listing data. Check required fields, amounts, and image metadata." };
    if (error instanceof ListingConflictError || error instanceof ListingUnavailableError) return { ok: false as const, error: error.message };
    // Do not expose database URLs, SQL, or submitted personal details to clients/logs.
    return { ok: false as const, error: "The listing could not be saved. Check the database connection and try again." };
  }
}

export async function createListingAction(input: unknown) {
  return perform(ownerId => listingService().createListing(ownerId, input));
}
export async function updateListingAction(id: string, input: unknown, expectedUpdatedAt: string) {
  return perform(ownerId => listingService().updateListing(ownerId, id, input, expectedUpdatedAt));
}
export async function deleteListingAction(id: string) {
  return perform(ownerId => listingService().deleteListing(ownerId, id));
}
export async function importListingsAction(input: unknown) {
  return perform(ownerId => listingService().importListings(ownerId, input));
}
