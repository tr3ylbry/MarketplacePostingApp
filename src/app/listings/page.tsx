import Link from "next/link";
import { listingService } from "../../application/server";
import { ListingDashboard } from "../../features/listings/components/ListingDashboard";
import { ImportLocalListings } from "../../features/listings/components/ImportLocalListings";
import { requireUser } from "../../auth/session";
import { redirect } from "next/navigation";
import { inventoryHref, isCanonicalInventoryLocation, readInventoryLocation, type InventorySearchParams } from "../../features/listings/inventoryNavigation";
import type { InventoryPage } from "../../application/inventory";

export const dynamic = "force-dynamic";
export default async function ListingsPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const request = readInventoryLocation(params);
  let inventory: InventoryPage | undefined;
  let error = request.error;
  let retryHref: string | undefined;
  if (!error) {
    // Redirect outside the database error handler so Next's control flow propagates.
    if (!isCanonicalInventoryLocation(params, request.query, request.page)) redirect(inventoryHref(request.query, request.page));
    try { inventory = await listingService().listInventory(user.id, { query: request.query, page: request.page }); }
    catch {
      error = "Saved inventory could not be loaded. Try again or clear the search.";
      retryHref = inventoryHref(request.query, request.page);
    }
    if (inventory && inventory.page !== request.page) redirect(inventoryHref(request.query, inventory.page));
  }
  return <section className="panel-stack">
    <div className="panel panel-stack"><Link className="primary-button" href="/listings/new">Create New Listing</Link><ImportLocalListings /></div>
    <ListingDashboard inventory={inventory} query={request.query} error={error} invalidSearch={!!request.error} retryHref={retryHref} />
  </section>;
}
