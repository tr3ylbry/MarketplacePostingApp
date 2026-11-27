import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../infrastructure/db/schema";

// No dotenv/private configuration or development fallback. Tests supply only a
// synthetic URL inside their isolated network namespace.
export async function disposableVerificationDatabase(migrationsFolder = "drizzle") {
  const parent = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(parent.protocol) || !["127.0.0.1", "localhost"].includes(parent.hostname) ||
    !/^\/[a-z][a-z0-9_]*_test$/.test(parent.pathname) || parent.search || parent.hash) throw new Error("Isolated test database required.");
  const name = "marketplace_verification_" + randomBytes(12).toString("hex") + "_test";
  const admin = new Pool({ connectionString: parent.toString(), max: 1 });
  const actual = await admin.query("SELECT current_database() AS name");
  if (actual.rows[0]?.name !== parent.pathname.slice(1)) { await admin.end(); throw new Error("Test database identity mismatch."); }
  await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0');
  const target = new URL(parent); target.pathname = "/" + name;
  const pool = new Pool({ connectionString: target.toString(), max: 12 }), db = drizzle(pool, { schema });
  async function close() { await pool.end(); await admin.query('DROP DATABASE "' + name + '"'); await admin.end(); }
  try { await migrate(db, { migrationsFolder }); }
  catch (error) { await close(); throw error; }
  return { db, pool, close, name };
}
