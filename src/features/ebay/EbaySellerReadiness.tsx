"use client";
import Link from "next/link";
import { useEffect, useId, useState, useTransition } from "react";
import type { EbayReadinessReport } from "../../application/ebayReadinessService";
import { checkEbayReadinessAction } from "../../app/listings/[id]/ebay/actions";

export function EbaySellerReadiness({ listingId, version, connected, authorized }: { listingId: string; version: string; connected: boolean; authorized: boolean }) {
  const fields = useId();
  const [ready, setReady] = useState(false), [busy, start] = useTransition();
  const [report, setReport] = useState<EbayReadinessReport | null>(null), [error, setError] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  useEffect(() => { setReady(true); }, []);
  return <section className="panel" aria-labelledby="seller-readiness-title">
    <h2 id="seller-readiness-title">eBay seller readiness — SANDBOX</h2>
    <p>Check existing seller settings only. Nothing is enrolled, created, uploaded or published.</p>
    {!connected ? <p>Connect your verified Sandbox seller first.</p> : !authorized ? <p>Additional read-only permissions are required. Your existing connection is preserved.</p> : null}
    <Link href="/settings/integrations/ebay#readiness-permissions">eBay connection and permissions</Link>
    <button disabled={!ready || busy || !connected || !authorized} onClick={() => start(async () => {
      setError(""); setReport(null); setSelection({});
      try { const result = await checkEbayReadinessAction(listingId, version); if (result.ok) setReport(result.data); else setError(result.error); }
      catch { setError("Seller checks could not be completed. Try again."); }
    })}>Check eBay Seller Readiness</button>
    {busy ? <p role="status">Checking seller settings…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {report ? <div role="region" aria-label="Seller readiness result">
      <p>Checked {new Date(report.checkedAt).toLocaleString()} · EBAY_US</p>
      <dl><dt>Ready to prepare a local review</dt><dd>Yes; this does not create an eBay resource.</dd>
        <dt>Seller registration</dt><dd>{report.registrationComplete ? "Completed" : "Incomplete — finish seller registration on eBay."}</dd>
        <dt>Inventory staging</dt><dd>Not implemented. Inventory read access succeeded; write eligibility remains unverified.</dd>
        <dt>Unpublished offers</dt><dd>Not implemented. A sparse unpublished offer does not necessarily require complete policies or a location.</dd>
        <dt>Future publishing</dt><dd>Unavailable. Seller registration, enrollment, policies, category applicability, shipping and a suitable location must all be verified later.</dd>
        <dt>Business-policy enrollment</dt><dd>{report.businessPoliciesEnrolled ? "Enrolled" : "Not enrolled — manage business policies directly on eBay when needed."}</dd>
      </dl>
      {report.zeroMonthlyQuantityLimit ? <p>A zero monthly selling-quantity limit was reported. Resolve selling restrictions on eBay before publishing; this is not an Inventory-write eligibility result.</p> : null}
      <p>Selections below are temporary review choices, not saved settings or permission to write. Policy candidates are checked for EBAY_US and non-motor category type; exact leaf/category and shipping suitability remain unverified. Your canonical shipping rate is not a fulfillment policy.</p>
      {(["fulfillment", "payment", "return"] as const).map(kind => {
        const candidates = report.policies[kind].filter(p => p.categoryTypes.includes("ALL_EXCLUDING_MOTORS_VEHICLES"));
        return <div key={kind}><label htmlFor={fields + kind}>{kind[0].toUpperCase() + kind.slice(1)} policy</label>
          <select id={fields + kind} value={selection[kind] ?? ""} onChange={e => setSelection(s => ({ ...s, [kind]: e.target.value }))}>
            <option value="">{candidates.length ? "Choose an existing policy" : "No compatible existing policy"}</option>
            {candidates.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </select>
          {!candidates.length ? <small>No existing non-motor EBAY_US policy. Configure it deliberately on eBay before future publishing; this app will not create one.</small> : null}
        </div>;
      })}
      <label htmlFor={fields + "location"}>Inventory warehouse location</label>
        <select id={fields + "location"} value={selection.location ?? ""} onChange={e => setSelection(s => ({ ...s, location: e.target.value }))}>
          <option value="">Choose an existing enabled warehouse</option>
          {report.locations.map(l => <option key={l.key} value={l.key} disabled={!l.enabled || !l.warehouse || !l.addressComplete}>
            {l.name ?? "Warehouse"} ({l.key}){!l.enabled ? " — disabled" : !l.warehouse ? " — unsupported type" : !l.addressComplete ? " — incomplete location" : ""}
          </option>)}
        </select>
      {!report.locations.some(l => l.enabled && l.warehouse && l.addressComplete) ? <p>No usable enabled warehouse. Configure an appropriate location directly on eBay when required; no location will be invented.</p> : null}
      <p>Full addresses, contact information and financial limits are not displayed. Location regional suitability and API staging eligibility remain later acceptance gates.</p>
    </div> : null}
  </section>;
}
