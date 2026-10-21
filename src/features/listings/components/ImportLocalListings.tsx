"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadListings } from "../../../storage/listingsStorage";
import { importListingsAction } from "../../../app/listings/actions";

export function ImportLocalListings() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function importLocal() {
    setPending(true); setMessage("");
    try {
      const listings = loadListings();
      if (!listings.length) { setMessage("No valid local listings found for this browser origin. Local data was not changed."); return; }
      const result = await importListingsAction(listings);
      if (!result.ok) { setMessage(result.error); return; }
      setMessage(`Imported ${result.data.imported}; skipped ${result.data.skipped} existing IDs. Local data was not changed.`);
      router.refresh();
    } catch { setMessage("Import failed. Local data was not changed. Try again."); }
    finally { setPending(false); }
  }
  return <div><button className="secondary-button" type="button" disabled={pending} onClick={importLocal}>{pending ? "Importing…" : "Import local listings"}</button>
    <p>Import up to 100 validated listings from this browser origin. Existing database IDs are skipped; browser data is kept.</p>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
