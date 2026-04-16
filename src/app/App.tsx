import { ListingDashboard } from "../features/listings/components/ListingDashboard";
import { ListingForm } from "../features/listings/components/ListingForm";
import { PlatformPreview } from "../features/listings/components/PlatformPreview";
import { useListings } from "../features/listings/hooks/useListings";

export default function App() {
  const {
    listings,
    createListing,
    updateListing,
    deleteListing,
    selectedListing,
    selectedListingPhotos,
    selectListing,
  } = useListings();

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Marketplace Posting Assistant</p>
        <h1>Create once, tailor per marketplace, track what is live.</h1>
        <p className="hero-copy">
          This V1 keeps everything local. You draft one source listing, flip
          through marketplace-specific previews, and keep a lightweight
          dashboard of active items.
        </p>
      </section>

      <section className="workspace">
        <ListingForm
          listing={selectedListing}
          photos={selectedListingPhotos}
          onCreate={createListing}
          onDelete={deleteListing}
          onUpdate={updateListing}
        />
        <PlatformPreview listing={selectedListing} photos={selectedListingPhotos} />
      </section>

      <ListingDashboard
        listings={listings}
        selectedListingId={selectedListing?.id ?? null}
        onSelect={selectListing}
      />
    </main>
  );
}
