import "dotenv/config";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { assertTestDatabase, migrateTestDatabase, serverRoot, startTestDatabase } from "../test/support/database";

async function main() {
  const action = process.argv[2];
  if (action === "integration") {
    const database = await startTestDatabase();
    let exitCode = 1;
    try {
      const probe = new Client({ connectionString: database.url });
      try {
        await probe.connect();
        await probe.query("CREATE TABLE vendora.milestone_reset_probe (id integer)");
        const result = await promisify(execFile)(process.execPath,
          ["--import", "tsx", resolve(serverRoot, "scripts/test-database.ts"), "reset"],
          { cwd: serverRoot, env: { ...process.env, NODE_ENV: "test", TEST_DATABASE_URL: database.url } });
        console.log(result.stdout.trim());
        assert.equal((await probe.query("SELECT to_regclass('vendora.milestone_reset_probe') AS probe")).rows[0].probe, null);
        assert.equal((await probe.query("SELECT to_regclass('vendora.users') AS users")).rows[0].users, "vendora.users");
        await migrateTestDatabase(database.url);
        console.log("PASS test database reset removes old data; repeated migration is safe");
      } finally { await probe.end(); }
      exitCode = await new Promise<number>((done, reject) => {
        const child = spawn(process.execPath,
          ["--import", "tsx", "--test", "--test-concurrency=1", "--test-force-exit", "test/integration/*.test.ts"],
          { cwd: serverRoot, env: { ...process.env, NODE_ENV: "test", TEST_DATABASE_URL: database.url }, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", code => done(code ?? 1));
      });
    } finally {
      console.log("Stopping isolated test PostgreSQL...");
      await database.stop();
      console.log("Isolated test PostgreSQL stopped.");
    }
    // embedded-postgres installs exit hooks; preserve the actual test result.
    process.exit(exitCode);
  }
  if (action !== "migrate" && action !== "reset") {
    throw new Error("Expected migrate, reset, or integration");
  }
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Set TEST_DATABASE_URL to a separate local *_test database. Application URLs are never used.");
  }
  const url = assertTestDatabase(process.env.TEST_DATABASE_URL);
  if (action === "reset") {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      // This entire database is explicitly disposable; validate its name/host first.
      await client.query("DROP SCHEMA IF EXISTS vendora CASCADE");
      await client.query('DROP TABLE IF EXISTS public."_prisma_migrations"');
    } finally { await client.end(); }
  }
  await migrateTestDatabase(url);
  console.log(`PASS isolated test database ${action}`);
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Test database command failed");
  process.exit(1);
});
