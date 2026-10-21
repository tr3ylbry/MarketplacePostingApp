import Link from "next/link";
import { notFound } from "next/navigation";
import { listingService } from "../../../application/server";
import { PlatformPreview } from "../../../features/listings/components/PlatformPreview";
import { DeleteListingButton } from "../../../features/listings/components/DeleteListingButton";
import { requireUser } from "../../../auth/session";

export const dynamic = "force-dynamic";
export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const listing = await listingService().getListing(user.id, id);
  if (!listing) notFound();
  return <section className="panel-stack">
    <div className="panel"><h2>{listing.title}</h2><Link className="secondary-button" href={`/listings/${encodeURIComponent(id)}/edit`}>Edit listing</Link>{" "}<DeleteListingButton id={id} />
      {listing.images.length > 0 ? <p>Saved photos are filename references only. Re-select files in the editor after a reload to view or download them.</p> : null}
    </div>
    <PlatformPreview listing={listing} />
  </section>;
}
