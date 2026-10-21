import { craigslistMapper } from "./craigslist";
import { ebayMapper } from "./ebay";
import { offerupFacebookMapper } from "./offerupFacebook";
import { reverbMapper } from "./reverb";

export const marketplaceMappers = {
  ebay: ebayMapper, craigslist: craigslistMapper, reverb: reverbMapper,
  offerup: offerupFacebookMapper, "facebook-marketplace": offerupFacebookMapper,
};
// The existing UI intentionally combines OfferUp/Facebook into one preview.
export const previewMappers = [ebayMapper, offerupFacebookMapper, craigslistMapper, reverbMapper];
export type { FormattedListing, MarketplaceMapper, MarketplaceValidationResult } from "./types";
