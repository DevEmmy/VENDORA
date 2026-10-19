import express from "express";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { randomInt } from "node:crypto";
// Playwright otherwise resolves the old app.js bridge to a possibly stale dist.
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env";
import { createDatabase } from "../../src/db/prisma";
import { AuthRepository } from "../../src/repositories/auth.repository";
import { AuthService } from "../../src/services/auth.service";
import { Passwords } from "../../src/services/password.service";
import { Sessions } from "../../src/services/session.service";
import { createTokens } from "../../src/services/token.service";
import { delivery, env } from "../helpers";
import { serverRoot, startTestDatabase, unusedPort } from "./database";

export async function startTestServer(options: { lazyBackfill?: boolean; serveWeb?: boolean } = {}) {
  const database = await startTestDatabase();
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  const config = loadConfig({ ...env, DATABASE_URL: database.url,
    COOKIE_SECURE: "false", CORS_ORIGINS: url,
    INVENTORY_LAZY_BACKFILL: options.lazyBackfill ? 'true' : 'false' });
  const db = createDatabase(config);
  let server: Server | undefined;
  try {
    await db.$connect();
    const repo = new AuthRepository(db);
    const tokens = await createTokens(config);
    const passwords = new Passwords();
    const sessions = new Sessions(repo, tokens);
    const auth = new AuthService(repo, passwords, sessions);
    const app = express();
    let refreshRequests = 0;
    // Test-only wrapper, never imported by a production entrypoint. Delay makes
    // two stale-cookie requests overlap without changing the rotation service.
    app.post("/api/auth/refresh", (_req, _res, next) => { refreshRequests++; setTimeout(next, 200); });
    const shell = '<!doctype html><html><head><title>Vendora browser regression</title></head><body>Vendora regression harness</body></html>';
    app.get('/__test/browser', (_req, res) => res.type('html').send(shell));
    app.get(['/', '/index.html'], (_req, res) => options.serveWeb ?
      res.sendFile(resolve(serverRoot, '../web/dist/index.html')) : res.type('html').send(shell));
    app.get("/sw.js", (_req, res) => res.sendFile(resolve(serverRoot, "../web/public/sw.js")));
    app.use("/__test/modules/lib", express.static(resolve(serverRoot, "../web/src/lib")));
    app.use('/__test/modules/features', express.static(resolve(serverRoot, '../web/src/features')));
    if (options.serveWeb) app.use(express.static(resolve(serverRoot, '../web/dist')));
    app.use(express.static(resolve(serverRoot, "../web/public")));
    app.use(createApp({ config, repo, tokens, passwords, delivery, limiter: { take: async () => {} } }));
    server = app.listen(port, "127.0.0.1");
    await new Promise<void>((done, reject) => {
      server!.once("listening", done);
      server!.once("error", reject);
    });
    return {
      url, db, config,
      refreshCount: () => refreshRequests,
      async account(label: string) {
        const phone = "23480" + randomInt(10_000_000, 99_999_999);
        const password = "milestone regression password";
        const result = await auth.register({ phone, password, name: label,
          businessName: label + " shop", businessType: "Provisions", city: "Lagos" }, "test-fixture");
        return { phone, password, userId: result.user.id, businessId: result.business.id };
      },
      async stop() {
        if (server) await new Promise<void>((done, reject) => {
          server!.close(error => error ? reject(error) : done());
          server!.closeIdleConnections();
        });
        await db.$disconnect();
        await database.stop();
      },
    };
  } catch (error: unknown) {
    if (server) server.close();
    await db.$disconnect();
    await database.stop();
    throw error;
  }
}
export type TestServer = Awaited<ReturnType<typeof startTestServer>>;
