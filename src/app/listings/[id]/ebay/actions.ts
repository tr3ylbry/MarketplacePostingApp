"use server";
import { requireUser } from "../../../../auth/session";
import { ebayPreparationService } from "../../../../application/ebayPreparationServer";
import { EbayMetadataError } from "../../../../application/ebayMetadata";
import { safeEbayError } from "../../../../application/ebayConnection";
import { ebaySellerReadiness } from "../../../../application/ebayReadinessServer";
import { EbayReadinessError } from "../../../../application/ebayReadiness";
import { ebayPrivateImages } from "../../../../application/ebayPrivateImageServer";
import { PrivateImagePreparationError } from "../../../../application/ebayPrivateImages";

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
export async function checkEbayReadinessAction(id: string, version: string) {
  const user = await requireUser();
  try { return { ok: true as const, data: await ebaySellerReadiness().check(user.id, id, version) }; }
  catch (error) { return { ok: false as const, error: error instanceof EbayReadinessError ? error.message : safeEbayError(error) }; }
}
export async function prepareEbayPrivateImageAction(id: string, version: string, imageId: string) {
  const user = await requireUser();
  try { return { ok: true as const, data: await ebayPrivateImages().prepare(user.id, id, version, imageId) }; }
  catch (error) { return { ok: false as const, error: error instanceof PrivateImagePreparationError ? error.message : "Private photo preparation could not be completed." }; }
}
