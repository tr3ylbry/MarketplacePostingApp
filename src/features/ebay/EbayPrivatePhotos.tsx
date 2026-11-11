"use client";
import { useEffect, useState, useTransition } from "react";
import { prepareEbayPrivateImageAction } from "../../app/listings/[id]/ebay/actions";
import type { PrivateImageReview } from "../../application/ebayPrivateImageService";

export interface PrivatePhotoSummary { id: string; order: number; name: string; supported: boolean }
export function EbayPrivatePhotos({ listingId, version, photos, connected }: { listingId: string; version: string; photos: PrivatePhotoSummary[]; connected: boolean }) {
  const [hydrated, setHydrated] = useState(false), [busy, start] = useTransition();
  const [reviews, setReviews] = useState<Record<string, PrivateImageReview>>({}), [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    const nextExpiry = Math.min(...Object.values(reviews).map(review => Date.parse(review.expiresAt)).filter(expiry => expiry > now));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, nextExpiry - Date.now())));
    return () => window.clearTimeout(timer);
  }, [reviews, now]);
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
      {connected && reviews[photo.id] ? <p role="status">{Date.parse(reviews[photo.id].expiresAt) > now ? <>Photo verified for local export review: {reviews[photo.id].width} × {reviews[photo.id].height} pixels · {reviews[photo.id].size} bytes. Export not attempted.</> : "Photo review expired. Validate this photo again."} Revalidate after changes or before any future transfer.</p> : null}
    </li>)}</ol>}
    {busy ? <p role="status">Validating private photo…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button disabled>Upload to eBay — unavailable</button>
    <p>Sending photos to eBay is not available yet. Its test photo-upload behavior and photo-privacy requirements must be verified first. Validating a photo only checks the local private copy; it does not request additional seller permissions.</p>
  </section>;
}
