import { getListingAgeLabel } from "../../../domain/listing";
import { MAX_INVENTORY_QUERY_LENGTH, type InventoryPage } from "../../../application/inventory";
import Link from "next/link";
import Form from "next/form";
import { DeleteListingButton } from "./DeleteListingButton";
import { inventoryHref } from "../inventoryNavigation";

interface ListingDashboardProps {
  inventory?: InventoryPage;
  query: string;
  error?: string;
  invalidSearch?: boolean;
  retryHref?: string;
}

export function ListingDashboard({ inventory, query, error, invalidSearch = false, retryHref }: ListingDashboardProps) {
  const first = inventory?.items.length ? (inventory.page - 1) * inventory.pageSize + 1 : 0;
  const last = first && inventory ? first + inventory.items.length - 1 : 0;
  return (
    <section className="panel" aria-labelledby="inventory-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Dashboard</p>
          <h2 id="inventory-heading">Saved listings</h2>
        </div>
        {inventory ? <span className="summary-pill">{inventory.matchingCount} {query ? "matching" : "total"}</span> : null}
      </div>

      <Form action="/listings" prefetch={false} className="inventory-search" aria-label="Search saved inventory">
        <label htmlFor="inventory-query">Search inventory titles
          <input key={query} id="inventory-query" name="q" type="search" defaultValue={query}
            maxLength={MAX_INVENTORY_QUERY_LENGTH} aria-invalid={invalidSearch || undefined}
            aria-describedby={invalidSearch ? "inventory-search-help inventory-search-error" : "inventory-search-help"} />
        </label>
        <button type="submit" className="primary-button">Search titles</button>
        {query || error ? <Link className="secondary-button" href="/listings" prefetch={false}>Clear search</Link> : null}
      </Form>
      <p id="inventory-search-help">Matches text anywhere in a title, ignoring case. Up to 100 characters.</p>
      {error ? <p role="alert" id="inventory-search-error">{error} {retryHref ? <a href={retryHref}>Try again</a> : null}</p> : null}

      {inventory ? <>
        {inventory.matchingCount === 0 ? (
          <p className="empty-state">{query ? <>No saved listings match “{query}”. Clear the search or try another title.</>
            : "Your saved listings will appear here with status and age."}</p>
        ) : <>
          <p role="status">Showing {first}–{last} of {inventory.matchingCount} {query ? "matching listings" : "saved listings"}.</p>
          <div className="dashboard-list">
            {inventory.items.map(listing => <article className="listing-card" key={listing.id}>
              <div className="listing-card-header">
                <h3><Link prefetch={false} href={`/listings/${encodeURIComponent(listing.id)}`}>{listing.title}</Link></h3>
                <span className={`status-pill status-${listing.status}`}>{listing.status}</span>
              </div>
              <p>${listing.askingPrice.amount.toFixed(2)}</p>
              <p>{listing.categoryLabel} · {listing.condition || "No Condition"}</p>
              <p>{getListingAgeLabel(listing.createdAt)}</p>
              <div className="listing-card-actions">
                <Link className="secondary-button" prefetch={false} href={`/listings/${encodeURIComponent(listing.id)}/edit`}>Edit</Link>
                <DeleteListingButton id={listing.id} stayOnPage />
              </div>
            </article>)}
          </div>
          <nav className="inventory-pagination" aria-label="Inventory pages">
            {inventory.page > 1 ? <Link className="secondary-button" prefetch={false} href={inventoryHref(query, inventory.page - 1)} aria-label="Previous inventory page">Previous</Link>
              : <span className="secondary-button" aria-disabled="true">Previous</span>}
            <span aria-current="page">Page {inventory.page} of {inventory.totalPages}</span>
            {inventory.page < inventory.totalPages ? <Link className="secondary-button" prefetch={false} href={inventoryHref(query, inventory.page + 1)} aria-label="Next inventory page">Next</Link>
              : <span className="secondary-button" aria-disabled="true">Next</span>}
          </nav>
        </>}
      </> : null}
    </section>
  );
}
