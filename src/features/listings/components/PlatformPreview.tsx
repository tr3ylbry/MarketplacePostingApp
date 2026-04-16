import { useEffect, useState } from "react";
import type { Listing } from "../../../domain/listing";
import type { ListingPhotoUpload } from "../types";
import { buildListingPhotoBundle } from "../photoBundle";
import {
  craigslistAdapter,
  ebayAdapter,
  offerupFacebookAdapter,
  reverbAdapter,
} from "../../../platforms";

interface PlatformPreviewProps {
  listing: Listing | null;
  photos: ListingPhotoUpload[];
}

const adapters = [
  ebayAdapter,
  offerupFacebookAdapter,
  craigslistAdapter,
  reverbAdapter,
];

export function PlatformPreview({ listing, photos }: PlatformPreviewProps) {
  const [selectedAdapterIndex, setSelectedAdapterIndex] = useState(0);
  const [copiedFieldKey, setCopiedFieldKey] = useState<string | null>(null);
  const [isDownloadingBundle, setIsDownloadingBundle] = useState(false);
  const filteredAdapters = listing
    ? adapters.filter((adapter) => {
        if (adapter.key === offerupFacebookAdapter.key) {
          return (
            listing.selectedPlatforms.includes("offerup") ||
            listing.selectedPlatforms.includes("facebook-marketplace")
          );
        }

        if (adapter.key === ebayAdapter.key) {
          return listing.selectedPlatforms.includes("ebay");
        }

        if (adapter.key === craigslistAdapter.key) {
          return listing.selectedPlatforms.includes("craigslist");
        }

        return listing.selectedPlatforms.includes("reverb");
      })
    : adapters;
  const clampedAdapterIndex = Math.min(
    selectedAdapterIndex,
    Math.max(filteredAdapters.length - 1, 0),
  );

  useEffect(() => {
    setCopiedFieldKey(null);
  }, [listing, selectedAdapterIndex]);

  useEffect(() => {
    if (selectedAdapterIndex !== clampedAdapterIndex) {
      setSelectedAdapterIndex(clampedAdapterIndex);
    }
  }, [clampedAdapterIndex, selectedAdapterIndex]);

  if (!listing) {
    return (
      <section className="panel panel-muted">
        <p className="panel-kicker">Platform Preview</p>
        <h2>No listing selected yet</h2>
          <p>Create a listing to preview each marketplace adapter.</p>
      </section>
    );
  }

  const activeListing = listing;
  const adapter = filteredAdapters[clampedAdapterIndex];
  const formatted = adapter.formatListing(activeListing);

  async function handleCopy(fieldKey: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedFieldKey(fieldKey);
  }

  function showPreviousPreview() {
    setSelectedAdapterIndex((current) =>
      current === 0 ? filteredAdapters.length - 1 : current - 1,
    );
  }

  function showNextPreview() {
    setSelectedAdapterIndex((current) =>
      current === filteredAdapters.length - 1 ? 0 : current + 1,
    );
  }

  async function handleBundleDownload() {
    if (photos.length === 0) {
      return;
    }

    setIsDownloadingBundle(true);

    try {
      const bundle = await buildListingPhotoBundle(activeListing, photos);
      const url = URL.createObjectURL(bundle);
      const link = document.createElement("a");

      link.href = url;
      link.download = `${activeListing.title || "Listing"}_PhotoBundle.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingBundle(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Adapter Output</p>
          <h2>{formatted.platform} preview</h2>
        </div>
        <div className="preview-nav">
          <button className="secondary-button" onClick={showPreviousPreview} type="button">
            ←
          </button>
          <span className="summary-pill">
            {clampedAdapterIndex + 1} / {filteredAdapters.length}
          </span>
          <button className="secondary-button" onClick={showNextPreview} type="button">
            →
          </button>
        </div>
      </div>

      <div className="preview-actions">
        <button
          className="secondary-button"
          disabled={photos.length === 0 || isDownloadingBundle}
          onClick={handleBundleDownload}
          type="button"
        >
          {isDownloadingBundle ? "Building Bundle..." : "Download Photo Bundle"}
        </button>
        {photos.length === 0 ? (
          <p className="preview-helper">
            Photo export is available for listings created in this session.
          </p>
        ) : null}
      </div>

      {formatted.fields.map((field) => (
        <div className="preview-group" key={field.key}>
          <div className="preview-group-header">
            <span className="preview-label">{field.label}</span>
            <button
              className="copy-button"
              onClick={() => handleCopy(`${formatted.platform}-${field.key}`, field.value)}
              type="button"
            >
              {copiedFieldKey === `${formatted.platform}-${field.key}` ? "Copied" : "Copy"}
            </button>
          </div>

          {field.multiline ? (
            <pre>{field.value || " "}</pre>
          ) : (
            <p>{field.value || " "}</p>
          )}
        </div>
      ))}

      {formatted.photoSets.map((photoSet) => (
        <div className="preview-group" key={photoSet.key}>
          <div className="preview-group-header">
            <span className="preview-label">{photoSet.label} photos</span>
          </div>
          <p>
            {photoSet.imageNames.length} of {photoSet.limit} selected
          </p>
          {photoSet.imageNames.length > 0 ? (
            <div className="image-chip-row">
              {photoSet.imageNames.map((imageName, index) => (
                <span className="image-chip" key={`${photoSet.key}-${imageName}-${index}`}>
                  {index + 1}. {imageName}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      {formatted.notes.length > 0 ? (
        <div className="notes-box">
          {formatted.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
