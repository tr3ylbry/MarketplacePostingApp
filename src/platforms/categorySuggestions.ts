import type { Listing } from "../domain/listing";

interface SuggestedCategories {
  ebayCategory: string;
  offerupCategory: string;
  offerupSubcategory: string;
  facebookCategory: string;
  craigslistCategory: string;
  reverbCategory: string;
  reverbSubcategory: string;
  reverbAdditionalSubcategory: string;
}

const keywordRules = [
  {
    pattern: /\b(guitar|strat|tele|les paul|sg|jazzmaster)\b/i,
    categories: {
      ebayCategory: "Suggested: Guitars",
      offerupCategory: "Suggested: Musical Instruments",
      offerupSubcategory: "Suggested: Guitars",
      facebookCategory: "Suggested: Musical Instruments",
      craigslistCategory: "Suggested: Musical Instruments",
      reverbCategory: "Suggested: Guitars",
      reverbSubcategory: "Suggested: Electric Guitars",
      reverbAdditionalSubcategory: "Suggested: Solid Body",
    },
  },
  {
    pattern: /\b(bass)\b/i,
    categories: {
      ebayCategory: "Suggested: Bass Guitars",
      offerupCategory: "Suggested: Musical Instruments",
      offerupSubcategory: "Suggested: Basses",
      facebookCategory: "Suggested: Musical Instruments",
      craigslistCategory: "Suggested: Musical Instruments",
      reverbCategory: "Suggested: Basses",
      reverbSubcategory: "Suggested: Electric Basses",
      reverbAdditionalSubcategory: "Suggested: Solid Body",
    },
  },
  {
    pattern: /\b(synth|keyboard|piano)\b/i,
    categories: {
      ebayCategory: "Suggested: Keyboards",
      offerupCategory: "Suggested: Musical Instruments",
      offerupSubcategory: "Suggested: Keyboards",
      facebookCategory: "Suggested: Musical Instruments",
      craigslistCategory: "Suggested: Musical Instruments",
      reverbCategory: "Suggested: Keyboards And Synths",
      reverbSubcategory: "Suggested: Synths",
      reverbAdditionalSubcategory: "Suggested: Digital Synths",
    },
  },
  {
    pattern: /\b(pedal|overdrive|distortion|fuzz|delay|reverb pedal)\b/i,
    categories: {
      ebayCategory: "Suggested: Effects Pedals",
      offerupCategory: "Suggested: Musical Instruments",
      offerupSubcategory: "Suggested: Pro Audio",
      facebookCategory: "Suggested: Musical Instruments",
      craigslistCategory: "Suggested: Musical Instruments",
      reverbCategory: "Suggested: Pedals And Effects",
      reverbSubcategory: "Suggested: Overdrive And Boost",
      reverbAdditionalSubcategory: "Suggested: Single Pedals",
    },
  },
  {
    pattern: /\b(amp|amplifier|cabinet)\b/i,
    categories: {
      ebayCategory: "Suggested: Amplifiers",
      offerupCategory: "Suggested: Musical Instruments",
      offerupSubcategory: "Suggested: Amplifiers",
      facebookCategory: "Suggested: Musical Instruments",
      craigslistCategory: "Suggested: Musical Instruments",
      reverbCategory: "Suggested: Amps",
      reverbSubcategory: "Suggested: Guitar Combos",
      reverbAdditionalSubcategory: "Suggested: Tube",
    },
  },
];

const fallbackCategories: SuggestedCategories = {
  ebayCategory: "Suggested: General Merchandise",
  offerupCategory: "Suggested: General",
  offerupSubcategory: "Suggested: General Items",
  facebookCategory: "Suggested: Household",
  craigslistCategory: "Suggested: For Sale",
  reverbCategory: "Suggested: Instruments",
  reverbSubcategory: "Suggested: General",
  reverbAdditionalSubcategory: "Suggested: Standard",
};

export function getSuggestedCategories(listing: Listing): SuggestedCategories {
  const haystack = `${listing.title} ${listing.description} ${listing.brand} ${listing.model}`;

  for (const rule of keywordRules) {
    if (rule.pattern.test(haystack)) {
      return {
        ebayCategory: listing.ebayCategory || rule.categories.ebayCategory,
        offerupCategory: listing.offerupCategory || rule.categories.offerupCategory,
        offerupSubcategory: listing.offerupSubcategory || rule.categories.offerupSubcategory,
        facebookCategory: listing.facebookCategory || rule.categories.facebookCategory,
        craigslistCategory: listing.craigslistCategory || rule.categories.craigslistCategory,
        reverbCategory: listing.reverbCategory || rule.categories.reverbCategory,
        reverbSubcategory: listing.reverbSubcategory || rule.categories.reverbSubcategory,
        reverbAdditionalSubcategory:
          listing.reverbAdditionalSubcategory || rule.categories.reverbAdditionalSubcategory,
      };
    }
  }

  return {
    ebayCategory: listing.ebayCategory || fallbackCategories.ebayCategory,
    offerupCategory: listing.offerupCategory || fallbackCategories.offerupCategory,
    offerupSubcategory: listing.offerupSubcategory || fallbackCategories.offerupSubcategory,
    facebookCategory: listing.facebookCategory || fallbackCategories.facebookCategory,
    craigslistCategory: listing.craigslistCategory || fallbackCategories.craigslistCategory,
    reverbCategory: listing.reverbCategory || fallbackCategories.reverbCategory,
    reverbSubcategory: listing.reverbSubcategory || fallbackCategories.reverbSubcategory,
    reverbAdditionalSubcategory:
      listing.reverbAdditionalSubcategory || fallbackCategories.reverbAdditionalSubcategory,
  };
}
