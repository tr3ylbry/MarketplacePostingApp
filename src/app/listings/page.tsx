import Link from "next/link";
import { listingService } from "../../application/server";
import { ListingDashboard } from "../../features/listings/components/ListingDashboard";
import { ImportLocalListings } from "../../features/listings/components/ImportLocalListings";

export const dynamic = "force-dynamic";
export default async function ListingsPage() {
  const listings = await listingService().listListings();
  return <section className="panel-stack">
    <div className="panel"><Link className="primary-button" href="/listings/new">Create New Listing</Link><ImportLocalListings /></div>
    <ListingDashboard listings={listings} />
  </section>;
}
