import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app";
import { cookiePolicy } from "../src/config/cookies";
import { loadConfig } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { AuthRepository } from "../src/repositories/auth.repository";
import { schemas } from "../src/schemas/auth.schemas";
import { Passwords } from "../src/services/password.service";
import { createTokens } from "../src/services/token.service";
import { config, delivery, env, identity } from "./helpers";

test("registration validates the shop form and rejects client-issued permissions", () => {
  const input = { phone: "0803 000 0000", password: "secret", name: " Ngozi Okafor ", businessName: " Ngozi Provisions ", businessType: "Provisions", city: " Alaba Market, Lagos " };
  const parsed = schemas.register.parse(input);
  assert.equal(parsed.phone, "2348030000000");
  assert.equal(parsed.name, "Ngozi Okafor");
  assert.equal(parsed.businessName, "Ngozi Provisions");
  assert.equal(parsed.city, "Alaba Market, Lagos");
  assert.equal(schemas.register.parse({ phone: input.phone, password: input.password, name: input.name, businessName: input.businessName }).businessType, "");
  for (const override of [
    { name: undefined }, { name: " " }, { businessName: "a" },
    { businessType: "Invalid category" }, { city: "x".repeat(201) },
    { role: "owner" }, { permissions: ["bank:write"] },
  ]) assert.equal(schemas.register.safeParse({ ...input, ...override }).success, false);
});

test("configuration rejects wildcards and insecure production settings", () => {
  assert.throws(() =>
    loadConfig({ ...env, CORS_ORIGINS: "https://*.example.com" }),
  );
  assert.throws(() =>
    loadConfig({ ...env, NODE_ENV: "production", COOKIE_SECURE: "false" }),
  );
  assert.throws(() =>
    loadConfig({ ...env, DATABASE_URL: "postgres://x:x@localhost:6543/test" }),
  );
  assert.throws(() =>
    loadConfig({
      ...env,
      DATABASE_URL: "postgres://x:x@localhost/test?sslmode=no-verify",
    }),
  );
});

test("HTTP guards require sessions and business ownership without CSRF tokens", async () => {
  const { user, session } = identity();
  const businessId = "c39a98b5-e5a5-4ca6-9718-f732d3e0991b";
  const db = {
    session: {
      findUnique: async () => ({ ...session, user }),
      updateMany: async () => ({ count: 1 }),
    },
    membership: {
      findMany: async () => [
        {
          businessId,
          role: "staff",
          permissions: [
            "sales:write",
            "submissions:write",
            "bank:read",
            "bank:write",
          ],
          business: { phone: user.phone },
        },
      ],
    },
    resourceOwnership: {
      findUnique: async (args: {
        where: { kind_resourceId: { kind: string } };
      }) =>
        args.where.kind_resourceId.kind === "trader" ? { businessId } : null,
    },
    refreshToken: {
      findUnique: async () => ({
        session: { ...session, user },
        expiresAt: session.expiresAt,
        consumedAt: null,
      }),
    },
  } as unknown as PrismaClient;
  const tokens = await createTokens(config);
  const app = createApp({
    config,
    repo: new AuthRepository(db),
    limiter: { take: async () => {} },
    passwords: new Passwords(),
    tokens,
    delivery,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const policy = cookiePolicy(config);
  const access = await tokens.sign(user.id, session.id);
  const headers = {
    cookie: `${policy.names.access}=${access}; ${policy.names.refresh}=refresh-test`,
    origin: config.origins[0]!,
    "Content-Type": "application/json",
  };
  const call = (path: string, body: object, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  try {
    for (const path of [
      "/api/submissions",
      "/api/tts",
      "/wema/accounts/1234567890",
    ])
      assert.equal(
        (await fetch(base + path, { headers: { "x-vendora-key": "k" } }))
          .status,
        401,
      );
    assert.equal(
      (await call("/api/submissions", { file: "YQ==", sha256: "a".repeat(64) })).status,
      422,
    );
    assert.equal(
      (
        await call(
          "/api/auth/login",
          { phone: user.phone, password: "secret" },
          { origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/sync", { phone: "2348099999999" })).status,
      403,
    );
    assert.equal(
      (await call("/api/sync", { profile: { isOwner: true } })).status,
      400,
    );
    assert.equal(
      (await fetch(base + "/wema/accounts/1234567890", { headers })).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/wema/payment-requests/foreign", { headers }))
        .status,
      404,
    );
    assert.equal(
      (
        await call("/api/submissions", {
          phone: user.phone,
          accountNumber: "1234567890",
          file: "YQ==",
          sha256: "a".repeat(64),
        })
      ).status,
      404,
    );
    assert.equal((await call("/wema/loans", {})).status, 403);
    assert.equal((await call("/wema/accounts", {})).status, 403);
    assert.equal((await fetch(base + "/whatsapp/dev/outbox")).status, 404);
    assert.equal((await fetch(base + "/whatsapp/webhook")).status, 404);
    assert.equal((await call("/whatsapp/webhook", {})).status, 404);
    assert.equal((await call("/api/whatsapp/link", {})).status, 404);
    assert.equal(app.locals.wa, undefined);
    assert.equal((await call("/wema/simulate/credit", {})).status, 404);
    assert.equal((await call("/WEMA/SIMULATE/CREDIT/", {})).status, 404);
    assert.equal((await fetch(base + "/WEMA/ACCOUNTS/1234567890/", { headers })).status, 404);
    assert.equal((await fetch(base + "/wema/PAYMENT-REQUESTS/foreign/", { headers })).status, 404);
    assert.equal((await call("/wema/LOANS/", {})).status, 403);
    const me = await fetch(base + "/api/auth/me", { headers });
    const data = await me.json();
    assert.equal(me.status, 200);
    assert.equal(data.user.passwordHash, undefined);
    assert.equal(data.user.authVersion, undefined);
    assert.equal(me.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(base + "/api/auth/csrf", { headers })).status, 404);
    assert.equal((await call("/api/auth/logout", {}, { cookie: "" })).status, 204);
    assert.equal((await call("/api/auth/logout", {}, { cookie: "", origin: "" })).status, 204);
    assert.equal((await call("/api/auth/logout", {}, { "Content-Type": "text/plain" })).status, 415);
    const preflight = await fetch(base + "/api/auth/login", {
      method: "OPTIONS",
      headers: {
        origin: config.origins[0]!,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-credentials"),
      "true",
    );
    assert.equal(
      (await fetch(base + "/health")).headers.get("x-powered-by"),
      null,
    );
    user.status = "suspended";
    assert.equal((await fetch(base + "/api/auth/me", { headers })).status, 401);
    user.status = "active";
    session.revokedAt = new Date();
    assert.equal((await fetch(base + "/api/auth/me", { headers })).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("limiter/database failures deny private operations", async () => {
  const tokens = await createTokens(config);
  const app = createApp({
    config,
    repo: new AuthRepository({} as PrismaClient),
    limiter: {
      take: async () => {
        throw new Error("redis://private-secret");
      },
    },
    passwords: new Passwords(),
    tokens,
    delivery,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${addr.port}/api/auth/me`);
    assert.equal(response.status, 503);
    assert(!JSON.stringify(await response.json()).includes("private-secret"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
