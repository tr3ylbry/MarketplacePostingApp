export type ListingStatus = "draft" | "active" | "needs-renewal" | "sold";

export interface PostingRecord {
  platform: string;
  url: string;
  datePosted: string;
}

export interface Listing {
  id: string;
  isMusicalItem: boolean;
  brand: string;
  model: string;
  type: string;
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
  craigslistCity: string;
  craigslistZipCode: string;
  craigslistSizeDimensions: string;
  craigslistPhoneNumber: string;
  craigslistContactName: string;
  craigslistStreet: string;
  craigslistCrossStreet: string;
  imageNames: string[];
  createdAt: string;
  updatedAt: string;
  status: ListingStatus;
  postingRecords: PostingRecord[];
}

export interface CreateListingInput {
  isMusicalItem: boolean;
  brand: string;
  model: string;
  type: string;
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
  craigslistCity: string;
  craigslistZipCode: string;
  craigslistSizeDimensions: string;
  craigslistPhoneNumber: string;
  craigslistContactName: string;
  craigslistStreet: string;
  craigslistCrossStreet: string;
  imageNames: string[];
}

const MAX_TEXT_FIELD_LENGTH = 35;
const MAX_IMAGE_COUNT = 25;

function normalizeText(value: string): string {
  return value.trim();
}

export function createListing(input: CreateListingInput): Listing {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    isMusicalItem: input.isMusicalItem,
    brand: normalizeText(input.brand),
    model: normalizeText(input.model),
    type: normalizeText(input.type),
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
    craigslistCity: normalizeText(input.craigslistCity),
    craigslistZipCode: normalizeText(input.craigslistZipCode),
    craigslistSizeDimensions: normalizeText(input.craigslistSizeDimensions),
    craigslistPhoneNumber: normalizeText(input.craigslistPhoneNumber),
    craigslistContactName: normalizeText(input.craigslistContactName),
    craigslistStreet: normalizeText(input.craigslistStreet),
    craigslistCrossStreet: normalizeText(input.craigslistCrossStreet),
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
    ["Type", input.type],
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
    ["Craigslist city or neighborhood", input.craigslistCity],
    ["Craigslist zip code", input.craigslistZipCode],
    ["Craigslist size or dimensions", input.craigslistSizeDimensions],
    ["Craigslist phone number", input.craigslistPhoneNumber],
    ["Craigslist contact name", input.craigslistContactName],
    ["Craigslist street", input.craigslistStreet],
    ["Craigslist cross street", input.craigslistCrossStreet],
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

  if (input.craigslistCity.trim().length === 0) {
    errors.push("Craigslist city or neighborhood is required.");
  }

  if (input.craigslistZipCode.trim().length === 0) {
    errors.push("Craigslist zip code is required.");
  }

  if (input.craigslistPhoneNumber.trim().length === 0) {
    errors.push("Craigslist phone number is required.");
  }

  if (input.craigslistContactName.trim().length === 0) {
    errors.push("Craigslist contact name is required.");
  }

  if (input.imageNames.length > MAX_IMAGE_COUNT) {
    errors.push("You can upload up to 25 photos.");
  }

  for (const [label, value] of textFields) {
    if (value.trim().length > MAX_TEXT_FIELD_LENGTH) {
      errors.push(`${label} must be 35 characters or fewer.`);
    }
  }

  return errors;
}

export function updateListing(listing: Listing, input: CreateListingInput): Listing {
  const updated = createListing(input);

  return {
    ...updated,
    id: listing.id,
    createdAt: listing.createdAt,
    postingRecords: listing.postingRecords,
    status: listing.status,
    updatedAt: new Date().toISOString(),
  };
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

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function getPostingRecords(value: unknown): PostingRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((record): record is PostingRecord => {
      if (!record || typeof record !== "object") {
        return false;
      }

      return (
        "platform" in record &&
        "url" in record &&
        "datePosted" in record &&
        typeof record.platform === "string" &&
        typeof record.url === "string" &&
        typeof record.datePosted === "string"
      );
    })
    .map((record) => ({
      platform: record.platform,
      url: record.url,
      datePosted: record.datePosted,
    }));
}

export function normalizeListing(raw: unknown): Listing | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Partial<Listing>;

  return {
    id: getString(source.id) || crypto.randomUUID(),
    isMusicalItem: typeof source.isMusicalItem === "boolean" ? source.isMusicalItem : true,
    brand: getString(source.brand),
    model: getString(source.model),
    type: getString(source.type),
    year: getString(source.year),
    finish: getString(source.finish),
    manufacturerCountry: getString(source.manufacturerCountry),
    category: getString(source.category),
    subcategory: getString(source.subcategory),
    additionalSubcategory: getString(source.additionalSubcategory),
    title: getString(source.title),
    description: getString(source.description),
    price: getNumber(source.price),
    condition: getString(source.condition),
    youtubeLink: getString(source.youtubeLink),
    purchasePrice: getString(source.purchasePrice),
    shippingRate: getString(source.shippingRate),
    craigslistCity: getString(source.craigslistCity),
    craigslistZipCode: getString(source.craigslistZipCode),
    craigslistSizeDimensions: getString(source.craigslistSizeDimensions),
    craigslistPhoneNumber: getString(source.craigslistPhoneNumber),
    craigslistContactName: getString(source.craigslistContactName),
    craigslistStreet: getString(source.craigslistStreet),
    craigslistCrossStreet: getString(source.craigslistCrossStreet),
    imageNames: getStringArray(source.imageNames).slice(0, MAX_IMAGE_COUNT),
    createdAt: getString(source.createdAt) || new Date().toISOString(),
    updatedAt: getString(source.updatedAt) || new Date().toISOString(),
    status:
      source.status === "draft" ||
      source.status === "active" ||
      source.status === "needs-renewal" ||
      source.status === "sold"
        ? source.status
        : "draft",
    postingRecords: getPostingRecords(source.postingRecords),
  };
}
