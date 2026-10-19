import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

export const migration = "202610150001_phase1_ledger";
export const demoBusiness = "d3e00000-0000-4000-8000-000000000001";
export const demoUser = "d3e00000-0000-4000-8000-000000000002";
export const demoPhone = "vendora-phase1-demo-not-a-phone";

export async function connectDemo() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL is required");
  const parsed = new URL(url);
  if (process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/_(demo|test)$/.test(parsed.pathname)) {
    throw new Error("Phase 1 tooling requires a local *_demo or *_test database outside production");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function down(client: Client, schema = "public") {
  const history = `"${schema.replace(/"/g, '""')}"."_prisma_migrations"`;
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(150001)");
    const later = await client.query(
      `SELECT migration_name FROM ${history} WHERE migration_name > $1 AND rolled_back_at IS NULL`,
      [migration],
    );
    if (later.rowCount) throw new Error("Undo later migrations first");
    await client.query(readFileSync(resolve("prisma/rollback/phase1.sql"), "utf8"));
    await client.query(`DELETE FROM ${history} WHERE migration_name = $1`, [migration]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
