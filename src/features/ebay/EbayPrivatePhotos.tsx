"use client";
import { useEffect, useState, useTransition } from "react";
import { prepareEbayPrivateImageAction } from "../../app/listings/[id]/ebay/actions";
import type { PrivateImageReview } from "../../application/ebayPrivateImageService";

export interface PrivatePhotoSummary { id: string; order: number; name: string; supported: boolean }
export function EbayPrivatePhotos({ listingId, version, photos, connected }: { listingId: string; version: string; photos: PrivatePhotoSummary[]; connected: boolean }) {
  const [hydrated, setHydrated] = useState(false), [busy, start] = useTransition();
  const [reviews, setReviews] = useState<Record<string, PrivateImageReview>>({}), [error, setError] = useState("");
  useEffect(() => setHydrated(true), []);
  return <section className="panel" aria-labelledby="private-photo-title" aria-busy={busy}>
    <h2 id="private-photo-title">Private photo preparation — SANDBOX</h2>
    <p>Validate one saved private JPEG or PNG at a time. Nothing is uploaded to eBay. Results are temporary and do not authorize an export.</p>
    <p>Supported preparation: at most 10 MiB, at least 500 pixels on the longest side and at most 4096 pixels per side; static 8-bit RGB or grayscale only. Compressed PNG metadata is unsupported. Photos are not converted.</p>
    {!connected ? <p>Connect your verified Sandbox seller before preparing photos.</p> : null}
    {!photos.length ? <p>No local photos. Add a saved private photo through the listing editor.</p> : <ol>{photos.map(photo => <li key={photo.id}>
      <p>Photo {photo.order + 1}: {photo.name} · {photo.supported ? "Local private photo available" : "Unsupported local photo — save a private JPEG or PNG"}</p>
      <button disabled={!hydrated || busy || !connected || !photo.supported} onClick={() => start(async () => {
        setError(""); setReviews(previous => { const next = { ...previous }; delete next[photo.id]; return next; });
        try { const result = await prepareEbayPrivateImageAction(listingId, version, photo.id); if (result.ok) setReviews(previous => ({ ...previous, [photo.id]: result.data })); else setError(result.error); }
        catch { setError("Private photo preparation could not be completed."); }
      })}>Validate photo {photo.order + 1}</button>
      {reviews[photo.id] ? <p role="status">Photo verified for local export review: {reviews[photo.id].width} × {reviews[photo.id].height} pixels · {reviews[photo.id].size} bytes. Export not attempted. Revalidate after changes or before any future transfer.</p> : null}
    </li>)}</ol>}
    {busy ? <p role="status">Validating private photo…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button disabled>Upload to eBay — unavailable</button>
    <p>EPS upload, readback and durable export recovery are not implemented here. The image-specific Sandbox host and provider limits need confirmation. A separately reviewed sell.inventory authorization is also required; that permission allows inventory writes beyond image upload. No new permission is requested by validation.</p>
  </section>;
}
