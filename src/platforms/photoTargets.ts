export interface PhotoTarget {
  key: string;
  label: string;
  folderLabel: string;
  limit: number;
}

export const photoTargets: PhotoTarget[] = [
  { key: "ebay", label: "eBay", folderLabel: "eBay", limit: 40 },
  { key: "craigslist", label: "Craigslist", folderLabel: "Craigslist", limit: 24 },
  { key: "reverb", label: "Reverb", folderLabel: "Reverb", limit: 25 },
  { key: "offerup", label: "OfferUp", folderLabel: "OfferUp", limit: 12 },
  {
    key: "facebook-marketplace",
    label: "Facebook Marketplace",
    folderLabel: "FacebookMarketplace",
    limit: 10,
  },
];
