export type ListingStatus = "draft" | "active" | "needs-renewal" | "sold";
export type PlatformSiteKey =
  | "ebay"
  | "craigslist"
  | "reverb"
  | "offerup"
  | "facebook-marketplace";

export interface PostingRecord {
  platform: string;
  url: string;
  datePosted: string;
}

export interface Listing {
  id: string;
  selectedPlatforms: PlatformSiteKey[];
  brand: string;
  model: string;
  type: string;
  year: string;
  finish: string;
  manufacturerCountry: string;
  ebayCategory: string;
  offerupCategory: string;
  offerupSubcategory: string;
  facebookCategory: string;
  craigslistCategory: string;
  reverbCategory: string;
  reverbSubcategory: string;
  reverbAdditionalSubcategory: string;
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
  selectedPlatforms: PlatformSiteKey[];
  brand: string;
  model: string;
  type: string;
  year: string;
  finish: string;
  manufacturerCountry: string;
  ebayCategory: string;
  offerupCategory: string;
  offerupSubcategory: string;
  facebookCategory: string;
  craigslistCategory: string;
  reverbCategory: string;
  reverbSubcategory: string;
  reverbAdditionalSubcategory: string;
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
const ALL_PLATFORM_KEYS: PlatformSiteKey[] = [
  "ebay",
  "craigslist",
  "reverb",
  "offerup",
  "facebook-marketplace",
];

function normalizeText(value: string): string {
  return value.trim();
}

function normalizePlatforms(platforms: PlatformSiteKey[] = []): PlatformSiteKey[] {
  return ALL_PLATFORM_KEYS.filter((platform) => platforms.includes(platform));
}

function hasPlatform(input: CreateListingInput | Listing, platform: PlatformSiteKey) {
  return input.selectedPlatforms.includes(platform);
}

export function createListing(input: CreateListingInput): Listing {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    selectedPlatforms: normalizePlatforms(input.selectedPlatforms),
    brand: normalizeText(input.brand),
    model: normalizeText(input.model),
    type: normalizeText(input.type),
    year: normalizeText(input.year),
    finish: normalizeText(input.finish),
    manufacturerCountry: normalizeText(input.manufacturerCountry),
    ebayCategory: normalizeText(input.ebayCategory),
    offerupCategory: normalizeText(input.offerupCategory),
    offerupSubcategory: normalizeText(input.offerupSubcategory),
    facebookCategory: normalizeText(input.facebookCategory),
    craigslistCategory: normalizeText(input.craigslistCategory),
    reverbCategory: normalizeText(input.reverbCategory),
    reverbSubcategory: normalizeText(input.reverbSubcategory),
    reverbAdditionalSubcategory: normalizeText(input.reverbAdditionalSubcategory),
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
  const usesReverb = hasPlatform(input, "reverb");
  const usesCraigslist = hasPlatform(input, "craigslist");
  const usesOfferUp = hasPlatform(input, "offerup");
  const usesFacebook = hasPlatform(input, "facebook-marketplace");
  const usesEbay = hasPlatform(input, "ebay");
  const textFields: Array<[label: string, value: string]> = [
    ["Brand / Make", input.brand],
    ["Model", input.model],
    ["Type (OfferUp)", input.type],
    ["Year (Reverb)", input.year],
    ["Finish (Reverb)", input.finish],
    ["Manufacturer country (Reverb)", input.manufacturerCountry],
    ["Category (eBay)", input.ebayCategory],
    ["Category (OfferUp)", input.offerupCategory],
    ["Sub-category (OfferUp)", input.offerupSubcategory],
    ["Category (Facebook Marketplace)", input.facebookCategory],
    ["Category (Craigslist)", input.craigslistCategory],
    ["Category (Reverb)", input.reverbCategory],
    ["Subcategory (Reverb)", input.reverbSubcategory],
    ["Additional subcategory (Reverb)", input.reverbAdditionalSubcategory],
    ["Title", input.title],
    ["Condition", input.condition],
    ["YouTube link (Reverb)", input.youtubeLink],
    ["Purchase price (Reverb)", input.purchasePrice],
    ["Shipping rate (Reverb)", input.shippingRate],
    ["City (Craigslist)", input.craigslistCity],
    ["Zip code (Craigslist)", input.craigslistZipCode],
    ["Size / dimensions (Craigslist)", input.craigslistSizeDimensions],
    ["Phone number (Craigslist)", input.craigslistPhoneNumber],
    ["Contact name (Craigslist)", input.craigslistContactName],
    ["Street (Craigslist)", input.craigslistStreet],
    ["Cross street (Craigslist)", input.craigslistCrossStreet],
  ];

  if (input.selectedPlatforms.length === 0) {
    errors.push("Select at least one marketplace.");
  }

  if (input.title.trim().length < 4) {
    errors.push("Title must be at least 4 characters.");
  }

  if (input.description.trim().length < 20) {
    errors.push("Description must be at least 20 characters.");
  }

  if (!Number.isFinite(input.price) || input.price <= 0) {
    errors.push("Price must be greater than 0.");
  }

  if (usesEbay && input.ebayCategory.trim().length === 0) {
    errors.push("Category (eBay) is required.");
  }

  if (usesOfferUp && input.offerupCategory.trim().length === 0) {
    errors.push("Category (OfferUp) is required.");
  }

  if (usesOfferUp && input.offerupSubcategory.trim().length === 0) {
    errors.push("Sub-category (OfferUp) is required.");
  }

  if (usesFacebook && input.facebookCategory.trim().length === 0) {
    errors.push("Category (Facebook Marketplace) is required.");
  }

  if (usesReverb && input.model.trim().length === 0) {
    errors.push("Model is required for Reverb.");
  }

  if (usesReverb && input.brand.trim().length === 0) {
    errors.push("Brand / Make is required for Reverb.");
  }

  if (usesReverb && input.reverbCategory.trim().length === 0) {
    errors.push("Category (Reverb) is required.");
  }

  if (usesReverb && input.shippingRate.trim().length === 0) {
    errors.push("Shipping rate is required for Reverb.");
  }

  if (usesCraigslist && input.craigslistCategory.trim().length === 0) {
    errors.push("Category (Craigslist) is required.");
  }

  if (usesCraigslist && input.craigslistCity.trim().length === 0) {
    errors.push("City (Craigslist) is required.");
  }

  if (usesCraigslist && input.craigslistZipCode.trim().length === 0) {
    errors.push("Zip code (Craigslist) is required.");
  }

  if (usesCraigslist && input.craigslistPhoneNumber.trim().length === 0) {
    errors.push("Phone number (Craigslist) is required.");
  }

  if (usesCraigslist && input.craigslistContactName.trim().length === 0) {
    errors.push("Contact name (Craigslist) is required.");
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

  const source = raw as Partial<Listing> & {
    isMusicalItem?: boolean;
    category?: string;
    subcategory?: string;
    additionalSubcategory?: string;
  };

  return {
    id: getString(source.id) || crypto.randomUUID(),
    selectedPlatforms: (() => {
      if (Array.isArray(source.selectedPlatforms)) {
        return normalizePlatforms(
          source.selectedPlatforms.filter(
            (entry): entry is PlatformSiteKey =>
              typeof entry === "string" && ALL_PLATFORM_KEYS.includes(entry as PlatformSiteKey),
          ),
        );
      }

      if (source.isMusicalItem === false) {
        return ["ebay", "offerup", "facebook-marketplace", "craigslist"];
      }

      return ["ebay", "offerup", "facebook-marketplace", "craigslist", "reverb"];
    })(),
    brand: getString(source.brand),
    model: getString(source.model),
    type: getString(source.type),
    year: getString(source.year),
    finish: getString(source.finish),
    manufacturerCountry: getString(source.manufacturerCountry),
    ebayCategory: getString(source.ebayCategory),
    offerupCategory: getString(source.offerupCategory),
    offerupSubcategory: getString(source.offerupSubcategory || source.subcategory),
    facebookCategory: getString(source.facebookCategory),
    craigslistCategory: getString(source.craigslistCategory || source.category),
    reverbCategory: getString(source.reverbCategory || source.category),
    reverbSubcategory: getString(source.reverbSubcategory || source.subcategory),
    reverbAdditionalSubcategory: getString(
      source.reverbAdditionalSubcategory || source.additionalSubcategory,
    ),
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
