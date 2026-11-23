import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { localDatabase } from "./local-session";
import type * as schema from "../src/infrastructure/db/schema";
import { OPERATOR_ROOT } from "./reviewed-checkout";
import { resolve } from "node:path";

export class VerificationOperatorError extends Error {
  constructor(readonly code: "configuration" | "journal" | "context" | "busy" | "unavailable") { super("Diagnostic operator stopped."); }
}
export const verificationFixtureTitle = (digest: string) => `SANDBOX M3 Generated ${digest.slice(0,12)}`;

// No connection or private-file read: the caller supplies its explicit local
// environment. The shared parser rejects destination/file-option overrides.
export function assertVerificationDatabase(env: NodeJS.ProcessEnv, expected: string) {
  try {
    const url = localDatabase(env);
    if (decodeURIComponent(url.pathname.slice(1)) !== expected || process.versions.node.split(".")[0] !== "24") throw Error();
  } catch { throw new VerificationOperatorError("configuration"); }
}

// Inspection only. Do not migrate, fill gaps, reset the journal, or accept an
// extra row just because the most recent timestamp looks current.
export async function assertVerificationJournal(db: NodePgDatabase<typeof schema>, expected: string) {
  try {
    const identity = await db.execute(sql`SELECT current_database() AS name`);
    if (identity.rows[0]?.name !== expected) throw Error();
    const source = readMigrationFiles({ migrationsFolder: resolve(OPERATOR_ROOT,"drizzle") });
    const applied = await db.execute(sql`SELECT hash, created_at::text AS at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`);
    if (source.length !== 13 || applied.rows.length !== source.length || source.some((m,i) =>
      applied.rows[i].hash !== m.hash || applied.rows[i].at !== String(m.folderMillis))) throw Error();
  } catch { throw new VerificationOperatorError("journal"); }
}
