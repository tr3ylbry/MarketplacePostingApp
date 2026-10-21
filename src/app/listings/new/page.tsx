import { ListingEditor } from "../../../features/listings/components/ListingEditor";
import { requireUser } from "../../../auth/session";
export default async function NewListingPage() { await requireUser(); return <ListingEditor initialListing={null} />; }
