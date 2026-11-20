import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { captureReportSchema } from "../../application/ebayCaptureReport";
import { RealMediaError, realMediaDigest, type RealMediaClaim } from "../../application/ebayRealMedia";
import * as schema from "../db/schema";

// Capture history is deliberately NOT a real/synthetic receipt or association.
export class DrizzleMediaCaptureRepository {
  constructor(private readonly db:NodePgDatabase<typeof schema>) {}
  async authorize(claim:RealMediaClaim):Promise<void> {
    try {await this.db.transaction(async tx=>{
      const r=await tx.execute(sql`SELECT public.capture_media_authorize(${claim.id},${claim.ownerId},${realMediaDigest(claim.token)},${claim.revision}) FROM public.ebay_real_media_attempts WHERE id=${claim.id} AND owner_id=${claim.ownerId} AND state='unknown' AND post_intent_at IS NOT NULL`);
      if(r.rows.length!==1)throw new RealMediaError("stale");
    });}
    catch {throw new RealMediaError("stale");}
  }
  async time():Promise<string> {const r=await this.db.execute(sql`SELECT clock_timestamp() AS at`);return new Date(r.rows[0].at as string).toISOString();}
  async record(claim:RealMediaClaim,raw:unknown):Promise<void> {
    try {
      if(!Number.isSafeInteger(claim.revision)||claim.revision<0)throw new RealMediaError("stale");
      const report=captureReportSchema.parse(raw);
      if(Buffer.byteLength(JSON.stringify(report))>8192)throw new RealMediaError("contract");
      await this.db.transaction(async tx=>{
        const [row]=await tx.select().from(schema.ebayRealMediaAttempts).where(and(eq(schema.ebayRealMediaAttempts.id,claim.id),eq(schema.ebayRealMediaAttempts.ownerId,claim.ownerId))).for("update");
        if(!row||row.operation!=="capture-only"||!row.postIntentAt||row.claimHash!==realMediaDigest(claim.token)||row.sessionHash!==claim.sessionHash||row.actionHash!==claim.actionHash||claim.revision>row.revision)throw new RealMediaError("stale");
        await tx.insert(schema.ebayMediaCaptures).values({id:randomUUID(),attemptId:row.id,report,fingerprint:realMediaDigest("pending")}).onConflictDoNothing();
      });
    }catch {throw new RealMediaError("unavailable");}
  }
}
