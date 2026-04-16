import type { Listing } from "../../../domain/listing";
import { ebayAdapter } from "../../../platforms";

interface PlatformPreviewProps {
  listing: Listing | null;
}

export function PlatformPreview({ listing }: PlatformPreviewProps) {
  if (!listing) {
    return (
      <section className="panel panel-muted">
        <p className="panel-kicker">Platform Preview</p>
        <h2>No listing selected yet</h2>
        <p>Create a listing to see how the first adapter formats it for eBay.</p>
      </section>
    );
  }

  const formatted = ebayAdapter.formatListing(listing);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Adapter Output</p>
          <h2>{formatted.platform} preview</h2>
        </div>
      </div>

      <div className="preview-group">
        <span className="preview-label">Title</span>
        <p>{formatted.title}</p>
      </div>

      <div className="preview-group">
        <span className="preview-label">Price</span>
        <p>${formatted.price}</p>
      </div>

      <div className="preview-group">
        <span className="preview-label">Description</span>
        <pre>{formatted.description}</pre>
      </div>

      <div className="preview-group">
        <span className="preview-label">Images</span>
        <p>{formatted.imageNames.length} selected</p>
      </div>

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
