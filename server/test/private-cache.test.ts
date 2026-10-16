import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { cookiePolicy } from "../src/config/cookies";
import type { PrismaClient } from "../src/generated/prisma/client";
import { AuthRepository } from "../src/repositories/auth.repository";
import { Passwords } from "../src/services/password.service";
import { createTokens } from "../src/services/token.service";
import { config, delivery, identity } from "./helpers";

test("private identity, inventory and sales responses forbid caching and vary by cookie", async t => {
  const { user, session } = identity();
  const businessId = randomUUID();
  const db = {
    session: { findUnique: async () => ({ ...session, user }), updateMany: async () => ({ count: 1 }) },
    membership: { findMany: async () => [{ businessId, role: "owner", permissions: ["sales:write"],
      business: { id: businessId, phone: user.phone, businessName: "Test shop" } }] },
    resourceOwnership: { findUnique: async () => ({ businessId }) },
    businessSnapshot: { findUnique: async () => ({ state: { inventory: [], sales: [] }, updatedAt: new Date() }) },
  } as unknown as PrismaClient;
  const tokens = await createTokens(config);
  const app = createApp({ config, repo: new AuthRepository(db), tokens,
    passwords: new Passwords(), delivery, limiter: { take: async () => {} } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(done => server.once("listening", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  const access = await tokens.sign(user.id, session.id);
  try {
    for (const path of ["/api/auth/me", "/api/inventory", "/api/sales"]) {
      await t.test(path, async () => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
          headers: { cookie: `${cookiePolicy(config).names.access}=${access}`, "X-Business-ID": businessId } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert(response.headers.get("vary")?.toLowerCase().split(/\s*,\s*/).includes("cookie"));
      });
    }
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
