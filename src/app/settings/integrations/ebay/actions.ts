"use server";
import { requireEbaySession } from "../../../../auth/ebaySession";
import { ebayService } from "../../../../application/ebayServer";
import { safeEbayError } from "../../../../application/ebayConnection";
import { revalidatePath } from "next/cache";
export async function beginEbayAuthorization() {
  const session = await requireEbaySession();
  try { return { ok: true as const, url: await ebayService().begin(session.owner, session.sessionId) }; }
  catch (error) { return { ok: false as const, error: safeEbayError(error) }; }
}
export async function disconnectEbay() {
  const session = await requireEbaySession();
  try { await ebayService().disconnect(session.owner); revalidatePath("/settings/integrations/ebay"); return { ok: true as const }; }
  catch (error) { return { ok: false as const, error: safeEbayError(error) }; }
}
export async function renewEbayAuthorization() {
  const session = await requireEbaySession();
  try { await ebayService().accessToken(session.owner); revalidatePath("/settings/integrations/ebay"); return { ok: true as const }; }
  catch (error) { return { ok: false as const, error: safeEbayError(error) }; }
}
