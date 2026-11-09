import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import * as schema from "../db/schema";
import { ebayConnections as connections, ebayOauthStates as states } from "../db/ebaySchema";
import { EBAY_SCOPES, validEbayScopes, EbayError, type ConnectedValues, type EbayConnectionRepository } from "../../application/ebayConnection";
const owned = (owner: string) => and(eq(connections.ownerId, owner), eq(connections.environment, "sandbox"));
const mapped = (row: typeof connections.$inferSelect) => ({ ...row,
  accessExpiresAt: row.accessExpiresAt ? new Date(row.accessExpiresAt).toISOString() : null,
  refreshExpiresAt: row.refreshExpiresAt ? new Date(row.refreshExpiresAt).toISOString() : null,
  connectedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null,
  leaseUntil: row.leaseUntil ? new Date(row.leaseUntil).toISOString() : null,
});
export class DrizzleEbayConnectionRepository implements EbayConnectionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async connection(owner: string) { const [row] = await this.db.select().from(connections).where(owned(owner)); return row ? mapped(row) : null; }
  async begin(owner: string, sessionHash: string, configHash: string, hash: string, now: string, expiresAt: string, requestedScopes: readonly string[] = EBAY_SCOPES) {
    if (!validEbayScopes(requestedScopes)) throw new EbayError("scopes");
    await this.db.transaction(async tx => {
      await tx.insert(connections).values({ ownerId: owner, id: randomUUID(), version: randomUUID(), configHash }).onConflictDoNothing();
      const [current] = await tx.select().from(connections).where(owned(owner)).for("update");
      const version = randomUUID();
      await tx.update(connections).set({ version, configHash, leaseToken: null, leaseUntil: null,
        ...(current.configHash !== configHash ? { status: "reconnect", access: null, refresh: null } : {}) }).where(owned(owner));
      await tx.delete(states).where(or(eq(states.ownerId, owner), lt(states.expiresAt, now)));
      await tx.insert(states).values({ hash, ownerId: owner, sessionHash, configHash, connectionVersion: version, expiresAt, requestedScopes: [...requestedScopes] });
    });
  }
  async consume(owner: string, sessionHash: string, configHash: string, hash: string, now: string) {
    return this.db.transaction(async tx => {
      const [connection] = await tx.select().from(connections).where(owned(owner)).for("update");
      if (!connection || connection.configHash !== configHash) throw new EbayError("state");
      const consumed = await tx.update(states).set({ consumedAt: now }).where(and(eq(states.hash, hash), eq(states.ownerId, owner), eq(states.sessionHash, sessionHash), eq(states.configHash, configHash), eq(states.connectionVersion, connection.version), isNull(states.consumedAt), gt(states.expiresAt, now))).returning();
      if (!consumed.length) throw new EbayError("state");
      return { ...mapped(connection), requestedScopes: consumed[0].requestedScopes };
    });
  }
  async connect(owner: string, version: string, values: ConnectedValues, now: string) {
    try {
      const rows = await this.db.update(connections).set({ ...values, status: "connected", version: randomUUID(), connectedAt: now, leaseToken: null, leaseUntil: null }).where(and(owned(owner), eq(connections.version, version), or(isNull(connections.sellerId), eq(connections.sellerId, values.sellerId!)))).returning();
      if (!rows.length) throw new EbayError("conflict");
    } catch { throw new EbayError("conflict"); }
  }
  async disconnect(owner: string) {
    await this.db.transaction(async tx => {
      await tx.select().from(connections).where(owned(owner)).for("update");
      await tx.update(connections).set({ status: "disconnected", version: randomUUID(), sellerId: null, sellerLabel: null, access: null, refresh: null, accessExpiresAt: null, refreshExpiresAt: null, scopes: [], connectedAt: null, leaseToken: null, leaseUntil: null }).where(owned(owner));
      await tx.delete(states).where(eq(states.ownerId, owner));
    });
  }
  async claim(owner: string, version: string, leaseToken: string, now: string, leaseUntil: string) {
    const [row] = await this.db.update(connections).set({ leaseToken, leaseUntil }).where(and(owned(owner), eq(connections.version, version), eq(connections.status, "connected"), or(isNull(connections.leaseUntil), lt(connections.leaseUntil, now)))).returning();
    if (!row) throw new EbayError("conflict"); return mapped(row);
  }
  async finish(owner: string, version: string, lease: string, values: ConnectedValues, now: string) {
    const rows = await this.db.update(connections).set({ ...values, version: randomUUID(), leaseToken: null, leaseUntil: null }).where(and(owned(owner), eq(connections.version, version), eq(connections.leaseToken, lease), gt(connections.leaseUntil, now), eq(connections.status, "connected"), eq(connections.sellerId, values.sellerId!))).returning();
    if (!rows.length) throw new EbayError("conflict");
    return mapped(rows[0]);
  }
  async invalidate(owner: string, version: string, status: "reconnect" | "identity-unverified", lease?: string) {
    await this.db.update(connections).set({ status, version: randomUUID(), access: null, refresh: null, leaseToken: null, leaseUntil: null }).where(and(owned(owner), eq(connections.version, version), lease ? eq(connections.leaseToken, lease) : undefined));
  }
}
