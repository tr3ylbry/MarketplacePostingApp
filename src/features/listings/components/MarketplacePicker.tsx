import type { PlatformSiteKey } from "../../../domain/listing";

interface MarketplacePickerProps {
  selectedPlatforms: PlatformSiteKey[];
  onToggle: (platform: PlatformSiteKey) => void;
  onContinue: () => void;
}

const marketplaceTiles: Array<{ key: PlatformSiteKey; label: string }> = [
  { key: "ebay", label: "eBay" },
  { key: "offerup", label: "OfferUp" },
  { key: "facebook-marketplace", label: "Facebook Marketplace" },
  { key: "craigslist", label: "Craigslist" },
  { key: "reverb", label: "Reverb" },
];

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
          <h2>Where are we posting this item today?</h2>
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
              <span className="marketplace-mark">{tile.label.slice(0, 1)}</span>
              <span>{tile.label}</span>
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
