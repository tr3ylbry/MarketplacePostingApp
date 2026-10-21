import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infrastructure/db/schema";
import { claimLegacyListings } from "../src/infrastructure/repositories/claimLegacyListings";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
const [flag, ownerId, confirm] = process.argv.slice(2);
if (process.argv.slice(2).length !== 3 || flag !== "--owner" || !ownerId || confirm !== "--confirm-all-legacy") {
  throw new Error("Usage: npm run db:claim-legacy -- --owner INTERNAL_USER_ID --confirm-all-legacy");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const count = await claimLegacyListings(drizzle(pool, { schema }), ownerId);
  console.log(`Claimed ${count} pre-auth listings. Existing owned listings were not changed.`);
} catch {
  console.error("Claim failed; no changes committed. Verify the target GitHub-backed internal user and database configuration.");
  process.exitCode = 1;
} finally { await pool.end(); }
