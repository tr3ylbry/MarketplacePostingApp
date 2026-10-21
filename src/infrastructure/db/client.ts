import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globalDb = globalThis as typeof globalThis & { marketplacePool?: Pool };
export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const pool = globalDb.marketplacePool ?? new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  globalDb.marketplacePool = pool;
  return drizzle(pool, { schema });
}
