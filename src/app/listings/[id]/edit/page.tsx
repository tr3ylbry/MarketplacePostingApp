import { notFound } from "next/navigation";
import { listingService } from "../../../../application/server";
import { ListingEditor } from "../../../../features/listings/components/ListingEditor";

export const dynamic = "force-dynamic";
export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await listingService().getListing(id);
  if (!listing) notFound();
  return <ListingEditor key={`${listing.id}:${listing.updatedAt}`} initialListing={listing} />;
}
