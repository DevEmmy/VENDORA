import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { demoBusiness, demoUser, down } from "./phase1-database";
import { seed } from "./phase1-seed";
import { reports } from "./phase1-verify";
import { constraints } from "./phase1-constraints";

async function main() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done) => probe.close(() => done()));
  const password = randomUUID();
  const directory = mkdtempSync(join(tmpdir(), "vendora-phase1-"));
  const shutdownLogs: string[] = [];
  const pg = new EmbeddedPostgres({
    databaseDir: directory,
    user: "postgres", password, port, persistent: true,
    initdbFlags: ["--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1", "-c", "io_method=sync"],
    onLog: (message: string) => {
      if (/shutdown|shut down|checkpoint|terminating/.test(message)) shutdownLogs.push(message.trim());
      if (process.env.PHASE1_PG_DEBUG || /FATAL|PANIC/.test(message)) console.log(message);
    },
    onError: (error: unknown) => console.error(error),
  });
  let started = false;
  if (process.platform === "win32") {
    // The dependency uses taskkill /t on Windows, which can orphan children.
    // Override its shutdown hook as well, so every exit uses PostgreSQL's own stop.
    pg.stop = async () => {
      if (!started) return;
      try {
        await promisify(execFile)(resolve(`node_modules/@embedded-postgres/windows-${process.arch}/native/bin/pg_ctl.exe`),
          ["stop", "-D", directory, "-m", "fast", "-w", "-t", "120"], { timeout: 125000 });
      } catch (error) {
        console.error(shutdownLogs.join("\n"));
        throw error;
      }
      started = false;
    };
  }
  let client: Client | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("vendora_phase1_test");
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/vendora_phase1_test`;
    const env = { ...process.env, DIRECT_URL: url, NODE_ENV: "test" };
    const deploy = () => execFileSync(process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env, stdio: "pipe" });
    deploy();
    deploy();
    console.log("PASS fresh migrate deploy + repeated deploy");
    client = new Client({ connectionString: url });
    await client.connect();
    const retainedUser = randomUUID();
    await client.query('INSERT INTO vendora.users (id,phone,"passwordHash",status,"updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [retainedUser, "phase1-retained-auth-user", "!disabled", "disabled"]);
    await down(client);
    assert.equal((await client.query("SELECT to_regclass('vendora.products') AS table_name")).rows[0].table_name, null);
    assert.equal((await client.query("SELECT to_regclass('vendora.users') AS table_name")).rows[0].table_name, "vendora.users");
    deploy();
    assert.equal((await client.query("SELECT count(*)::int AS count FROM vendora.users WHERE id=$1", [retainedUser])).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='vendora' AND table_name IN ('products','customers','sales','sale_items','payments','expenses')")).rows[0].count, 6);
    console.log("PASS down + up; six ledger tables restored and auth retained");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    try {
      const unrelated = await db.business.create({ data: { phone: "phase1-unrelated-shop" } });
      const sentinel = await db.product.create({ data: {
        businessId: unrelated.id, name: "Unrelated inventory", unitPrice: 9000000000n, stockQty: 8,
      } });
      await seed(db);
      await seed(db);
      assert.deepEqual(await db.product.findUnique({ where: { id: sentinel.id } }), sentinel);
      assert.deepEqual(await Promise.all([
        db.product.count({ where: { businessId: demoBusiness } }),
        db.customer.count({ where: { businessId: demoBusiness } }),
        db.sale.count({ where: { businessId: demoBusiness } }),
        db.payment.count({ where: { businessId: demoBusiness } }),
        db.expense.count({ where: { businessId: demoBusiness } }),
      ]), [10, 6, 14, 2, 7]);
      console.log("PASS seed twice via Prisma: 10 products, 6 customers, 14 sales, 2 repayments, 7 expenses");
      console.log("PASS unrelated business inventory unchanged");
      const demo = await db.user.findUniqueOrThrow({ where: { id: demoUser } });
      await db.user.update({ where: { id: demoUser }, data: { name: "Collision test" } });
      await assert.rejects(seed(db), /Demo user UUID collision/);
      assert.equal(await db.sale.count({ where: { businessId: demoBusiness } }), 14);
      await db.user.update({ where: { id: demoUser }, data: { name: demo.name } });
      console.log("PASS seed identity collision rejected without deleting ledger data");
      await reports(client);
      await constraints(client);
    } finally { await db.$disconnect(); }
    if (process.argv.includes("--auth")) {
      await pg.createDatabase("vendora_auth_test");
      console.log("Running existing authentication integration suite on a separate UTF-8 database");
      execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-force-exit", "test/integration/database.test.ts"], {
        env: { ...env, TEST_DATABASE_URL: url.replace("vendora_phase1_test", "vendora_auth_test") },
        stdio: "inherit",
      });
    }
  } finally {
    await client?.end();
    console.log("Stopping isolated PostgreSQL (allowing up to 120 seconds for its checkpoint)");
    await pg.stop();
    console.log("PASS isolated PostgreSQL stopped");
  }
}
// embedded-postgres installs a beforeExit hook that otherwise overwrites exitCode.
void main().catch((error: unknown) => { console.error(error); process.exit(1); });
