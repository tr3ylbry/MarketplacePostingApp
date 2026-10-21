type ListingStatus = "draft" | "active" | "needs-renewal" | "sold";
type PlatformSiteKey =
  | "ebay"
  | "craigslist"
  | "reverb"
  | "offerup"
  | "facebook-marketplace";

interface PostingRecord {
  platform: string;
  url: string;
  datePosted: string;
}

interface LegacyListing {
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

const MAX_IMAGE_COUNT = 40;
const ALL_PLATFORM_KEYS: PlatformSiteKey[] = ["ebay", "craigslist", "reverb", "offerup", "facebook-marketplace"];

function normalizePlatforms(platforms: PlatformSiteKey[]) {
  return ALL_PLATFORM_KEYS.filter(key => platforms.includes(key));
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

export function normalizeLegacyListing(raw: unknown): LegacyListing | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Partial<LegacyListing> & {
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
