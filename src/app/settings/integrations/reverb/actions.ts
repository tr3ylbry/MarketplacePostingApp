"use server";
import { requireUser } from "../../../../auth/session";
import { reverbService } from "../../../../application/reverbServer";
import { safeReverbError } from "../../../../application/reverbService";
import { revalidatePath } from "next/cache";
async function perform<T>(operation: (owner: string) => Promise<T>) {
  const user = await requireUser();
  try { const data = await operation(user.id); revalidatePath("/listings", "layout"); revalidatePath("/settings/integrations/reverb"); return { ok: true as const, data }; }
  catch (error) { return { ok: false as const, error: safeReverbError(error) }; }
}
export async function connectReverb(token: unknown) { return perform(owner => reverbService().connect(owner, token)); }
export async function disconnectReverb() { return perform(owner => reverbService().disconnect(owner)); }
export async function prepareReverb(id: string, selection: unknown) { return perform(owner => reverbService().prepare(owner, id, selection)); }
export async function createReverbDraft(reviewId: string) { return perform(owner => reverbService().createDraft(owner, reviewId)); }
export async function loadReverbOptions(id: string) { return perform(owner => reverbService().options(owner, id)); }
export async function refreshReverbStatus(id: string) { return perform(owner => reverbService().refresh(owner, id)); }
export async function deleteReverbDraft(id: string) { return perform(owner => reverbService().deleteDraft(owner, id)); }
