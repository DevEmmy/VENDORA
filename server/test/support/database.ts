import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export const serverRoot = resolve(__dirname, "../..");
const execute = promisify(execFile);

export function assertTestDatabase(url: string) {
  const parsed = new URL(url);
  if (process.env.NODE_ENV === "production" ||
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      !/^\/[a-z0-9_]+_test$/.test(parsed.pathname)) {
    throw new Error("Only an explicitly named local *_test database is allowed");
  }
  for (const setting of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    if (!setting) continue;
    const application = new URL(setting);
    const local = ["127.0.0.1", "localhost", "[::1]"];
    if (local.includes(application.hostname) &&
        (application.port || "5432") === (parsed.port || "5432") && application.pathname === parsed.pathname) {
      throw new Error("Test database must differ from the configured application database");
    }
  }
  return url;
}

export async function migrateTestDatabase(url: string) {
  assertTestDatabase(url);
  try {
    await execute(process.execPath,
      [resolve(serverRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { cwd: serverRoot, env: { ...process.env, NODE_ENV: "test", DIRECT_URL: url }, timeout: 120_000 });
  } catch (error: unknown) {
    // Prisma's child-process error message can contain connection details.
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error("Test migrations failed: " +
      String(failure.stderr || failure.stdout || "unknown error").replaceAll(url, "[test database]"));
  }
}

export async function unusedPort() {
  const probe = createServer();
  await new Promise<void>((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const address = probe.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  return address.port;
}

export interface TestDatabase {
  url: string;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const directory = mkdtempSync(join(tmpdir(), "vendora-milestone-test-"));
  const password = randomUUID();
  const port = await unusedPort();
  const pg = new EmbeddedPostgres({
    databaseDir: directory, user: "postgres", password, port, persistent: true,
    initdbFlags: ["--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1", "-c", "io_method=sync"],
    onLog: () => {}, onError: () => {},
  });
  let started = false;
  const originalStop = pg.stop.bind(pg);
  pg.stop = async () => {
    if (!started) return;
    if (process.platform === "win32") {
      await execute(resolve(serverRoot,
        `node_modules/@embedded-postgres/windows-${process.arch}/native/bin/pg_ctl.exe`),
        ["stop", "-D", directory, "-m", "fast", "-w", "-t", "120"], { timeout: 125_000 });
    } else {
      await originalStop();
    }
    started = false;
  };
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("vendora_milestone_test");
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/vendora_milestone_test`;
    await migrateTestDatabase(url);
    return { url, stop: () => pg.stop() };
  } catch (error: unknown) {
    await pg.stop();
    throw error;
  }
}
