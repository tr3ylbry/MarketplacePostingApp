"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { listingService } from "../../application/server";
import { ListingConflictError } from "../../application/listingRepository";

async function perform<T>(operation: () => Promise<T>) {
  try {
    const data = await operation();
    revalidatePath("/listings", "layout");
    return { ok: true as const, data };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false as const, error: "Invalid listing data. Check required fields, amounts, and image metadata." };
    if (error instanceof ListingConflictError) return { ok: false as const, error: error.message };
    // Do not expose database URLs, SQL, or submitted personal details to clients/logs.
    return { ok: false as const, error: "The listing could not be saved. Check the database connection and try again." };
  }
}

export async function createListingAction(input: unknown) {
  return perform(() => listingService().createListing(input));
}
export async function updateListingAction(id: string, input: unknown, expectedUpdatedAt: string) {
  return perform(() => listingService().updateListing(id, input, expectedUpdatedAt));
}
export async function deleteListingAction(id: string) {
  return perform(() => listingService().deleteListing(id));
}
export async function importListingsAction(input: unknown) {
  return perform(() => listingService().importListings(input));
}
