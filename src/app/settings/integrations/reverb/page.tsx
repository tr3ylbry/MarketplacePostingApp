import Link from "next/link";
import { requireUser } from "../../../../auth/session";
import { reverbService } from "../../../../application/reverbServer";
import { safeReverbError } from "../../../../application/reverbService";
import { reverbEnvironment } from "../../../../infrastructure/reverb/reverbClient";
import { ReverbConnectionForm } from "../../../../features/reverb/ReverbConnectionForm";
export const dynamic = "force-dynamic";
export default async function ReverbSettings() {
  const user = await requireUser();
  try {
    const status = await reverbService().status(user.id);
    return <section className="panel"><h2>Reverb integration — {status.environment.toUpperCase()}</h2>
      <p>{status.environment === "live" ? "LIVE ACCOUNT: draft-only writes affect your real Reverb account." : "Sandbox only: no live marketplace listings."}</p>
      <p>{status.connected ? `Connected to ${status.shopName} since ${status.connectedAt}` : "Not connected"}</p>
      {status.needsReconnect ? <p role="alert">Reverb requires a replacement token.</p> : null}
      <ReverbConnectionForm connected={status.connected} /><Link href="/listings">Back to listings</Link></section>;
  } catch (error) {
    return <section className="panel"><h2>Reverb integration — {reverbEnvironment().toUpperCase()}</h2><p role="alert">{safeReverbError(error)}</p><p>Ask the operator to configure the dedicated Reverb encryption key.</p></section>;
  }
}
