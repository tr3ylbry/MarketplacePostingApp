import { useState } from "react";
import type { PlatformSiteKey } from "../domain/listing";
import { ListingDashboard } from "../features/listings/components/ListingDashboard";
import { ListingForm } from "../features/listings/components/ListingForm";
import { MarketplacePicker } from "../features/listings/components/MarketplacePicker";
import { PlatformPreview } from "../features/listings/components/PlatformPreview";
import { useListings } from "../features/listings/hooks/useListings";

type AppView = "home" | "select-platforms" | "create" | "manage" | "edit";
type ComposerStep = "form" | "preview";

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
  const [composerStep, setComposerStep] = useState<ComposerStep>("form");
  const [draftPlatforms, setDraftPlatforms] = useState<PlatformSiteKey[]>([]);

  function startCreateFlow() {
    setDraftPlatforms([]);
    setComposerStep("form");
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
    setComposerStep("form");
    setView("edit");
  }

  function handleCreateListingAndExit(...args: Parameters<typeof createListing>) {
    createListing(...args);
    setComposerStep("form");
    setView("home");
  }

  function handleUpdateListing(...args: Parameters<typeof updateListing>) {
    updateListing(...args);
    setComposerStep("form");
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
    setComposerStep("form");
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
              <h2>Edit & Delete Listings</h2>
              <p>Open saved listings to edit them or remove them with confirmation.</p>
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  function renderCreateFlow() {
    if (composerStep === "preview") {
      return (
        <section className="panel-stack">
          <PlatformPreview
            listing={selectedListing}
            onBack={() => setComposerStep("form")}
          />
        </section>
      );
    }

    return (
      <section className="panel-stack">
        <ListingForm
          hasSavedListings={listings.length > 0}
          initialSelectedPlatforms={draftPlatforms}
          listing={null}
          mode="create"
          onCreate={handleCreateListing}
          onCreateAndExit={handleCreateListingAndExit}
          onContinueToPreview={() => setComposerStep("preview")}
          onDelete={handleDeleteListing}
          onExitToHome={() => setView("home")}
          onOpenManage={() => setView("manage")}
          onStartCreate={startCreateFlow}
          onUpdate={handleUpdateListing}
          photos={[]}
        />
      </section>
    );
  }

  function renderEditFlow() {
    if (composerStep === "preview") {
      return (
        <section className="panel-stack">
          <PlatformPreview
            listing={selectedListing}
            onBack={() => setComposerStep("form")}
          />
        </section>
      );
    }

    return (
      <section className="panel-stack">
        <ListingForm
          hasSavedListings={listings.length > 0}
          initialSelectedPlatforms={selectedListing?.selectedPlatforms ?? []}
          listing={selectedListing}
          mode="edit"
          onCreate={handleCreateListing}
          onCreateAndExit={handleCreateListingAndExit}
          onContinueToPreview={() => setComposerStep("preview")}
          onDelete={handleDeleteListing}
          onExitToHome={() => setView("home")}
          onOpenManage={() => setView("manage")}
          onStartCreate={startCreateFlow}
          onUpdate={handleUpdateListing}
          photos={selectedListingPhotos}
        />
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
        <h1>Create once.<br />Tailor per marketplace.<br />Track what's live.</h1>
        <p className="hero-copy">
          This V1 keeps everything local. Choose where an item is going, build one
          listing, and keep your posting workflow organized.
        </p>
      </section>

      {view === "home" ? renderHome() : null}

      {view === "select-platforms" ? (
        <MarketplacePicker
          onContinue={() => {
            setComposerStep("form");
            setView("create");
          }}
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
