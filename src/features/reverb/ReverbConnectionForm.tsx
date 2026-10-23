"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectReverb, disconnectReverb } from "../../app/settings/integrations/reverb/actions";
export function ReverbConnectionForm({ connected }: { connected: boolean }) {
  const [message, setMessage] = useState(""); const [busy, start] = useTransition(); const router = useRouter();
  return <><form action={form => {
    const token = form.get("token");
    start(async () => { try { const result = await connectReverb(token); setMessage(result.ok ? "Reverb connected." : result.error); if (result.ok) router.refresh(); }
      catch { setMessage("Connection unavailable. Try again later."); } });
  }}>
    <label>Reverb Personal Access Token <input name="token" type="password" required autoComplete="off" maxLength={4096} /></label>
    <p>Scopes: public, read_listings, write_listings, read_profile (shop identity and shipping profiles). The token is encrypted on the server and never returned.</p>
    <button type="submit" disabled={busy}>{busy ? "Working…" : connected ? "Replace Reverb token" : "Connect Reverb"}</button>
  </form>
  {connected ? <button disabled={busy} type="button" onClick={() => start(async () => { try { const result = await disconnectReverb(); setMessage(result.ok ? "Disconnected locally. Revoke the token in Reverb if needed." : result.error); router.refresh(); } catch { setMessage("Disconnect could not be confirmed."); } })}>Disconnect Reverb</button> : null}
  <p>Disconnect removes the encrypted local credential only. It does not revoke the token or change Reverb listings.</p>
  <p role="status">{message}</p></>;
}
