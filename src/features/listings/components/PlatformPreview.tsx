import { useEffect, useState } from "react";
import type { Listing } from "../../../domain/listing";
import {
  craigslistAdapter,
  ebayAdapter,
  offerupFacebookAdapter,
  reverbAdapter,
} from "../../../platforms";
import type { PlatformSiteKey } from "../../../domain/listing";

interface PlatformPreviewProps {
  listing: Listing | null;
  onBack?: () => void;
}

const adapters = [
  ebayAdapter,
  offerupFacebookAdapter,
  craigslistAdapter,
  reverbAdapter,
];

const platformSiteMeta: Record<
  PlatformSiteKey,
  {
    fallbackClassName?: string;
    iconPath: string;
    label: string;
    preferFallback?: boolean;
    shortLabel: string;
    url: string;
  }
> = {
  ebay: {
    fallbackClassName: "site-link-fallback-ebay",
    iconPath: "/marketplace-icons/ebay-tile.png",
    label: "eBay",
    shortLabel: "eB",
    url: "https://www.ebay.com",
  },
  offerup: {
    fallbackClassName: "site-link-fallback-offerup",
    iconPath: "/marketplace-icons/offerup-tile.png",
    label: "OfferUp",
    shortLabel: "OU",
    url: "https://offerup.com",
  },
  "facebook-marketplace": {
    fallbackClassName: "site-link-fallback-facebook",
    iconPath: "/marketplace-icons/facebook-marketplace-tile.png",
    label: "Facebook Marketplace",
    shortLabel: "FB",
    url: "https://www.facebook.com/marketplace",
  },
  craigslist: {
    fallbackClassName: "site-link-fallback-craigslist",
    iconPath: "/marketplace-icons/craigslist-tile.png",
    label: "Craigslist",
    shortLabel: "CL",
    url: "https://www.craigslist.org",
  },
  reverb: {
    fallbackClassName: "site-link-fallback-reverb",
    iconPath: "/marketplace-icons/reverb-tile.png",
    label: "Reverb",
    shortLabel: "RV",
    url: "https://reverb.com",
  },
};

function SiteLink({
  compact = false,
  site,
}: {
  compact?: boolean;
  site: PlatformSiteKey;
}) {
  const meta = platformSiteMeta[site];
  const [iconMissing, setIconMissing] = useState(Boolean(meta.preferFallback));

  return (
    <a
      className={compact ? "site-link-chip" : "site-link-heading"}
      href={meta.url}
      rel="noreferrer"
      target="_blank"
    >
      <span className="site-link-mark">
        {!iconMissing ? (
          <img
            alt=""
            className="site-link-icon"
            onError={() => setIconMissing(true)}
            src={meta.iconPath}
          />
        ) : null}
        {iconMissing ? (
          <span className={`site-link-fallback ${meta.fallbackClassName ?? ""}`}>
            {meta.shortLabel}
          </span>
        ) : null}
      </span>
      <span>{meta.label}</span>
    </a>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h7.5A2.25 2.25 0 0 1 21 9.75v9A2.25 2.25 0 0 1 18.75 21h-7.5A2.25 2.25 0 0 1 9 18.75z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M15 7.5V5.25A2.25 2.25 0 0 0 12.75 3h-7.5A2.25 2.25 0 0 0 3 5.25v9a2.25 2.25 0 0 0 2.25 2.25H9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function PlatformPreview({ listing, onBack }: PlatformPreviewProps) {
  const [selectedAdapterIndex, setSelectedAdapterIndex] = useState(0);
  const [copiedFieldKey, setCopiedFieldKey] = useState<string | null>(null);
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
  const previewSites: PlatformSiteKey[] =
    adapter.key === offerupFacebookAdapter.key
      ? (["offerup", "facebook-marketplace"] as const).filter((site) =>
          activeListing.selectedPlatforms.includes(site),
        )
      : adapter.key === ebayAdapter.key
        ? ["ebay"]
        : adapter.key === craigslistAdapter.key
          ? ["craigslist"]
          : ["reverb"];

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

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Adapter Output</p>
          <h2 className="preview-title">
            {previewSites.map((site, index) => (
              <span key={site}>
                {index > 0 ? <span className="preview-title-separator"> / </span> : null}
                <SiteLink site={site} />
              </span>
            ))}
            <span className="preview-title-text"> Preview</span>
          </h2>
          <div className="preview-site-links">
            {previewSites.map((site) => (
              <SiteLink compact key={`${site}-chip`} site={site} />
            ))}
          </div>
        </div>
        <div className="preview-header-actions">
          {onBack ? (
            <button className="secondary-button" onClick={onBack} type="button">
              ← Back To General Listing
            </button>
          ) : null}
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
      </div>

      {formatted.fields.map((field) => (
        <div className="preview-group" key={field.key}>
          <div className="preview-group-header">
            <span className="preview-label">{field.label}</span>
          </div>

          <div className="preview-value">
            {field.value ? (
              <button
                aria-label={`Copy ${field.label}`}
                className="preview-copy-button"
                onClick={() => handleCopy(`${formatted.platform}-${field.key}`, field.value)}
                title={copiedFieldKey === `${formatted.platform}-${field.key}` ? "Copied" : "Copy"}
                type="button"
              >
                {copiedFieldKey === `${formatted.platform}-${field.key}` ? (
                  <span className="preview-copy-text">Copied</span>
                ) : (
                  <>
                    <span className="preview-copy-icon" aria-hidden="true">
                      <CopyIcon />
                    </span>
                    <span className="preview-copy-fallback">Copy</span>
                  </>
                )}
              </button>
            ) : null}

            {field.multiline ? (
              <pre>{field.value || " "}</pre>
            ) : (
              <p>{field.value || " "}</p>
            )}
          </div>
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
