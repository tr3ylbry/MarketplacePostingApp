import { notFound } from "next/navigation";
import { listingService } from "../../../../application/server";
import { ListingEditor } from "../../../../features/listings/components/ListingEditor";
import { requireUser } from "../../../../auth/session";

export const dynamic = "force-dynamic";
export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const listing = await listingService().getListing(user.id, id);
  if (!listing) notFound();
  return <ListingEditor key={listing.id} initialListing={listing} />;
}
