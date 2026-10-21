import Link from "next/link";
import { listingService } from "../../application/server";
import { ListingDashboard } from "../../features/listings/components/ListingDashboard";
import { ImportLocalListings } from "../../features/listings/components/ImportLocalListings";
import { requireUser } from "../../auth/session";

export const dynamic = "force-dynamic";
export default async function ListingsPage() {
  const user = await requireUser();
  const listings = await listingService().listListings(user.id);
  return <section className="panel-stack">
    <div className="panel panel-stack"><Link className="primary-button" href="/listings/new">Create New Listing</Link><ImportLocalListings /></div>
    <ListingDashboard listings={listings} />
  </section>;
}
