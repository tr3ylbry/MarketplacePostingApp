import { normalizeListing, type Listing } from "../domain/listing";

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
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => normalizeListing(entry))
      .filter((entry): entry is Listing => entry !== null);
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
