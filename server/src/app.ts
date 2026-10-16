import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Delivery } from "./adapters/delivery";
import { legacy, type LegacyStore } from "./adapters/legacy";
import type { Config } from "./config/env";
import { asyncRoute, errorHandler } from "./middleware/error-handler";
import type { Limiter } from "./middleware/rate-limit";
import type { AuthRepository } from "./repositories/auth.repository";
import { createAuthRoutes } from "./routes/auth.routes";
import { businessGuard } from "./routes/business.routes";
import { snapshotRoutes } from "./routes/snapshot.routes";
import { webhookRoutes } from "./routes/webhook.routes";
import { AuthService } from "./services/auth.service";
import { Authorization } from "./services/authorization.service";
import type { Passwords } from "./services/password.service";
import { Recovery } from "./services/recovery.service";
import { Sessions } from "./services/session.service";
import type { Tokens } from "./services/token.service";

export interface AppDependencies {
  config: Config;
  repo: AuthRepository;
  limiter: Limiter;
  passwords: Passwords;
  tokens: Tokens;
  delivery: Delivery;
  store?: LegacyStore;
}
export function createApp(deps: AppDependencies) {
  const { config, repo, limiter, passwords, tokens, delivery } = deps;
  if (
    config.NODE_ENV === "production" &&
    (config.devRoutes || !config.secureCookies)
  )
    throw new Error("Insecure production configuration");
  const store = deps.store ?? legacy.store(config.DATA_FILE);
  const wa = config.whatsappEnabled ? legacy.whatsapp(store) : undefined;
  const wema = legacy.wema(store);
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    config.TRUST_PROXY
      ? config.TRUST_PROXY.split(",").map((x) => x.trim())
      : false,
  );
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set("X-Request-ID", res.locals.requestId);
    next();
  });
  app.use(helmet());
  app.use(["/api", "/wema", "/whatsapp/dev"], (_req, res, next) => {
    // Apply before authentication/rate limiting so error responses are private too.
    res.set("Cache-Control", "no-store");
    res.vary("Cookie");
    next();
  });
  if (!config.whatsappEnabled) {
    app.use("/whatsapp", (_req, res) => res.status(404).json({ error: "WhatsApp is disabled" }));
    app.use("/api/whatsapp", (_req, res) => res.status(404).json({ error: "WhatsApp is disabled" }));
  }
  app.use((req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, "");
    if (
      !config.devRoutes &&
      (path.startsWith("/whatsapp/dev/") ||
        path === "/wema/simulate/credit")
    ) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  });
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(
    asyncRoute(async (req, _res, next) => {
      await limiter.take(`all:${req.ip}`, 120, 60);
      next();
    }),
  );
  if (config.whatsappEnabled) app.use("/whatsapp", webhookRoutes(config, repo));
  app.use(
    cors({
      origin: config.origins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Business-ID"],
      maxAge: 600,
    }),
  );
  app.use(cookieParser());
  const sessions = new Sessions(repo, tokens, config.AUTH_REFRESH_REUSE_GRACE_MS);
  const auth = new AuthService(repo, passwords, sessions);
  const recovery = new Recovery(repo, passwords, delivery);
  const { router, guards } = createAuthRoutes({
    config,
    repo,
    limiter,
    sessions,
    auth,
    passwords,
    recovery,
  });
  app.use("/api/auth", express.json({ limit: "16kb" }), router);
  const mutation: RequestHandler = (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    guards.origin(req, res, next);
  };
  // Authentication checks precede the larger legacy upload parser.
  app.use(
    ["/api", "/wema"],
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    guards.authenticate,
    mutation,
  );
  app.use(express.json({ limit: "15mb" }));
  const guard = businessGuard(repo, store, config);
  app.use((req, res, next) =>
    req.path.toLowerCase().startsWith("/api/") || req.path.toLowerCase().startsWith("/wema/")
      ? guard(req, res, next)
      : next(),
  );
  app.use("/wema", wema.router);
  app.use(snapshotRoutes(repo, store));
  app.use(legacy.business(store));
  if (config.devRoutes && wa) {
    // Local demos still require sessions, and cannot impersonate another business.
    app.post(
      "/whatsapp/dev/inbound",
      guards.authenticate,
      mutation,
      asyncRoute(async (req, res) => {
        const membership = await new Authorization(repo).business(
          req.auth!,
          "sales:write",
          req.get("x-business-id"),
        );
        const body: unknown = req.body;
        const value = z
          .object({ text: z.string().max(8000) })
          .strict()
          .parse(body);
        res.json(await wa.handleText(membership.business.phone, value.text));
      }),
    );
  }
  app.use((_req, res) =>
    res
      .status(404)
      .json({ error: "Not found", requestId: res.locals.requestId }),
  );
  app.use(errorHandler);
  app.locals.store = store;
  app.locals.wa = wa;
  return app;
}
