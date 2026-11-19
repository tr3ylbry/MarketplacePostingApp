import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./testDatabase";
import * as schema from "../infrastructure/db/schema";

// Dedicated database per suite. Never disable immutable-history triggers for
// teardown, reuse development data, or enable synthetic real-media admission.
export async function disposableInventoryDatabase() {
  const parent = new URL(testDatabaseUrl());
  if (!["127.0.0.1", "localhost"].includes(parent.hostname) || !parent.pathname.endsWith("_test")) throw new Error("Disposable local test database required.");
  const name = "marketplace_inventory_" + randomBytes(12).toString("hex") + "_test";
  const admin = new Pool({ connectionString: parent.toString(), max: 1 });
  const actual = await admin.query("SELECT current_database() AS name");
  if (actual.rows[0].name !== decodeURIComponent(parent.pathname.slice(1))) { await admin.end(); throw new Error("Test database identity mismatch."); }
  await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0');
  const target = new URL(parent); target.pathname = "/" + name;
  const pool = new Pool({ connectionString: target.toString(), max: 8 }), db = drizzle(pool, { schema });
  async function close() { await pool.end(); await admin.query('DROP DATABASE "' + name + '"'); await admin.end(); }
  try { await migrate(db, { migrationsFolder: "drizzle" }); }
  catch (error) { await close(); throw error; }
  return { db, pool, close };
}
