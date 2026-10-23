import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "../../../../auth/session";
import { listingService } from "../../../../application/server";
import { reverbService } from "../../../../application/reverbServer";
import { safeReverbError } from "../../../../application/reverbService";
import { ReverbDraftForm } from "../../../../features/reverb/ReverbDraftForm";
export const dynamic = "force-dynamic";
export default async function ReverbDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const user = await requireUser();
  if (!await listingService().getListing(user.id, id)) notFound();
  try { const options = await reverbService().options(user.id, id); return <ReverbDraftForm listingId={id} options={options} />; }
  catch (error) { return <section className="panel"><h2>Prepare Reverb Draft</h2><p role="alert">{safeReverbError(error)}</p><Link href="/settings/integrations/reverb">Reverb connection settings</Link></section>; }
}
