export type ListingStatus = "draft" | "active" | "needs-renewal" | "sold";

export interface PostingRecord {
  platform: string;
  url: string;
  datePosted: string;
}

export interface Listing {
  id: string;
  brand: string;
  model: string;
  year: string;
  finish: string;
  manufacturerCountry: string;
  category: string;
  subcategory: string;
  additionalSubcategory: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  youtubeLink: string;
  purchasePrice: string;
  shippingRate: string;
  imageNames: string[];
  createdAt: string;
  updatedAt: string;
  status: ListingStatus;
  postingRecords: PostingRecord[];
}

export interface CreateListingInput {
  brand: string;
  model: string;
  year: string;
  finish: string;
  manufacturerCountry: string;
  category: string;
  subcategory: string;
  additionalSubcategory: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  youtubeLink: string;
  purchasePrice: string;
  shippingRate: string;
  imageNames: string[];
}

const MAX_TEXT_FIELD_LENGTH = 35;

function normalizeText(value: string): string {
  return value.trim();
}

export function createListing(input: CreateListingInput): Listing {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    brand: normalizeText(input.brand),
    model: normalizeText(input.model),
    year: normalizeText(input.year),
    finish: normalizeText(input.finish),
    manufacturerCountry: normalizeText(input.manufacturerCountry),
    category: normalizeText(input.category),
    subcategory: normalizeText(input.subcategory),
    additionalSubcategory: normalizeText(input.additionalSubcategory),
    title: normalizeText(input.title),
    description: input.description.trim(),
    price: input.price,
    condition: normalizeText(input.condition),
    youtubeLink: normalizeText(input.youtubeLink),
    purchasePrice: normalizeText(input.purchasePrice),
    shippingRate: normalizeText(input.shippingRate),
    imageNames: input.imageNames,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "draft",
    postingRecords: [],
  };
}

export function validateListingInput(input: CreateListingInput): string[] {
  const errors: string[] = [];
  const textFields: Array<[label: string, value: string]> = [
    ["Brand", input.brand],
    ["Model", input.model],
    ["Year", input.year],
    ["Finish", input.finish],
    ["Manufacturer country", input.manufacturerCountry],
    ["Category", input.category],
    ["Subcategory", input.subcategory],
    ["Additional subcategory", input.additionalSubcategory],
    ["Title", input.title],
    ["Condition", input.condition],
    ["YouTube link", input.youtubeLink],
    ["Purchase price", input.purchasePrice],
    ["Shipping rate", input.shippingRate],
  ];

  if (input.title.trim().length < 4) {
    errors.push("Title must be at least 4 characters.");
  }

  if (input.description.trim().length < 20) {
    errors.push("Description must be at least 20 characters.");
  }

  if (!Number.isFinite(input.price) || input.price <= 0) {
    errors.push("Price must be greater than 0.");
  }

  for (const [label, value] of textFields) {
    if (value.trim().length > MAX_TEXT_FIELD_LENGTH) {
      errors.push(`${label} must be 35 characters or fewer.`);
    }
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
