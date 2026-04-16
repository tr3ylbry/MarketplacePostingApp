import type { Listing } from "../domain/listing";

const STORAGE_KEY = "marketplace-posting-assistant:listings";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadListings(): Listing[] {
  if (!canUseStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as Listing[];
  } catch {
    return [];
  }
}

export function saveListings(listings: Listing[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(listings));
}
