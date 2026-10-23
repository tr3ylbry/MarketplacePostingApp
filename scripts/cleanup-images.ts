import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infrastructure/db/schema";
import { cleanupImages } from "../src/infrastructure/storage/cleanupImages";
import { VercelBlobImageStorage } from "../src/infrastructure/storage/vercelBlobImageStorage";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  const result = await cleanupImages(drizzle(pool, { schema }), new VercelBlobImageStorage());
  console.log(`Image cleanup: ${result.removed} removed, ${result.failed} deferred. Batch limit: 100.`);
  if (result.failed) process.exitCode = 1;
} catch { console.error("Image cleanup unavailable; check server configuration."); process.exitCode = 1; }
finally { await pool.end(); }
