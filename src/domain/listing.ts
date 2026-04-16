export type ListingCondition =
  | "new"
  | "like-new"
  | "good"
  | "fair"
  | "parts-or-repair";

export type ListingCategory =
  | "electronics"
  | "instruments"
  | "home"
  | "collectibles"
  | "other";

export type ListingStatus = "draft" | "active" | "needs-renewal" | "sold";

export interface PostingRecord {
  platform: string;
  url: string;
  datePosted: string;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  category: ListingCategory;
  condition: ListingCondition;
  imageNames: string[];
  createdAt: string;
  updatedAt: string;
  status: ListingStatus;
  postingRecords: PostingRecord[];
}

export interface CreateListingInput {
  title: string;
  description: string;
  price: number;
  category: ListingCategory;
  condition: ListingCondition;
  imageNames: string[];
}

export function createListing(input: CreateListingInput): Listing {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    description: input.description.trim(),
    price: input.price,
    category: input.category,
    condition: input.condition,
    imageNames: input.imageNames,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "draft",
    postingRecords: [],
  };
}

export function validateListingInput(input: CreateListingInput): string[] {
  const errors: string[] = [];

  if (input.title.trim().length < 4) {
    errors.push("Title must be at least 4 characters.");
  }

  if (input.description.trim().length < 20) {
    errors.push("Description must be at least 20 characters.");
  }

  if (!Number.isFinite(input.price) || input.price <= 0) {
    errors.push("Price must be greater than 0.");
  }

  return errors;
}

export function getListingAgeLabel(createdAt: string): string {
  const createdTime = new Date(createdAt).getTime();
  const now = Date.now();
  const hours = Math.max(1, Math.floor((now - createdTime) / (1000 * 60 * 60)));

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
