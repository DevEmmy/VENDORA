import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Client } from "pg";
import { migrateTestDatabase, serverRoot, startTestDatabase } from "../support/database";

const migration = "202610170001_inventory_foundation";

async function legacyMigrations(url: string) {
  const output = resolve(serverRoot, "test-results");
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(output, "schema-baseline-"));
  const migrations = join(directory, "migrations");
  mkdirSync(migrations);
  for (const name of readdirSync(resolve(serverRoot, "prisma/migrations"))) {
    if (name === "migration_lock.toml" || name < migration) {
      cpSync(resolve(serverRoot, "prisma/migrations", name), join(migrations, name), { recursive: true });
    }
  }
  const config = join(directory, "prisma.config.ts");
  writeFileSync(config, `import {defineConfig} from 'prisma/config';
export default defineConfig({schema:${JSON.stringify(resolve(serverRoot, "prisma/schema.prisma"))},
migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.TEST_DATABASE_URL!}});`);
  await promisify(execFile)(process.execPath,
    [resolve(serverRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", config],
    { cwd: serverRoot, env: { ...process.env, NODE_ENV: "test", TEST_DATABASE_URL: url }, timeout: 120_000 });
}

async function assertDecimal(client: Client) {
  const result = await client.query<{ table_name: string; column_name: string; data_type: string;
    numeric_precision: number; numeric_scale: number }>(`
    SELECT table_name,column_name,data_type,numeric_precision,numeric_scale
    FROM information_schema.columns WHERE table_schema='vendora' AND
      ((table_name='products' AND column_name IN ('stock_qty','low_stock_at')) OR
       (table_name='sale_items' AND column_name='quantity')) ORDER BY table_name,column_name`);
  assert.equal(result.rows.length, 3);
  for (const column of result.rows) {
    assert.equal(column.data_type, "numeric", `${column.table_name}.${column.column_name}`);
    assert.equal(column.numeric_precision, 12);
    assert.equal(column.numeric_scale, 3);
  }
}

test("M3 migration supports fractions and preserves pre-existing snapshots", { timeout: 240_000 }, async t => {
  const database = await startTestDatabase();
  const client = new Client({ connectionString: database.url });
  let upgrade: Client | undefined;
  let unsafe: Client | undefined;
  try {
    await client.connect();
    await t.test("fresh database has Decimal(12,3) quantities", async () => { await assertDecimal(client); });
    await t.test("half a bag is stored exactly instead of rounding or rejecting it", async () => {
      const businessId = randomUUID();
      await client.query("INSERT INTO vendora.businesses(id,phone) VALUES ($1,$2)", [businessId, `fraction-${businessId}`]);
      const result = await client.query<{ stock_qty: string }>(
        "INSERT INTO vendora.products(id,business_id,name,unit_price,stock_qty) VALUES ($1,$2,'Rice',100000,$3) RETURNING stock_qty::text",
        [randomUUID(), businessId, "0.5"]);
      assert.equal(result.rows[0]?.stock_qty, "0.500");
    });
    await t.test("populated upgrade preserves snapshot JSON and existing integer ledger rows", async () => {
      await client.query("CREATE DATABASE vendora_upgrade_test");
      const url = new URL(database.url);
      url.pathname = "/vendora_upgrade_test";
      await legacyMigrations(url.href);
      upgrade = new Client({ connectionString: url.href });
      await upgrade.connect();
      const businessId = randomUUID();
      const state = { inventory: [{ id: "legacy-rice", name: "Rice", price: 1000, qty: 3.5 }],
        sales: [{ id: "legacy-sale", amount: 500, items: [{ productId: "legacy-rice", qty: 0.5 }] }] };
      await upgrade.query("INSERT INTO vendora.businesses(id,phone) VALUES ($1,$2)", [businessId, `upgrade-${businessId}`]);
      await upgrade.query('INSERT INTO vendora.business_snapshots("businessId",state,"updatedAt") VALUES ($1,$2,NOW())',
        [businessId, JSON.stringify(state)]);
      await upgrade.query("INSERT INTO vendora.products(id,business_id,name,unit_price,stock_qty) VALUES ($1,$2,'Existing stock',100000,7)",
        [randomUUID(), businessId]);
      const productId = (await upgrade.query<{ id: string }>("SELECT id FROM vendora.products WHERE business_id=$1", [businessId])).rows[0]!.id;
      const saleId = randomUUID();
      await upgrade.query("INSERT INTO vendora.sales(id,business_id,total,amount_paid) VALUES ($1,$2,200000,100000)", [saleId, businessId]);
      await upgrade.query("INSERT INTO vendora.sale_items(id,business_id,sale_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,2,100000)",
        [randomUUID(), businessId, saleId, productId]);
      await migrateTestDatabase(url.href);
      await migrateTestDatabase(url.href);
      const snapshot = await upgrade.query<{ state: unknown }>('SELECT state FROM vendora.business_snapshots WHERE "businessId"=$1', [businessId]);
      assert.deepEqual(snapshot.rows[0]?.state, state);
      await assertDecimal(upgrade);
      const product = await upgrade.query<{ qty: string }>("SELECT stock_qty::text AS qty FROM vendora.products WHERE business_id=$1", [businessId]);
      assert.equal(product.rows[0]?.qty, "7.000");
      const business = await upgrade.query<{ inventory_mode: string; sync_seq: string }>(
        "SELECT inventory_mode,sync_seq FROM vendora.businesses WHERE id=$1", [businessId]);
      assert.equal(business.rows[0]?.inventory_mode, "SNAPSHOT");
      assert.equal(business.rows[0]?.sync_seq, "0");
      assert.equal((await upgrade.query<{ qty: string }>("SELECT quantity::text AS qty FROM vendora.sale_items WHERE sale_id=$1", [saleId])).rows[0]?.qty, "2.000");
      assert.equal((await upgrade.query<{ total: string }>("SELECT total::text FROM vendora.sales WHERE id=$1", [saleId])).rows[0]?.total, "200000");
    });
    await t.test("idempotency keys are unique per business and movement/change ledgers cannot be rewritten", async () => {
      const businessId = randomUUID();
      const otherBusiness = randomUUID();
      const userId = randomUUID();
      const clientId = randomUUID();
      const productId = randomUUID();
      await client.query("INSERT INTO vendora.businesses(id,phone) VALUES ($1,$2),($3,$4)",
        [businessId, `ledger-${businessId}`, otherBusiness, `ledger-${otherBusiness}`]);
      await client.query('INSERT INTO vendora.users(id,phone,"passwordHash",status,"updatedAt") VALUES ($1,$2,\'!disabled\',\'disabled\',NOW())',
        [userId, `actor-${userId}`]);
      const insertProduct = (id: string, shop = businessId) => client.query(
        "INSERT INTO vendora.products(id,business_id,name,unit_price,stock_qty,client_id,legacy_id) VALUES ($1,$2,'Ledger product',100000,0.5,$3,'legacy-rice')",
        [id, shop, clientId]);
      await insertProduct(productId);
      await assert.rejects(insertProduct(randomUUID()), { code: "23505" });
      await insertProduct(randomUUID(), otherBusiness);
      const movementId = randomUUID();
      await client.query(`INSERT INTO vendora.stock_movements(id,business_id,product_id,type,quantity,quantity_before,quantity_after,source,created_by_id,client_id,sync_seq)
        VALUES ($1,$2,$3,'OPENING',0.5,0,0.5,'test',$4,$5,1)`, [movementId, businessId, productId, userId, randomUUID()]);
      await assert.rejects(client.query("UPDATE vendora.stock_movements SET source='rewritten' WHERE id=$1", [movementId]), { code: "23514" });
      await assert.rejects(client.query("DELETE FROM vendora.stock_movements WHERE id=$1", [movementId]), { code: "23514" });
      await assert.rejects(client.query(`INSERT INTO vendora.stock_movements(id,business_id,product_id,type,quantity,quantity_before,quantity_after,source)
        VALUES ($1,$2,$3,'RESTOCK',1,0,1,'test')`, [randomUUID(), otherBusiness, productId]), { code: "23503" });
      await client.query("INSERT INTO vendora.sync_changes(business_id,seq,entity,entity_id,payload) VALUES ($1,1,'movement',$2,'{}')", [businessId, movementId]);
      await assert.rejects(client.query("UPDATE vendora.sync_changes SET payload='{}' WHERE business_id=$1", [businessId]), { code: "23514" });
      await assert.rejects(client.query("INSERT INTO vendora.sync_changes(business_id,seq,entity,entity_id,payload) VALUES ($1,1,'movement',$2,'{}')", [businessId, movementId]), { code: "23505" });
      const saleId = randomUUID();
      await client.query("INSERT INTO vendora.sales(id,business_id,total,client_id,legacy_id) VALUES ($1,$2,12500,$3,'legacy-sale')", [saleId, businessId, randomUUID()]);
      await client.query("INSERT INTO vendora.sale_items(id,business_id,sale_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,0.125,100000)",
        [randomUUID(), businessId, saleId, productId]);
      const reversalId = randomUUID();
      await client.query("INSERT INTO vendora.sales(id,business_id,total,reversed_sale_id) VALUES ($1,$2,12500,$3)", [reversalId, businessId, saleId]);
      await assert.rejects(client.query("INSERT INTO vendora.sales(id,business_id,total,reversed_sale_id) VALUES ($1,$2,12500,$3)",
        [randomUUID(), businessId, saleId]), { code: "23505" });
      await assert.rejects(client.query("INSERT INTO vendora.sales(id,business_id,total,reversed_sale_id) VALUES ($1,$2,12500,$3)",
        [randomUUID(), otherBusiness, saleId]), { code: "23503" });
      await client.query(readFileSync(resolve(serverRoot, "prisma/runtime-grants.sql"), "utf8"));
      await client.query("SET ROLE vendora_runtime");
      try {
        await client.query("SELECT id FROM vendora.stock_movements LIMIT 1");
        await assert.rejects(client.query("UPDATE vendora.stock_movements SET source='forbidden'"), { code: "42501" });
        await assert.rejects(client.query("DELETE FROM vendora.sync_changes"), { code: "42501" });
      } finally { await client.query("RESET ROLE"); }
    });
    await t.test("oversized legacy integer quantities block the migration without partial changes", async () => {
      await client.query("CREATE DATABASE vendora_unsafe_upgrade_test");
      const url = new URL(database.url);
      url.pathname = "/vendora_unsafe_upgrade_test";
      await legacyMigrations(url.href);
      unsafe = new Client({ connectionString: url.href });
      await unsafe.connect();
      const businessId = randomUUID();
      await unsafe.query("INSERT INTO vendora.businesses(id,phone) VALUES ($1,$2)", [businessId, `unsafe-${businessId}`]);
      await unsafe.query("INSERT INTO vendora.products(id,business_id,name,unit_price,stock_qty) VALUES ($1,$2,'Oversized stock',100,1500000000)",
        [randomUUID(), businessId]);
      await assert.rejects(migrateTestDatabase(url.href), /Decimal\(12,3\) capacity/);
      const result = await unsafe.query<{ data_type: string }>("SELECT data_type FROM information_schema.columns WHERE table_schema='vendora' AND table_name='products' AND column_name='stock_qty'");
      assert.equal(result.rows[0]?.data_type, "integer");
      assert.equal((await unsafe.query<{ mode: unknown }>("SELECT to_regtype('vendora.inventory_mode') AS mode")).rows[0]?.mode, null);
    });
  } finally {
    await upgrade?.end();
    await unsafe?.end();
    await client.end();
    await database.stop();
  }
});
