import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { LEGACY_OWNER_ID, ownerIdSchema } from "../../application/owner";

// Offline migration tool ONLY. Never expose this through the application service
// or an HTTP/server action. Requires trusted operator database credentials.
export async function claimLegacyListings(db: NodePgDatabase<typeof schema>, ownerId: string) {
  ownerIdSchema.parse(ownerId);
  return db.transaction(async tx => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, ownerId)).for("update");
    const [account] = await tx.select({ id: schema.accounts.id }).from(schema.accounts)
      .where(and(eq(schema.accounts.userId, ownerId), eq(schema.accounts.providerId, "github")));
    if (!user || !account) throw new Error("Target must be an existing GitHub-authenticated internal user.");
    const rows = await tx.update(schema.listings).set({ ownerId, updatedAt: new Date().toISOString() })
      .where(eq(schema.listings.ownerId, LEGACY_OWNER_ID)).returning({ id: schema.listings.id });
    return rows.length;
  });
}
