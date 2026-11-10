"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginEbayAuthorization, beginEbayReadinessAuthorization, disconnectEbay, renewEbayAuthorization } from "../../app/settings/integrations/ebay/actions";
export function EbayConnectionControls({ connected, readinessAuthorized = false }: { connected: boolean; readinessAuthorized?: boolean }) {
  const [busy, start] = useTransition(), [message, setMessage] = useState(""); const router = useRouter();
  return <><button disabled={busy} onClick={() => start(async () => {
    try { const result = await beginEbayAuthorization(); if (result.ok) window.location.assign(result.url); else setMessage(result.error); }
    catch { setMessage("Authorization could not be started."); }
  })}>{connected ? "Reconnect eBay Sandbox" : "Connect eBay Sandbox"}</button>
    {connected && !readinessAuthorized ? <div id="readiness-permissions">
      <p>Seller checks need your permission to read account settings, business policies and inventory locations. Your existing connection remains available until authorization succeeds. No write permission is requested.</p>
      <button disabled={busy} onClick={() => start(async () => {
        try { const result = await beginEbayReadinessAuthorization(); if (result.ok) window.location.assign(result.url); else setMessage(result.error); }
        catch { setMessage("Additional authorization could not be started."); }
      })}>Authorize read-only seller checks</button>
    </div> : null}
    {connected ? <><button disabled={busy} onClick={() => start(async () => {
      try { const r = await renewEbayAuthorization(); setMessage(r.ok ? "Authorization checked." : r.error); router.refresh(); } catch { setMessage("Authorization check failed."); }
    })}>Check eBay authorization</button><button disabled={busy} onClick={() => start(async () => {
      try { const r = await disconnectEbay(); setMessage(r.ok ? "Disconnected locally." : r.error); router.refresh(); } catch { setMessage("Disconnection could not be confirmed."); }
    })}>Disconnect eBay</button></> : null}
    <p>Disconnect removes the stored tokens and invalidates pending requests. Revoke provider authorization separately on eBay if needed.</p><p role="status">{message}</p></>;
}
