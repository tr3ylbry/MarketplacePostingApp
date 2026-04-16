import { useEffect, useMemo, useState } from "react";
import {
  createListing as buildListing,
  type CreateListingInput,
  type Listing,
  updateListing as buildUpdatedListing,
} from "../../../domain/listing";
import { loadListings, saveListings } from "../../../storage/listingsStorage";
import type { ListingPhotoUpload } from "../types";

export function useListings() {
  const [listings, setListings] = useState<Listing[]>(() => loadListings());
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [listingPhotos, setListingPhotos] = useState<Record<string, ListingPhotoUpload[]>>({});

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
  const selectedListingPhotos = useMemo(
    () => (selectedListingId ? listingPhotos[selectedListingId] ?? [] : []),
    [listingPhotos, selectedListingId],
  );

  function createListing(input: CreateListingInput, photos: ListingPhotoUpload[]) {
    const nextListing = buildListing(input);
    setListings((current) => [nextListing, ...current]);
    setListingPhotos((current) => ({ ...current, [nextListing.id]: photos }));
    setSelectedListingId(nextListing.id);
  }

  function updateListing(
    listingId: string,
    input: CreateListingInput,
    photos: ListingPhotoUpload[],
  ) {
    setListings((current) =>
      current.map((listing) =>
        listing.id === listingId ? buildUpdatedListing(listing, input) : listing,
      ),
    );
    setListingPhotos((current) => ({ ...current, [listingId]: photos }));
    setSelectedListingId(listingId);
  }

  function deleteListing(listingId: string) {
    setListings((current) => current.filter((listing) => listing.id !== listingId));
    setListingPhotos((current) => {
      const nextPhotos = { ...current };
      delete nextPhotos[listingId];
      return nextPhotos;
    });
    setSelectedListingId((current) => (current === listingId ? null : current));
  }

  function selectListing(listingId: string) {
    setSelectedListingId(listingId);
  }

  return {
    listings,
    selectedListing,
    selectedListingPhotos,
    createListing,
    updateListing,
    deleteListing,
    selectListing,
  };
}
