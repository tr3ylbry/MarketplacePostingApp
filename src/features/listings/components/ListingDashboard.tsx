import { getListingAgeLabel, type Listing } from "../../../domain/listing";

interface ListingDashboardProps {
  listings: Listing[];
  selectedListingId: string | null;
  onEdit: (listingId: string) => void;
  onDelete: (listingId: string) => void;
}

export function ListingDashboard({
  listings,
  selectedListingId,
  onEdit,
  onDelete,
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
            const isSelected = listing.id === selectedListingId;

            return (
              <article className={`listing-card ${isSelected ? "selected" : ""}`} key={listing.id}>
                <div className="listing-card-header">
                  <h3>{listing.title}</h3>
                  <span className={`status-pill status-${listing.status}`}>
                    {listing.status}
                  </span>
                </div>
                <p>${listing.price.toFixed(2)}</p>
                <p>
                  {listing.category} · {listing.condition}
                </p>
                <p>{getListingAgeLabel(listing.createdAt)}</p>
                <div className="listing-card-actions">
                  <button
                    className="secondary-button"
                    onClick={() => onEdit(listing.id)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => onDelete(listing.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
