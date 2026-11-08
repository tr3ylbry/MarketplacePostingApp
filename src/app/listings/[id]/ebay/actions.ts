"use server";
import { requireUser } from "../../../../auth/session";
import { ebayPreparationService } from "../../../../application/ebayPreparationServer";
import { EbayMetadataError } from "../../../../application/ebayMetadata";
import { safeEbayError } from "../../../../application/ebayConnection";

const safeError = (error: unknown) => error instanceof EbayMetadataError ? error.message : safeEbayError(error);
export async function loadEbayMetadataAction(id: string, version: string, categoryId?: string) {
  const user = await requireUser();
  try { return { ok: true as const, data: await ebayPreparationService().load(user.id, id, version, categoryId) }; }
  catch (error) { return { ok: false as const, error: safeError(error) }; }
}
export async function reviewEbayPreparationAction(id: string, version: string, selection: unknown) {
  const user = await requireUser();
  try { return { ok: true as const, data: await ebayPreparationService().review(user.id, id, version, selection) }; }
  catch (error) { return { ok: false as const, error: safeError(error) }; }
}
