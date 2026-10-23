"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { createReverbService } from "../../application/reverbService";
import { createReverbDraft, prepareReverb } from "../../app/settings/integrations/reverb/actions";
type Service = ReturnType<typeof createReverbService>;
type Options = Awaited<ReturnType<Service["options"]>>;
type Review = Awaited<ReturnType<Service["prepare"]>>;
export function ReverbDraftForm({ listingId, options }: { listingId: string; options: Options }) {
  const [review, setReview] = useState<Review | null>(null), [message, setMessage] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<Service["createDraft"]>> | null>(null);
  const [busy, start] = useTransition();
  return <div className="panel-stack"><div className="panel"><h2>Prepare Reverb Draft — {options.environment.toUpperCase()}</h2>
    <p>Shop: {options.shopName}. This action never publishes live.</p>
    {options.environment === "live" ? <p role="alert">LIVE ACCOUNT: this creates a draft in your real Reverb shop.</p> : null}
    {options.unavailableImages ? <p role="alert">{options.unavailableImages} unavailable legacy photos: remove or re-upload before continuing.</p> : null}
    <form action={form => { setReview(null); setResult(null); start(async () => {
      try { const shipping = String(form.get("shipping") || ""); const response = await prepareReverb(listingId, { categoryId: form.get("category"), conditionId: form.get("condition"), shippingProfileId: shipping === "rate" ? undefined : shipping });
        if (response.ok) { setReview(response.data); setMessage(""); } else setMessage(response.error);
      } catch { setMessage("Preparation unavailable. No Reverb draft was requested."); }
    }); }}>
      <label>Reverb category <select name="category" required defaultValue=""><option value="" disabled>Select a real Reverb category</option>{options.categories.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>Reverb condition <select name="condition" required defaultValue=""><option value="" disabled>Select a real Reverb condition</option>{options.conditions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>Reverb shipping <select name="shipping" required defaultValue=""><option value="" disabled>Select shipping explicitly</option>
        {options.shippingRate !== undefined ? <option value="rate">Continental US rate: ${options.shippingRate.toFixed(2)}</option> : null}
        {options.shippingProfiles.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <p>Shipping profiles are recommended. No profile is chosen automatically. Explicit rates ship to continental US only.</p>
      <button disabled={busy} type="submit">Review Reverb Draft</button>
    </form></div>
    {review ? <section className="panel" aria-label="Reverb draft review"><h3>Review exactly what will be sent</h3>
      <dl>{Object.entries({ Shop: review.shopName, Environment: review.environment.toUpperCase(), Title: review.payload.title,
        Make: review.payload.make, Model: review.payload.model, Year: review.payload.year || "Not sent", Finish: review.payload.finish || "Not sent",
        Category: review.selection.category.name, Condition: review.selection.condition.name, Description: review.payload.description,
        Price: `${review.payload.price.amount} USD`, Shipping: review.selection.shippingProfile?.name ?? `${review.payload.shipping?.rates[0].rate.amount} USD — continental US`,
        Photos: review.photoCount, SKU: review.payload.sku }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p>Only a draft will be created. Review expires in 10 minutes. Changes to the listing or connection require a fresh review.</p>
      <button type="button" disabled={busy || !!result} onClick={() => start(async () => { try { const response = await createReverbDraft(review.reviewId);
        if (response.ok) { setResult(response.data); setMessage("Reverb draft saved locally. No live listing was published."); } else setMessage(response.error);
      } catch { setMessage("Outcome uncertain. Prepare again to reconcile by SKU; do not manually create a duplicate."); } })}>Create Reverb Draft</button>
    </section> : null}
    <p role="status">{message}</p>
    {result ? <div className="panel">Reverb draft ID: {result.externalListingId}{result.externalUrl ? <> · <a href={result.externalUrl} target="_blank" rel="noreferrer">Open Reverb draft</a></> : null}</div> : null}
    <Link href={`/listings/${encodeURIComponent(listingId)}`}>Back to listing</Link>
  </div>;
}
