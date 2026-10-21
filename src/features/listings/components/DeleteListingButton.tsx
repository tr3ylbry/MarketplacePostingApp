"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteListingAction } from "../../../app/listings/actions";

export function DeleteListingButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!window.confirm("Are you sure you want to delete this listing?")) return;
    setPending(true); setError(null);
    try {
      const result = await deleteListingAction(id);
      if (!result.ok) { setError(result.error); return; }
      router.push("/listings"); router.refresh();
    } catch { setError("Could not delete the listing. Try again."); }
    finally { setPending(false); }
  }
  return <><button className="danger-button" type="button" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Delete"}</button>{error ? <p role="alert">{error}</p> : null}</>;
}
