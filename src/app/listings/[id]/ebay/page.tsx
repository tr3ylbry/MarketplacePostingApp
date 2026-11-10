import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "../../../../auth/session";
import { listingService } from "../../../../application/server";
import { ebayService } from "../../../../application/ebayServer";
import { safeEbayError } from "../../../../application/ebayConnection";
import { EbayPreparation } from "../../../../features/ebay/EbayPreparation";
import { EbaySellerReadiness } from "../../../../features/ebay/EbaySellerReadiness";

export const dynamic = "force-dynamic";
export default async function EbayPreparationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const listing = await listingService().getListing(user.id, id);
  if (!listing) notFound();
  try {
    // Local persisted state only. No metadata/token/provider request on render.
    const status = await ebayService().status(user.id);
    const connected = status.state === "connected" || status.state === "expired";
    return <><EbayPreparation listingId={id} version={listing.updatedAt} brand={listing.attributes.brand}
      model={listing.attributes.model} connected={connected} />
      <EbaySellerReadiness listingId={id} version={listing.updatedAt} connected={connected} authorized={status.readinessAuthorized} /></>;
  } catch (error) {
    return <section className="panel"><h2>eBay preparation — SANDBOX</h2><p role="alert">{safeEbayError(error)}</p><Link href="/settings/integrations/ebay">eBay connection settings</Link></section>;
  }
}
