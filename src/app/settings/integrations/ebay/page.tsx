import Link from "next/link";
import { requireEbaySession } from "../../../../auth/ebaySession";
import { ebayService } from "../../../../application/ebayServer";
import { safeEbayError } from "../../../../application/ebayConnection";
import { EbayConnectionControls } from "../../../../features/ebay/EbayConnectionControls";
export const dynamic = "force-dynamic";
const states: Record<string, string> = { "not-connected": "Not connected", connected: "Connected", expired: "Authorization expired", reconnect: "Reconnect required", "identity-unverified": "Identity unverified" };
const outcomes: Record<string, string> = { connected: "Sandbox seller connected.", denied: "Authorization was cancelled.", failed: "Authorization could not be verified. Start again.", "session-required": "Sign in again before connecting eBay." };
export default async function EbaySettings({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const session = await requireEbaySession(), query = await searchParams;
  try {
    const status = await ebayService().status(session.owner);
    return <section className="panel"><h2>eBay integration — SANDBOX</h2><p>Local development. Seller connection only.</p>
      <p>{states[status.state]}</p>{status.sellerLabel ? <p>Verified seller: {status.sellerLabel}</p> : null}
      <p>Permissions: {status.scopes.length ? status.readinessAuthorized ? "Account identity, read-only account settings/business policies and read-only inventory locations." : "Basic authenticated account identity (Trading GetUser)." : "None granted."}</p>
      {query.result && outcomes[query.result] ? <p role="status">{outcomes[query.result]}</p> : null}
      <EbayConnectionControls connected={status.state !== "not-connected"} readinessAuthorized={status.readinessAuthorized} /><Link href="/listings">Back to listings</Link></section>;
  } catch (error) { return <section className="panel"><h2>eBay integration — SANDBOX</h2><p role="alert">{safeEbayError(error)}</p><Link href="/listings">Back to listings</Link></section>; }
}
