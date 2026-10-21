import type { PlatformSiteKey } from "../../domain/listing";
import { reverbRequiredErrors } from "../../platforms/reverbValidation";

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
const MAX_IMAGE_COUNT = 40;

function hasPlatform(input: CreateListingInput, platform: PlatformSiteKey) {
  return input.selectedPlatforms.includes(platform);
}

export function validateListingInput(input: CreateListingInput): string[] {
  const errors: string[] = [];
  const usesReverb = hasPlatform(input, "reverb");
  const usesCraigslist = hasPlatform(input, "craigslist");
  const textFields: Array<[label: string, value: string]> = [
    ["Brand / Make", input.brand],
    ["Model", input.model],
    ["Type", input.type],
    ["Year", input.year],
    ["Finish", input.finish],
    ["Manufacturer country", input.manufacturerCountry],
    ["Title", input.title],
    ["Condition", input.condition],
    ["YouTube link", input.youtubeLink],
    ["Purchase price", input.purchasePrice],
    ["Shipping rate", input.shippingRate],
    ["City", input.craigslistCity],
    ["Zip code", input.craigslistZipCode],
    ["Size / dimensions", input.craigslistSizeDimensions],
    ["Phone number", input.craigslistPhoneNumber],
    ["Contact name", input.craigslistContactName],
    ["Street", input.craigslistStreet],
    ["Cross street", input.craigslistCrossStreet],
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

  if (usesReverb) {
    const required = reverbRequiredErrors({
      brand: input.brand, model: input.model,
      shippingRate: input.shippingRate.trim() ? { amount: Number(input.shippingRate), currency: "USD" } : undefined,
    });
    // Preserve V1 save rules; full readiness (including category) is shown in preview.
    for (const field of ["model", "brand", "shippingRate"] as const) {
      if (required[field]) errors.push(required[field]);
    }
  }
  for (const [label, value] of [["Purchase price", input.purchasePrice], ["Shipping rate", input.shippingRate]]) {
    if (value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      errors.push(`${label} must be a non-negative number.`);
    }
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
    errors.push("You can upload up to 40 photos.");
  }

  for (const [label, value] of textFields) {
    if (value.trim().length > MAX_TEXT_FIELD_LENGTH) {
      errors.push(`${label} must be 35 characters or fewer.`);
    }
  }

  return errors;
}
