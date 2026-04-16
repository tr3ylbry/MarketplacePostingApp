import { useEffect, useState } from "react";
import type { Listing } from "../../../domain/listing";
import { ebayAdapter, reverbAdapter } from "../../../platforms";

interface PlatformPreviewProps {
  listing: Listing | null;
}

const adapters = [ebayAdapter, reverbAdapter];

export function PlatformPreview({ listing }: PlatformPreviewProps) {
  const [selectedAdapterIndex, setSelectedAdapterIndex] = useState(0);
  const [copiedFieldKey, setCopiedFieldKey] = useState<string | null>(null);

  useEffect(() => {
    setCopiedFieldKey(null);
  }, [listing, selectedAdapterIndex]);

  if (!listing) {
    return (
      <section className="panel panel-muted">
        <p className="panel-kicker">Platform Preview</p>
        <h2>No listing selected yet</h2>
        <p>Create a listing to preview each marketplace adapter.</p>
      </section>
    );
  }

  const adapter = adapters[selectedAdapterIndex];
  const formatted = adapter.formatListing(listing);

  async function handleCopy(fieldKey: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedFieldKey(fieldKey);
  }

  function showPreviousPreview() {
    setSelectedAdapterIndex((current) =>
      current === 0 ? adapters.length - 1 : current - 1,
    );
  }

  function showNextPreview() {
    setSelectedAdapterIndex((current) =>
      current === adapters.length - 1 ? 0 : current + 1,
    );
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
            {selectedAdapterIndex + 1} / {adapters.length}
          </span>
          <button className="secondary-button" onClick={showNextPreview} type="button">
            →
          </button>
        </div>
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
