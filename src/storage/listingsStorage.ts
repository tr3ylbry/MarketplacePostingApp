import { z } from "zod";
import { listingSchema, type Listing } from "../domain/listing";
import { migrateListing } from "./migrateListing";

export const LEGACY_STORAGE_KEY = "marketplace-posting-assistant:listings";
export const STORAGE_KEY = "marketplace-posting-assistant:listings:v2";
const envelopeSchema = z.object({ version: z.literal(2), listings: z.array(z.unknown()) });

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadListings(): Listing[] {
  try {
    if (!canUseStorage()) return [];
    const current = window.localStorage.getItem(STORAGE_KEY);
    const raw = current ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const entries = current !== null ? envelopeSchema.parse(parsed).listings : z.array(z.unknown()).parse(parsed);
    return entries
      .map(entry => current !== null ? listingSchema.safeParse(entry).data ?? null : migrateListing(entry))
      .filter((entry): entry is Listing => entry !== null);
  } catch {
    return [];
  }
}

export function saveListings(listings: Listing[]): boolean {
  try {
    if (!canUseStorage()) return false;
    const validated = z.array(listingSchema).parse(listings);
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      let valid = false;
      try {
        const envelope = envelopeSchema.parse(JSON.parse(existing));
        valid = z.array(listingSchema).safeParse(envelope.listings).success;
      } catch { /* Preserve malformed or unsupported data before replacing it. */ }
      if (!valid) {
        const recoveryKey = `${STORAGE_KEY}:recovery`;
        // Never overwrite an earlier recovery copy with different data.
        const recovery = window.localStorage.getItem(recoveryKey);
        if (recovery !== null && recovery !== existing) return false;
        window.localStorage.setItem(recoveryKey, existing);
      }
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, listings: validated }));
    return true;
  } catch {
    return false;
  }
}
