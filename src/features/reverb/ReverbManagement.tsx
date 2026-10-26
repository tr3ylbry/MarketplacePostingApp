"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { createReverbService } from "../../application/reverbService";
import { deleteReverbDraft, loadReverbOptions, refreshReverbStatus } from "../../app/settings/integrations/reverb/actions";
import { ReverbDraftForm } from "./ReverbDraftForm";
type Service = ReturnType<typeof createReverbService>;
type State = Awaited<ReturnType<Service["localState"]>>;
type Options = Awaited<ReturnType<Service["options"]>>;

export function ReverbManagement({ listingId, initialState }: { listingId: string; initialState: State }) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();
  const publication = initialState.publication;
  function check(remove: boolean) {
    if (remove && !window.confirm("Delete this draft from Reverb? Your local MarketplacePostingApp listing and photos will remain.")) return;
    setOptions(null);
    start(async () => {
      try {
        const response = await (remove ? deleteReverbDraft(listingId) : refreshReverbStatus(listingId));
        setMessage(response.ok ? response.data.message : response.error);
        router.refresh(); // Local persisted state only; never a provider fetch.
      } catch { setMessage("Status could not be confirmed. Refresh Reverb Status before another action."); }
    });
  }
  return <div className="panel-stack"><section className="panel" aria-label="Reverb status">
    <h2>Reverb — {initialState.environment.toUpperCase()}</h2>
    <p>{initialState.connected ? `Connected shop: ${initialState.shopName}` : "Connect your Reverb account first."}</p>
    <dl><dt>Local publication status</dt><dd>{publication?.status ?? "Not linked"}</dd>
      <dt>Last known provider state</dt><dd>{publication?.providerState ?? "Not checked"}</dd>
      <dt>Last checked</dt><dd>{publication?.providerCheckedAt ?? "Never"}</dd></dl>
    {publication?.providerState === "missing" ? <p>The remote listing is missing. Your local listing and photos remain.</p> : null}
    {publication?.providerState && !["draft", "missing"].includes(publication.providerState) ? <p>This Reverb listing is no longer a draft. Manage it on Reverb.</p> : null}
    {publication?.externalUrl ? <p><a href={publication.externalUrl} target="_blank" rel="noreferrer">Open on Reverb</a></p> : null}
    <p>These are saved local details. Reverb is contacted only when you explicitly choose an action.</p>
    <button disabled={busy || !initialState.connected} onClick={() => check(false)}>Refresh Reverb Status</button>
    {publication?.providerState === "draft" && publication.externalListingId ? <button disabled={busy} onClick={() => check(true)}>Delete Reverb Draft</button> : null}
    <button disabled={busy || !initialState.connected} onClick={() => start(async () => {
      try { const response = await loadReverbOptions(listingId); if (response.ok) { setOptions(response.data); setMessage(""); } else setMessage(response.error); }
      catch { setMessage("Reverb options could not be loaded. Try again later."); }
    })}>Load Reverb Options</button>
    <p role="status">{message}</p>
    <Link href="/settings/integrations/reverb">Reverb connection settings</Link>
  </section>
    {options ? <ReverbDraftForm listingId={listingId} options={options} onCreated={() => router.refresh()} /> : null}
    <Link href={`/listings/${encodeURIComponent(listingId)}`}>Back to listing</Link>
  </div>;
}
