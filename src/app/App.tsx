import { useState } from "react";
import type { PlatformSiteKey } from "../domain/listing";
import { ListingDashboard } from "../features/listings/components/ListingDashboard";
import { ListingForm } from "../features/listings/components/ListingForm";
import { MarketplacePicker } from "../features/listings/components/MarketplacePicker";
import { PlatformPreview } from "../features/listings/components/PlatformPreview";
import { useListings } from "../features/listings/hooks/useListings";

type AppView = "home" | "select-platforms" | "create" | "manage" | "edit";

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
  const [view, setView] = useState<AppView>("home");
  const [draftPlatforms, setDraftPlatforms] = useState<PlatformSiteKey[]>([]);

  function startCreateFlow() {
    setDraftPlatforms([]);
    setView("select-platforms");
  }

  function toggleDraftPlatform(platform: PlatformSiteKey) {
    setDraftPlatforms((current) =>
      current.includes(platform)
        ? current.filter((entry) => entry !== platform)
        : [...current, platform],
    );
  }

  function handleCreateListing(...args: Parameters<typeof createListing>) {
    createListing(...args);
    setView("edit");
  }

  function handleUpdateListing(...args: Parameters<typeof updateListing>) {
    updateListing(...args);
    setView("edit");
  }

  function handleDeleteListing(listingId: string) {
    if (!window.confirm("Are you sure you want to delete this listing?")) {
      return;
    }

    deleteListing(listingId);
    setView(listings.length > 1 ? "manage" : "home");
  }

  function handleEditListing(listingId: string) {
    selectListing(listingId);
    setView("edit");
  }

  function renderHome() {
    return (
      <section className="panel home-panel">
        <div className="home-actions">
          <button className="home-action-card" onClick={startCreateFlow} type="button">
            <p className="panel-kicker">Create</p>
            <h2>Create New Listing</h2>
            <p>Choose marketplaces first, then move into the listing workflow.</p>
          </button>

          {listings.length > 0 ? (
            <button
              className="home-action-card"
              onClick={() => setView("manage")}
              type="button"
            >
              <p className="panel-kicker">Manage</p>
              <h2>Edit/Delete Listings</h2>
              <p>Open saved listings to edit them or remove them with confirmation.</p>
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  function renderCreateFlow() {
    return (
      <section className="workspace">
        <ListingForm
          initialSelectedPlatforms={draftPlatforms}
          listing={null}
          mode="create"
          onCreate={handleCreateListing}
          onDelete={handleDeleteListing}
          onStartCreate={startCreateFlow}
          onUpdate={handleUpdateListing}
          photos={[]}
        />
        <PlatformPreview listing={null} photos={[]} />
      </section>
    );
  }

  function renderEditFlow() {
    return (
      <section className="workspace">
        <ListingForm
          initialSelectedPlatforms={selectedListing?.selectedPlatforms ?? []}
          listing={selectedListing}
          mode="edit"
          onCreate={handleCreateListing}
          onDelete={handleDeleteListing}
          onStartCreate={startCreateFlow}
          onUpdate={handleUpdateListing}
          photos={selectedListingPhotos}
        />
        <PlatformPreview listing={selectedListing} photos={selectedListingPhotos} />
      </section>
    );
  }

  function renderManageView() {
    return (
      <section className="panel-stack">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Manage Listings</p>
              <h2>Edit or delete saved listings</h2>
            </div>
            <button className="primary-button" onClick={startCreateFlow} type="button">
              Create a listing
            </button>
          </div>
        </div>

        <ListingDashboard
          listings={listings}
          onDelete={handleDeleteListing}
          onEdit={handleEditListing}
          selectedListingId={selectedListing?.id ?? null}
        />
      </section>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Marketplace Posting Assistant</p>
        <h1>Create once, tailor per marketplace, track what is live.</h1>
        <p className="hero-copy">
          This V1 keeps everything local. Choose where an item is going, build one
          listing, and keep your posting workflow organized.
        </p>
      </section>

      {view === "home" ? renderHome() : null}

      {view === "select-platforms" ? (
        <MarketplacePicker
          onContinue={() => setView("create")}
          onToggle={toggleDraftPlatform}
          selectedPlatforms={draftPlatforms}
        />
      ) : null}

      {view === "create" ? renderCreateFlow() : null}
      {view === "manage" ? renderManageView() : null}
      {view === "edit" ? renderEditFlow() : null}
    </main>
  );
}
