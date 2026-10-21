import { getListingAgeLabel, type Listing } from "../../../domain/listing";
import Link from "next/link";
import { DeleteListingButton } from "./DeleteListingButton";

interface ListingDashboardProps {
  listings: Listing[];
}

export function ListingDashboard({
  listings,
}: ListingDashboardProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Dashboard</p>
          <h2>Saved listings</h2>
        </div>
        <span className="summary-pill">{listings.length} total</span>
      </div>

      {listings.length === 0 ? (
        <p className="empty-state">
          Your saved listings will appear here with status and age.
        </p>
      ) : (
        <div className="dashboard-list">
          {listings.map((listing) => {
            const categoryLabel =
              listing.marketplaceDetails.ebayCategory ||
              listing.marketplaceDetails.offerupCategory ||
              listing.marketplaceDetails.facebookCategory ||
              listing.marketplaceDetails.craigslistCategory ||
              listing.marketplaceDetails.reverbCategory ||
              "No Category";

            return (
              <article className="listing-card" key={listing.id}>
                <div className="listing-card-header">
                  <h3><Link href={`/listings/${encodeURIComponent(listing.id)}`}>{listing.title}</Link></h3>
                  <span className={`status-pill status-${listing.status}`}>
                    {listing.status}
                  </span>
                </div>
                <p>${listing.askingPrice.amount.toFixed(2)}</p>
                <p>
                  {categoryLabel} · {listing.condition || "No Condition"}
                </p>
                <p>{getListingAgeLabel(listing.createdAt)}</p>
                <div className="listing-card-actions">
                  <Link className="secondary-button" href={`/listings/${encodeURIComponent(listing.id)}/edit`}>Edit</Link>
                  <DeleteListingButton id={listing.id} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
