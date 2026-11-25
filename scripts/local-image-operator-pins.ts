import { LocalOperatorError } from "../src/application/localImageOperator";
import type { LocalImageOperatorActivation } from "../src/infrastructure/repositories/drizzleLocalImageOperatorRepository";
import type { VerificationPins } from "./image-verification-options";

type PinSource = Pick<LocalImageOperatorActivation, "reviewedHead" | "listingId" | "imageId" | "listingVersion" | "sellerKey" | "connectedVersion" | "sourceDigest" | "derivativeDigest">;

function listingVersionPin(raw: string): string {
  // Listings store milliseconds. The activation preserves PostgreSQL's text
  // timestamp(6), so normalize representation here without discarding precision.
  // This is not an authorization clock and must never normalize other deadlines.
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(raw);
  if (!match || match[0] !== raw || /[1-9]/.test((match[3] ?? "").slice(3))) throw new LocalOperatorError("context");
  const wall = `${match[1]}T${match[2]}.${(match[3] ?? "").slice(0, 3).padEnd(3, "0")}`;
  const calendar = new Date(wall + "Z");
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString() !== wall + "Z") throw new LocalOperatorError("context");
  let zone = match[4];
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", ""), hour = Number(digits.slice(0, 2)), minute = Number(digits.slice(2) || "0");
    if (hour > 23 || minute > 59) throw new LocalOperatorError("context");
    zone = `${zone[0]}${digits.slice(0, 2)}:${String(minute).padStart(2, "0")}`;
  }
  const value = new Date(wall + zone);
  if (!Number.isFinite(value.getTime())) throw new LocalOperatorError("context");
  const canonical = value.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)) throw new LocalOperatorError("context");
  return canonical;
}

// Internal DTO boundary only; this grants no authentication or send authority.
export function localOperatorVerificationPins(row: PinSource, database: string): VerificationPins {
  if (!row.listingId || !row.imageId || !row.listingVersion || !row.connectedVersion || !row.sourceDigest || !row.derivativeDigest) throw new LocalOperatorError("context");
  return { head: row.reviewedHead, database, listing: row.listingId, image: row.imageId, listingVersion: listingVersionPin(row.listingVersion),
    seller: row.sellerKey, connectionVersion: row.connectedVersion, sourceDigest: row.sourceDigest, derivativeDigest: row.derivativeDigest };
}
