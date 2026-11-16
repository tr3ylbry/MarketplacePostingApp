import { z } from "zod";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { RealMediaError, realMediaDigest, mediaId } from "../../application/ebayRealMedia";

export const SYNTHETIC_MEDIA_CONTRACT = "synthetic-real-media-v1";
export const disposableMediaDatabaseName = /^marketplace_real_media_[a-f0-9]{24}_test$/;
export interface MediaReceiptFields {
  contractVersion: typeof SYNTHETIC_MEDIA_CONTRACT; fingerprint: string; level: "partial" | "complete" | "conflict";
  resourceId: string | null; location: string | null; imageUrl: string | null; maximumUrl: string | null;
  expiresAt: string | null; responseStatus: number | null;
}
const issued = new WeakMap<object, { database: string; owner: string; attempt: string; fields: Readonly<MediaReceiptFields> }>();
const url = z.string().regex(/^https:\/\/eps-contract\.invalid\.test\/photo\/test_visual_[a-f0-9]{16}\.png$/);
const location = z.string().regex(/^https:\/\/media-contract\.invalid\.test\/image\/test_resource_[a-f0-9]{16}$/);
const body = z.strictObject({ imageUrl: z.unknown().optional(), expirationDate: z.unknown().optional(), maxDimensionImageUrl: z.unknown().optional() });
const response = z.strictObject({ status: z.number().int().min(100).max(599).nullable(), location: z.unknown().optional(), body: z.unknown().optional() });
const field = (s: z.ZodType<string>, v: unknown) => { const r = s.safeParse(v); return r.success ? r.data : null; };

// No real URL contract exists. This is not a permissive generic parser.
export function admitRealMediaEvidence(_value: unknown): never { void _value; throw new RealMediaError("contract"); }
export function parseSyntheticMediaReceipt(value: unknown): Readonly<MediaReceiptFields> {
  try {
    const raw = response.parse(value), parsed = body.safeParse(raw.body);
    const object = parsed.success ? parsed.data : null;
    const loc = field(location, raw.location), image = field(url, object?.imageUrl);
    const maximum = field(url, object?.maxDimensionImageUrl);
    const date = field(z.iso.datetime({ offset: true }).max(64), object?.expirationDate);
    const conflict = Array.isArray(raw.location);
    const fields = { contractVersion: SYNTHETIC_MEDIA_CONTRACT as typeof SYNTHETIC_MEDIA_CONTRACT,
      level: conflict ? "conflict" as const : raw.status === 201 && loc && image && date &&
        (object?.maxDimensionImageUrl === undefined || maximum) ? "complete" as const : "partial" as const,
      resourceId: loc?.slice(loc.lastIndexOf("/") + 1) ?? null, location: loc, imageUrl: image, maximumUrl: maximum,
      expiresAt: date ? new Date(date).toISOString() : null, responseStatus: raw.status };
    return Object.freeze({ ...fields, fingerprint: realMediaDigest(JSON.stringify(fields)) });
  } catch { throw new RealMediaError("contract"); }
}

// Test-only proof issuance is bound to the actual disposable DB, not a flag or
// caller-controlled validated boolean. No schema/URL from the simulation is reused.
export async function syntheticMediaEvidence(db: NodePgDatabase<typeof schema>, owner: string, attempt: string, value: unknown): Promise<object> {
  mediaId.parse(owner); mediaId.parse(attempt);
  if (process.env.NODE_ENV !== "test" || process.env.VERCEL) throw new RealMediaError("contract");
  const result = await db.execute(sql`SELECT current_database() AS name`), database = String(result.rows[0]?.name);
  if (!disposableMediaDatabaseName.test(database)) throw new RealMediaError("contract");
  const proof = Object.freeze({}), fields = parseSyntheticMediaReceipt(value);
  issued.set(proof, { database, owner, attempt, fields }); return proof;
}
export function admittedMediaReceipt(proof: unknown, database: string, owner: string, attempt: string): Readonly<MediaReceiptFields> {
  const value = proof && typeof proof === "object" ? issued.get(proof) : undefined;
  if (process.env.NODE_ENV !== "test" || process.env.VERCEL || !disposableMediaDatabaseName.test(database) ||
    !value || value.database !== database || value.owner !== owner || value.attempt !== attempt) throw new RealMediaError("contract");
  return value.fields;
}
