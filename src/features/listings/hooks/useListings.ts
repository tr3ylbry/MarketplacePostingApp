import { useEffect, useMemo, useState } from "react";
import {
  createListing as buildListing,
  type CreateListingInput,
  type Listing,
} from "../../../domain/listing";
import { loadListings, saveListings } from "../../../storage/listingsStorage";

export function useListings() {
  const [listings, setListings] = useState<Listing[]>(() => loadListings());
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);

  useEffect(() => {
    saveListings(listings);
  }, [listings]);

  useEffect(() => {
    if (!selectedListingId && listings.length > 0) {
      setSelectedListingId(listings[0].id);
    }
  }, [listings, selectedListingId]);

  const selectedListing = useMemo(
    () => listings.find((listing) => listing.id === selectedListingId) ?? null,
    [listings, selectedListingId],
  );

  function createListing(input: CreateListingInput) {
    const nextListing = buildListing(input);
    setListings((current) => [nextListing, ...current]);
    setSelectedListingId(nextListing.id);
  }

  function selectListing(listingId: string) {
    setSelectedListingId(listingId);
  }

  return {
    listings,
    selectedListing,
    createListing,
    selectListing,
  };
}
