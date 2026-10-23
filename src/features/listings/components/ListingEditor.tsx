"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Listing, PlatformSiteKey } from "../../../domain/listing";
import { createListingAction, updateListingAction, deleteListingAction } from "../../../app/listings/actions";
import { ListingForm } from "./ListingForm";
import { MarketplacePicker } from "./MarketplacePicker";
import { toDomainInput } from "../listingFormMapping";
import type { CreateListingInput } from "../listingFormInput";
import { ImageGallery } from "./ImageGallery";

export function ListingEditor({ initialListing }: { initialListing: Listing | null }) {
  const router = useRouter();
  const [listing, setListing] = useState(initialListing);
  const [platforms, setPlatforms] = useState<PlatformSiteKey[]>(initialListing?.selectedPlatforms ?? []);
  const [choosing, setChoosing] = useState(!initialListing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(input: CreateListingInput, exit = false) {
    setPending(true); setError(null);
    try {
      const payload = { ...toDomainInput(input), imageNames: input.imageNames };
      const result = listing ? await updateListingAction(listing.id, payload, listing.updatedAt) : await createListingAction(payload);
      if (!result.ok) { setError(result.error); return false; }
      setListing(result.data);
      if (exit) router.push("/listings");
      else if (!listing) router.replace(`/listings/${encodeURIComponent(result.data.id)}/edit`);
      return true;
    } catch { setError("Could not save the listing. Your edits are still here; try again."); return false; }
    finally { setPending(false); }
  }
  async function remove(id: string) {
    if (!window.confirm("Are you sure you want to delete this listing?")) return;
    setPending(true); setError(null);
    try {
      const result = await deleteListingAction(id);
      if (!result.ok) { setError(result.error); return; }
      router.push("/listings"); router.refresh();
    } catch { setError("Could not delete the listing. Try again."); }
    finally { setPending(false); }
  }
  if (choosing) return <MarketplacePicker selectedPlatforms={platforms} onToggle={platform => setPlatforms(current => current.includes(platform) ? current.filter(value => value !== platform) : [...current, platform])} onContinue={() => setChoosing(false)} />;
  return <>
    {error ? <p role="alert">{error}</p> : null}
    {pending ? <p role="status">Saving changes…</p> : null}
    <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <ListingForm listing={listing} mode={listing ? "edit" : "create"} initialSelectedPlatforms={platforms} hasSavedListings
        onCreate={input => save(input)} onUpdate={(_id, input) => save(input)}
        onCreateAndExit={input => save(input, true)} onDelete={remove}
        onContinueToPreview={() => { if (listing) router.push(`/listings/${encodeURIComponent(listing.id)}`); }}
        onExitToHome={() => router.push("/listings")} onOpenManage={() => router.push("/listings")} onStartCreate={() => router.push("/listings/new")} />
    </fieldset>
    {listing ? <ImageGallery listing={listing} onChange={setListing} disabled={pending} /> : null}
  </>;
}
