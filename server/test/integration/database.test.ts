import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "pg";
import { createDeliveryQueue } from "../../src/adapters/delivery-queue";
import { createApp } from "../../src/app";
import { cookiePolicy } from "../../src/config/cookies";
import { createDatabase } from "../../src/db/prisma";
import { createLimiter } from "../../src/middleware/rate-limit";
import { AuthRepository } from "../../src/repositories/auth.repository";
import { AuthService } from "../../src/services/auth.service";
import { Passwords } from "../../src/services/password.service";
import { Recovery } from "../../src/services/recovery.service";
import { Sessions } from "../../src/services/session.service";
import { createTokens, digest } from "../../src/services/token.service";
import { createWebhookWorker } from "../../src/services/webhook.service";
import { config, delivery } from "../helpers";

test(
  "PostgreSQL migrations, credentials, session races, ownership and webhook processing",
  { timeout: 240_000 },
  async (t) => {
    let stop = async () => {};
    let url = process.env.TEST_DATABASE_URL;
    if (url && !new URL(url).pathname.endsWith("_test"))
      throw new Error("Integration database name must end in _test");
    if (!url) {
      const { default: EmbeddedPostgres } = await import("embedded-postgres");
      const probe = createServer();
      await new Promise<void>((resolve) =>
        probe.listen(0, "127.0.0.1", resolve),
      );
      const address = probe.address();
      assert(address && typeof address !== "string");
      const port = address.port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const directory = mkdtempSync(join(tmpdir(), "vendora-auth-test-"));
      assert(
        resolve(directory).startsWith(resolve(tmpdir()) + "\\") ||
          resolve(directory).startsWith(resolve(tmpdir()) + "/"),
      );
      const pgPassword = randomUUID();
      const pg = new EmbeddedPostgres({
        databaseDir: directory,
        user: "postgres",
        password: pgPassword,
        port,
        persistent: true,
        postgresFlags: ["-h", "127.0.0.1"],
        onLog: () => {},
        onError: () => {},
      });
      await pg.initialise();
      await pg.start();
      stop = () => pg.stop();
      await pg.createDatabase("vendora_test");
      url = `postgresql://postgres:${pgPassword}@127.0.0.1:${port}/vendora_test`;
    }
    const db = createDatabase({
      ...config,
      DATABASE_URL: url,
      DATABASE_TLS: "false",
    });
    const admin = new Client({ connectionString: url });
    try {
      execFileSync(
        process.execPath,
        [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
        { env: { ...process.env, DIRECT_URL: url }, stdio: "pipe" },
      );
      await db.$connect();
      await admin.connect();
      const repo = new AuthRepository(db);
      const tokens = await createTokens(config);
      const sessions = new Sessions(repo, tokens);
      const passwords = new Passwords();
      let recoveryToken = "";
      const sent = {
        ...delivery,
        sendVerification: async () => {
          throw new Error("Phone OTP must not be sent");
        },
        sendRecovery: async (_destination: string, token: string) => {
          recoveryToken = token;
        },
      };
      const auth = new AuthService(repo, passwords, sessions);
      const recovery = new Recovery(repo, passwords, sent);
      const phone = "23480" + randomInt(10_000_000, 99_999_999);
      const password = "a unique long password for integration";
      const shopDetails = { name: "Ngozi Okafor", businessName: "Ngozi Provisions", businessType: "Provisions" as const, city: "Alaba Market, Lagos" };
      await t.test(
        "registration activates accounts immediately and duplicate signup is rejected",
        async () => {
          const outcomes = await Promise.allSettled([
            auth.register({ phone, password, ...shopDetails }, "test-register"),
            auth.register({ phone, password, ...shopDetails }, "test-register"),
          ]);
          assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
          assert.equal(await db.user.count({ where: { phone } }), 1);
          const login = await auth.login(phone, password, "test-login");
          assert.equal(login.user.status, "active");
          assert.equal(login.user.phoneVerifiedAt, null);
          await assert.rejects(auth.login(phone, "wrong-password", "test-wrong"));
          await db.user.update({ where: { phone }, data: { status: "pending" } });
          assert.equal((await auth.login(phone, password, "test-existing-pending")).user.status, "active");
          const user = await repo.userByPhone(phone);
          assert(user);
          assert.equal(user.name, shopDetails.name);
          const memberships = await repo.memberships(user.id);
          assert.equal(memberships.length, 1);
          assert.equal(memberships[0]!.role, "owner");
          assert.equal(memberships[0]!.business.businessName, shopDetails.businessName);
          assert.equal(memberships[0]!.business.businessType, shopDetails.businessType);
          assert.equal(memberships[0]!.business.city, shopDetails.city);
          await repo.ownership(memberships[0]!.businessId, "trader", phone);
          assert.equal(await db.business.count({ where: { phone } }), 1);
          const snapshot = await db.businessSnapshot.findUniqueOrThrow({ where: { businessId: memberships[0]!.businessId } });
          assert.equal((snapshot.state as Record<string, unknown>).name, shopDetails.name);
        },
      );
      await t.test("existing shop conflicts roll back registration without claiming ownership", async () => {
        const conflictPhone = "23480" + randomInt(10_000_000, 99_999_999);
        const existing = await db.business.create({ data: { phone: conflictPhone, businessName: "Existing shop" } });
        await assert.rejects(auth.register({ phone: conflictPhone, password, ...shopDetails }, "conflict"), { status: 409 });
        assert.equal(await db.user.count({ where: { phone: conflictPhone } }), 0);
        assert.equal(await db.membership.count({ where: { businessId: existing.id } }), 0);
        assert.equal((await db.business.findUniqueOrThrow({ where: { id: existing.id } })).businessName, "Existing shop");
      });
      await t.test(
        "refresh replay commits revocation and concurrent refresh has one winner",
        async () => {
          const login = await auth.login(phone, password, "test-login");
          const rotated = await sessions.rotate(
            login.refresh,
            "test-refresh",
          );
          assert.notEqual(rotated.refresh, login.refresh);
          assert.equal(
            rotated.session.expiresAt.getTime(),
            login.session.expiresAt.getTime(),
          );
          assert.equal(
            rotated.session.idleExpiresAt.getTime(),
            login.session.idleExpiresAt.getTime(),
          );
          await assert.rejects(
            sessions.rotate(login.refresh, "test-replay"),
          );
          await assert.rejects(sessions.authenticate(rotated.access));
          assert(
            (
              await db.session.findUniqueOrThrow({
                where: { id: login.session.id },
              })
            ).revokedAt,
          );
          const race = await auth.login(phone, password, "test-login");
          const results = await Promise.allSettled([
            sessions.rotate(race.refresh, "race-a"),
            sessions.rotate(race.refresh, "race-b"),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert(
            (
              await db.session.findUniqueOrThrow({
                where: { id: race.session.id },
              })
            ).revokedAt,
          );
        },
      );
      await t.test(
        "recovery atomically consumes its credential and revokes every session",
        async () => {
          const login = await auth.login(phone, password, "test-login");
          await db.user.update({
            where: { id: login.user.id },
            data: {
              recoveryDestination: "verified-independent-channel",
              recoveryVerifiedAt: new Date(),
            },
          });
          await recovery.forgot(phone);
          assert(recoveryToken);
          assert(
            await db.recoveryToken.findUnique({
              where: { digest: digest(recoveryToken) },
            }),
          );
          const results = await Promise.allSettled([
            recovery.reset(
              recoveryToken,
              "another unique password for integration",
              "reset-a",
            ),
            recovery.reset(
              recoveryToken,
              "another unique password for integration",
              "reset-b",
            ),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          await assert.rejects(sessions.authenticate(login.access));
          await assert.rejects(auth.login(phone, password, "old-password"));
          const fresh = await auth.login(
            phone,
            "another unique password for integration",
            "fresh",
          );
          await sessions.revokeAll(fresh.user.id, "all");
          await assert.rejects(sessions.authenticate(fresh.access));
        },
      );
      await t.test(
        "HTTP cookies, durable snapshots/submissions and signed webhook deduplication",
        async () => {
          const user = await repo.userByPhone(phone);
          assert(user);
          const business = await db.business.findUniqueOrThrow({ where: { phone } });
          const queue = createDeliveryQueue(repo, config, sent);
          const worker = createWebhookWorker(repo, queue);
          const appConfig = {
            ...config,
            whatsappEnabled: true,
            WA_APP_SECRET: "w".repeat(64),
            WA_VERIFY_TOKEN: "v".repeat(32),
          };
          const app = createApp({
            config: appConfig,
            repo,
            tokens,
            passwords,
            delivery: queue.delivery,
            limiter: { take: async () => {} },
          });
          const server = app.listen(0);
          await new Promise<void>((resolve) =>
            server.once("listening", resolve),
          );
          const addr = server.address();
          assert(addr && typeof addr !== "string");
          const base = `http://127.0.0.1:${addr.port}`;
          try {
            const signupPhone = "23480" + randomInt(10_000_000, 99_999_999);
            const signupBody = JSON.stringify({ phone: signupPhone, password: "secret", ...shopDetails });
            const invalidSignup = await fetch(base + "/api/auth/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phone: signupPhone, password: "secret", ...shopDetails, businessName: " " }),
            });
            assert.equal(invalidSignup.status, 400);
            assert.equal(await db.user.count({ where: { phone: signupPhone } }), 0);
            const signup = () => fetch(base + "/api/auth/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: signupBody,
            });
            const registered = await signup();
            assert.equal(registered.status, 201);
            const registeredBody = await registered.json();
            assert.equal((await repo.userByPhone(signupPhone))?.status, "active");
            assert.equal(registeredBody.user.phoneVerified, false);
            assert.equal(registeredBody.user.passwordHash, undefined);
            assert.equal(registeredBody.user.name, shopDetails.name);
            assert.equal(registeredBody.business.businessName, shopDetails.businessName);
            assert.equal(registeredBody.memberships[0].role, "owner");
            assert.equal((await signup()).status, 409);
            const immediateLogin = await fetch(base + "/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phone: signupPhone, password: "secret" }),
            });
            assert.equal(immediateLogin.status, 200);
            assert.equal((await immediateLogin.json()).csrfToken, undefined);
            const signupCookies = immediateLogin.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
            const me = await fetch(base + "/api/auth/me", { headers: { cookie: signupCookies } });
            const meBody = await me.json();
            assert.equal(me.status, 200);
            assert.equal(meBody.memberships[0].business.id, registeredBody.business.id);
            assert.equal(meBody.memberships[0].business.city, shopDetails.city);
            const initialSync = await fetch(base + "/api/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json", cookie: signupCookies },
              body: "{}",
            });
            assert.equal(initialSync.status, 200);
            const refreshed = await fetch(base + "/api/auth/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json", cookie: signupCookies },
              body: "{}",
            });
            assert.equal(refreshed.status, 204);
            assert.equal((await fetch(base + "/api/auth/me", {
              headers: { cookie: refreshed.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") },
            })).status, 200);
            const loginResponse = await fetch(base + "/api/auth/login", {
              method: "POST",
              headers: {
                origin: config.origins[0]!,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                phone,
                password: "another unique password for integration",
              }),
            });
            assert.equal(loginResponse.status, 200);
            const body = await loginResponse.json();
            assert(!("access" in body));
            assert(!("refresh" in body));
            const cookies = loginResponse.headers.getSetCookie();
            assert(
              cookies.some(
                (c) =>
                  c.startsWith("__Host-vendora-access=") &&
                  c.includes("HttpOnly") &&
                  c.includes("Secure") &&
                  c.includes("SameSite=Strict"),
              ),
            );
            const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
            const headers = {
              cookie: cookieHeader,
              origin: config.origins[0]!,
              "Content-Type": "application/json",
            };
            const post = (path: string, value: object) =>
              fetch(base + path, {
                method: "POST",
                headers,
                body: JSON.stringify(value),
              });
            assert.equal(
              (
                await post("/api/sync", {
                  inventory: [
                    {
                      id: "rice",
                      name: "rice",
                      aliases: [],
                      unit: "bag",
                      price: 1000,
                      qty: 5,
                    },
                  ],
                  customers: [],
                })
              ).status,
              200,
            );
            assert.equal((await post("/api/whatsapp/link", {})).status, 204);
            const webhook = JSON.stringify({
              entry: [
                {
                  changes: [
                    {
                      value: {
                        messages: [
                          {
                            id: randomUUID(),
                            from: phone,
                            type: "text",
                            text: { body: "I sold 1 bag rice" },
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            });
            const signed = {
              "Content-Type": "application/json",
              "X-Hub-Signature-256":
                "sha256=" +
                createHmac("sha256", appConfig.WA_APP_SECRET)
                  .update(webhook)
                  .digest("hex"),
            };
            assert.equal(
              (
                await fetch(base + "/whatsapp/webhook", {
                  method: "POST",
                  headers: { ...signed, "X-Hub-Signature-256": "bad" },
                  body: webhook,
                })
              ).status,
              403,
            );
            const acknowledgements = await Promise.all([
              fetch(base + "/whatsapp/webhook", {
                method: "POST",
                headers: signed,
                body: webhook,
              }),
              fetch(base + "/whatsapp/webhook", {
                method: "POST",
                headers: signed,
                body: webhook,
              }),
            ]);
            assert(acknowledgements.every(response => response.status === 200));
            await Promise.all([worker(), worker()]);
            assert.equal(
              await db.channelEntry.count({
                where: { businessId: business.id },
              }),
              1,
            );
            const snapshot = await post("/api/sync", {
              inventory: [
                { id: "rice", name: "rice", unit: "bag", price: 1000, qty: 5 },
              ],
              customers: [],
            });
            assert.equal((await snapshot.json()).entries.length, 1);
            const file = Buffer.from("sample workbook");
            const sha256 = (await import("node:crypto"))
              .createHash("sha256")
              .update(file)
              .digest("hex");
            assert.equal(
              (
                await post("/api/submissions", {
                  file: file.toString("base64"),
                  sha256,
                })
              ).status,
              201,
            );
            assert.equal(
              await db.submission.count({ where: { businessId: business.id } }),
              1,
            );
            const refreshCookie = cookies.find(c => c.startsWith(cookiePolicy(config).names.refresh + "="))!.split(';')[0]!;
            const logout = await fetch(base + "/api/auth/logout", { method: "POST", headers: { ...headers, cookie: refreshCookie }, body: "{}" });
            assert.equal(logout.status, 204);
            assert(logout.headers.getSetCookie().some(c => c.startsWith("__Host-vendora-refresh=;") && c.includes("HttpOnly") && c.includes("Secure")));
            assert.equal(
              (await fetch(base + "/api/auth/me", { headers })).status,
              401,
            );
          } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
          }
        },
      );
      await t.test(
        "runtime role has no DDL or audit modification permissions",
        async () => {
          await admin.query(
            readFileSync(resolve("prisma/runtime-grants.sql"), "utf8"),
          );
          await admin.query("SET ROLE vendora_runtime");
          await admin.query("SELECT id FROM vendora.users LIMIT 1");
          await assert.rejects(
            admin.query("CREATE TABLE vendora.forbidden (id INT)"),
          );
          await assert.rejects(
            admin.query(
              "UPDATE vendora.auth_audit_events SET outcome = outcome",
            ),
          );
          await admin.query("RESET ROLE");
        },
      );
    } finally {
      await db.$disconnect();
      await admin.end();
      await stop();
      // Embedded Postgres registers an IPC message listener for PM2 shutdown.
      // In node:test children this otherwise keeps the completed worker alive.
      process.channel?.unref();
    }
  },
);

test(
  "Redis limiter is shared across independent backend clients",
  { skip: !process.env.TEST_REDIS_URL },
  async () => {
    const a = createLimiter(process.env.TEST_REDIS_URL!);
    const b = createLimiter(process.env.TEST_REDIS_URL!);
    try {
      await a.client.connect();
      await b.client.connect();
      const key = randomUUID();
      await a.limiter.take(key, 1, 60);
      await assert.rejects(b.limiter.take(key, 1, 60));
    } finally {
      if (a.client.isOpen) await a.client.quit();
      if (b.client.isOpen) await b.client.quit();
    }
  },
);
