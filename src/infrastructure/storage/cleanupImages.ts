import { and, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ImageStorage } from "../../application/imageStorage";
import * as schema from "../db/schema";

// Explicit bounded operator command, not an application route or background job.
export async function cleanupImages(db: NodePgDatabase<typeof schema>, storage: ImageStorage) {
  const { imageCleanup, imageUploads, listingImages } = schema;
  const due = await db.select().from(imageCleanup).where(lte(imageCleanup.notBefore, new Date().toISOString())).limit(100);
  let removed = 0, failed = 0;
  for (const entry of due) {
    try {
      const cleaned = await db.transaction(async tx => {
        const [locked] = await tx.select().from(imageCleanup).where(and(eq(imageCleanup.pathname, entry.pathname), lte(imageCleanup.notBefore, new Date().toISOString()))).for("update");
        if (!locked) return false;
        const [saved] = await tx.select({ id: listingImages.id }).from(listingImages).where(eq(listingImages.pathname, entry.pathname));
        if (saved) return false; // Defensive: never delete an object referenced by committed metadata.
        await storage.deleteObject(locked.pathname);
        await tx.delete(imageUploads).where(eq(imageUploads.pathname, locked.pathname));
        await tx.delete(imageCleanup).where(eq(imageCleanup.pathname, locked.pathname));
        return true;
      });
      if (cleaned) removed++;
    } catch { failed++; }
  }
  return { removed, failed };
}
