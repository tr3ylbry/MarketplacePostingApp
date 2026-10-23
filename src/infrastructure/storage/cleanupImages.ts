import { and, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CLEANUP_GRACE_MS, type ImageStorage } from "../../application/imageStorage";
import * as schema from "../db/schema";

// Explicit bounded operator command, not an application route or background job.
export async function cleanupImages(db: NodePgDatabase<typeof schema>, storage: ImageStorage) {
  const { imageCleanup, imageUploads, listingImages } = schema;
  const due = await db.select().from(imageCleanup).where(lte(imageCleanup.notBefore, new Date().toISOString())).limit(100);
  let removed = 0, failed = 0;
  for (const entry of due) {
    try {
      const lease = await db.transaction(async tx => {
        const [locked] = await tx.select().from(imageCleanup).where(and(eq(imageCleanup.pathname, entry.pathname), lte(imageCleanup.notBefore, new Date().toISOString()))).for("update");
        if (!locked) return null;
        const [saved] = await tx.select({ id: listingImages.id }).from(listingImages).where(eq(listingImages.pathname, entry.pathname));
        if (saved) return null; // Never delete an object referenced by committed metadata.
        const [pending] = await tx.select().from(imageUploads).where(eq(imageUploads.pathname, locked.pathname));
        // A lease is only safe once finalization is impossible. Recheck the
        // reservation independently of the ledger's due timestamp.
        if (pending && Date.parse(pending.expiresAt) + CLEANUP_GRACE_MS > Date.now()) return null;
        const notBefore = new Date(Date.now() + CLEANUP_GRACE_MS).toISOString();
        await tx.update(imageCleanup).set({ notBefore }).where(eq(imageCleanup.pathname, locked.pathname));
        return { pathname: locked.pathname, notBefore };
      });
      if (!lease) continue;
      // Provider latency holds neither a transaction nor a database connection.
      // Failure leaves the lease in place; it becomes eligible for a later retry.
      await storage.deleteObject(lease.pathname);
      const cleaned = await db.transaction(async tx => {
        const [locked] = await tx.select().from(imageCleanup).where(and(eq(imageCleanup.pathname, lease.pathname), eq(imageCleanup.notBefore, lease.notBefore))).for("update");
        if (!locked) return false; // Another worker/requeue now owns this entry.
        const [saved] = await tx.select({ id: listingImages.id }).from(listingImages).where(eq(listingImages.pathname, lease.pathname));
        if (saved) return false;
        const [pending] = await tx.select().from(imageUploads).where(eq(imageUploads.pathname, lease.pathname));
        if (pending && Date.parse(pending.expiresAt) + CLEANUP_GRACE_MS > Date.now()) return false;
        await tx.delete(imageUploads).where(and(eq(imageUploads.pathname, lease.pathname), lte(imageUploads.expiresAt, new Date().toISOString())));
        await tx.delete(imageCleanup).where(and(eq(imageCleanup.pathname, lease.pathname), eq(imageCleanup.notBefore, lease.notBefore)));
        return true;
      });
      if (cleaned) removed++;
    } catch { failed++; }
  }
  return { removed, failed };
}
