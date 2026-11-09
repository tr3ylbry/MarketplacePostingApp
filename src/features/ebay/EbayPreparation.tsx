"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EbayAspect, EbayCategoryBranch, EbayCategoryRequirements } from "../../application/ebayMetadata";
import type { EbayPreparationReview } from "../../application/ebayPreparationMapping";
import { loadEbayMetadataAction, reviewEbayPreparationAction } from "../../app/listings/[id]/ebay/actions";

interface Props { listingId: string; version: string; connected: boolean; brand: string; model: string }
const supportsInput = (aspect: EbayAspect) => aspect.dataType === "STRING" && !aspect.format && !aspect.advancedType;
export function EbayPreparation({ listingId, version, connected, brand, model }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState<EbayCategoryBranch | null>(null);
  const [requirements, setRequirements] = useState<EbayCategoryRequirements | null>(null);
  const [conditionId, setConditionId] = useState("");
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [review, setReview] = useState<EbayPreparationReview | null>(null);

  async function load(categoryId?: string) {
    setPending(true); setError(null); setReview(null);
    try {
      const result = await loadEbayMetadataAction(listingId, version, categoryId);
      if (!result.ok) { setError(result.error); return; }
      setBranch(result.data.branch); setRequirements(result.data.requirements); setConditionId("");
      const defaults = result.data.requirements?.aspects.flatMap(a => {
        const value = a.name === "Brand" ? brand : a.name === "Model" ? model : "";
        return value && a.mode === "FREE_TEXT" && supportsInput(a) && !a.values.find(v => v.value === value)?.conditional
          ? [[a.name, [value]] as [string, string[]]] : [];
      }) ?? [];
      setValues(Object.fromEntries(defaults));
    } catch { setError("eBay metadata could not be loaded. Try again."); }
    finally { setPending(false); }
  }
  async function prepare() {
    if (!requirements?.branch.category) return;
    setPending(true); setError(null); setReview(null);
    try {
      const result = await reviewEbayPreparationAction(listingId, version, {
        categoryId: requirements.branch.category.id, conditionId,
        aspects: Object.entries(values).map(([name, selected]) => ({ name, values: selected.map(v => v.trim()).filter(Boolean) })).filter(a => a.values.length),
      });
      if (result.ok) setReview(result.data); else setError(result.error);
    } catch { setError("The eBay review could not be prepared. Try again."); }
    finally { setPending(false); }
  }
  function change(name: string, selected: string[]) {
    setValues(current => ({ ...current, [name]: selected })); setReview(null);
  }

  return <section className="panel-stack">
    <div className="panel">
      <h2>eBay preparation — SANDBOX</h2>
      <p>Read-only category and listing review. Nothing is uploaded, staged or published to eBay.</p>
      <Link href={`/listings/${encodeURIComponent(listingId)}`}>Back to local listing</Link>{" · "}
      <Link href="/settings/integrations/ebay">eBay connection settings</Link>
      {!connected ? <p>Connect your verified eBay Sandbox seller before loading options.</p> : null}
    </div>
    <fieldset className="panel" disabled={!ready || pending || !connected}>
      <legend>Category and item details</legend>
      <button type="button" onClick={() => void load()}>Load eBay categories</button>
      {branch ? <>
        <p>Category tree version: {branch.treeVersion}</p>
        <p>{branch.category?.name ?? "Browse a category branch"}</p>
        <ul>{branch.children.map(child => <li key={child.id}><button type="button" onClick={() => void load(child.id)}>{child.leaf ? "Select" : "Browse"} {child.name}</button></li>)}</ul>
      </> : null}
      {requirements ? <>
        <label>eBay condition
          <select value={conditionId} onChange={event => { setConditionId(event.target.value); setReview(null); }}>
            <option value="">Choose a supported used condition</option>
            {requirements.conditions.filter(c => c.supported).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <p>Use truthful values. Number/date/range formats and conditional choices are deferred; they block review if required.</p>
        {requirements.aspects.map(a => {
          const supported = supportsInput(a);
          return <label key={a.name}>{a.name}{a.required ? " (required)" : " (optional)"}
            {a.mode === "SELECTION_ONLY" ? <select multiple={a.cardinality === "MULTI"} disabled={!supported}
              value={a.cardinality === "MULTI" ? values[a.name] ?? [] : values[a.name]?.[0] ?? ""}
              onChange={event => change(a.name, Array.from(event.target.selectedOptions).map(o => o.value).filter(Boolean))}>
              {a.cardinality === "SINGLE" ? <option value="">Choose a value</option> : null}
              {a.values.map(v => <option key={v.value} value={v.value} disabled={v.conditional}>{v.value}{v.conditional ? " (conditional; unsupported)" : ""}</option>)}
            </select> : <textarea rows={a.cardinality === "MULTI" ? 3 : 1} disabled={!supported}
              value={(values[a.name] ?? []).join("\n")} aria-describedby={`aspect-help-${requirements.aspects.indexOf(a)}`}
              onChange={event => change(a.name, event.target.value.split("\n"))} />}
            <small id={`aspect-help-${requirements.aspects.indexOf(a)}`}>{a.cardinality === "MULTI" ? "One value per line or selection; up to 30 values." : "One value."} Maximum {a.maxLength} characters per value.</small>
          </label>;
        })}
        <button type="button" onClick={() => void prepare()} disabled={!conditionId}>Prepare eBay review</button>
      </> : null}
    </fieldset>
    {pending ? <p role="status">Loading eBay metadata…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {review ? <div className="panel" role="region" aria-label="eBay preparation review">
      <h3>Read-only eBay review</h3>
      <dl><dt>Environment</dt><dd>SANDBOX · EBAY_US · FIXED_PRICE</dd>
        <dt>Title</dt><dd>{review.title}</dd><dt>Description</dt><dd>{review.description}</dd>
        <dt>Category</dt><dd>{review.category.name}</dd><dt>Condition</dt><dd>{review.condition.name} · {review.condition.inventoryEnum}</dd>
        <dt>Price</dt><dd>{review.price.value} {review.price.currency}</dd><dt>Quantity</dt><dd>{review.quantity}</dd>
        <dt>SKU</dt><dd>{review.sku}</dd><dt>Item aspects</dt><dd>{Object.entries(review.aspects).map(([name, selected]) => <p key={name}>{name}: {selected.join(", ")}</p>)}</dd>
        <dt>Local photos</dt><dd>{review.photos.durable} durable; {review.photos.unavailable} unavailable. No photo has been exported.</dd></dl>
      <p>Not ready for remote staging. Remaining work:</p><ul>{review.remaining.map(step => <li key={step}>{step}</li>)}</ul>
    </div> : null}
  </section>;
}
