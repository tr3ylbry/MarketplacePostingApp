import { useState } from "react";
import type { PlatformSiteKey } from "../../../domain/listing";

interface MarketplacePickerProps {
  selectedPlatforms: PlatformSiteKey[];
  onToggle: (platform: PlatformSiteKey) => void;
  onContinue: () => void;
}

const marketplaceTiles: Array<{
  key: PlatformSiteKey;
  label: string;
  iconPath: string;
}> = [
  { key: "ebay", label: "eBay", iconPath: "/marketplace-icons/ebay.svg" },
  { key: "offerup", label: "OfferUp", iconPath: "/marketplace-icons/offerup.svg" },
  {
    key: "facebook-marketplace",
    label: "Facebook Marketplace",
    iconPath: "/marketplace-icons/facebook-marketplace.svg",
  },
  { key: "craigslist", label: "Craigslist", iconPath: "/marketplace-icons/craigslist.svg" },
  { key: "reverb", label: "Reverb", iconPath: "/marketplace-icons/reverb.svg" },
];

function MarketplaceIcon({ iconPath, label }: { iconPath: string; label: string }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <span className="marketplace-mark">{label.slice(0, 1)}</span>;
  }

  return (
    <img
      alt={`${label} logo`}
      className="marketplace-icon"
      onError={() => setHasError(true)}
      src={iconPath}
    />
  );
}

export function MarketplacePicker({
  selectedPlatforms,
  onToggle,
  onContinue,
}: MarketplacePickerProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Create Listing</p>
          <h2>Where Are We Posting This Item Today?</h2>
        </div>
      </div>

      <div className="marketplace-grid">
        {marketplaceTiles.map((tile) => {
          const isSelected = selectedPlatforms.includes(tile.key);

          return (
            <button
              className={`marketplace-tile ${isSelected ? "selected" : ""}`}
              key={tile.key}
              onClick={() => onToggle(tile.key)}
              type="button"
            >
              <div className="marketplace-icon-shell">
                <MarketplaceIcon iconPath={tile.iconPath} label={tile.label} />
              </div>
              <span className="marketplace-label">{tile.label}</span>
            </button>
          );
        })}
      </div>

      <div className="picker-actions">
        <button
          className="primary-button"
          disabled={selectedPlatforms.length === 0}
          onClick={onContinue}
          type="button"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
