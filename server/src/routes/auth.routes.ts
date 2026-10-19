import { Router, type Request } from "express";
import { z } from "zod";
import { cookiePolicy } from "../config/cookies";
import type { Config } from "../config/env";
import { cookie, createGuards } from "../middleware/auth";
import { asyncRoute, HttpError } from "../middleware/error-handler";
import type { Limiter } from "../middleware/rate-limit";
import type { AuthRepository } from "../repositories/auth.repository";
import { schemas } from "../schemas/auth.schemas";
import type { AuthService } from "../services/auth.service";
import type { Passwords } from "../services/password.service";
import type { Recovery } from "../services/recovery.service";
import type { Sessions } from "../services/session.service";
import { digest } from "../services/token.service";
import { safeBusiness, safeUser } from "../types/auth";
import { lazyInventoryBackfill } from '../services/lazy-inventory-backfill';

function parse<T>(schema: z.ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) throw new HttpError(400, "Invalid request");
  return result.data;
}
export function createAuthRoutes(deps: {
  config: Config;
  repo: AuthRepository;
  limiter: Limiter;
  sessions: Sessions;
  auth: AuthService;
  passwords: Passwords;
  recovery: Recovery;
}) {
  const {
    config,
    repo,
    limiter,
    sessions,
    auth,
    passwords,
    recovery,
  } = deps;
  const router = Router();
  const policy = cookiePolicy(config);
  const guards = createGuards(config, policy, sessions);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(
    asyncRoute(async (req, _res, next) => {
      await limiter.take(`auth:ip:${req.ip}`, 60, 60);
      next();
    }),
  );
  const accountLimit = (key: string, phone: string, limit = 5) =>
    limiter.take(`auth:${key}:${phone}`, limit, 900);
  router.post(
    "/register",
    guards.origin,
    asyncRoute(async (req, res) => {
      const b = parse(schemas.register, req);
      await accountLimit("register", b.phone);
      const { user, business, membership } = await auth.register(b, res.locals.requestId);
      res.status(201).json({
        user: safeUser(user),
        business: safeBusiness(business),
        memberships: [{ businessId: membership.businessId, role: membership.role, permissions: membership.permissions }],
      });
    }),
  );
  router.post(
    "/login",
    guards.origin,
    asyncRoute(async (req, res) => {
      const b = parse(schemas.login, req);
      await accountLimit("login", b.phone, 10);
      const result = await auth.login(
        b.phone,
        b.password,
        res.locals.requestId,
      );
      policy.set(res, result.access, result.refresh, result.session.expiresAt);
      const inventoryMigrations = await lazyInventoryBackfill(repo, result.user.id, config.INVENTORY_LAZY_BACKFILL === 'true');
      res.json({ user: safeUser(result.user), inventoryMigrations });
    }),
  );
  // Refresh independently validates its binding, including replay, inside the transaction.
  router.post(
    "/refresh",
    guards.origin,
    asyncRoute(async (req, res) => {
      parse(schemas.empty, req);
      const refresh = cookie(req, policy.names.refresh);
      if (!refresh) throw new HttpError(401, "Authentication required");
      const result = await sessions.rotate(
        refresh,
        res.locals.requestId,
      );
      policy.set(res, result.access, result.refresh, result.session.expiresAt);
      res.sendStatus(204);
    }),
  );
  router.get(
    "/me",
    guards.authenticate,
    asyncRoute(async (req, res) => {
      const user = req.auth!.user;
      const memberships = await repo.memberships(user.id);
      res.json({
        user: safeUser(user),
        memberships: memberships.map((m) => ({
          businessId: m.businessId,
          role: m.role,
          permissions: m.permissions,
          business: safeBusiness(m.business),
        })),
      });
    }),
  );
  router.post(
    "/logout",
    guards.origin,
    asyncRoute(async (req, res) => {
      parse(schemas.empty, req);
      const refresh = cookie(req, policy.names.refresh);
      if (refresh) {
        const record = await repo.db.refreshToken.findUnique({
          where: { digest: digest(refresh) },
          include: { session: true },
        });
        if (record) {
          await sessions.revoke(record.sessionId, res.locals.requestId);
        }
      }
      policy.clear(res);
      res.sendStatus(204);
    }),
  );
  router.post(
    "/logout-all",
    guards.origin,
    guards.authenticate,
    asyncRoute(async (req, res) => {
      parse(schemas.empty, req);
      await sessions.revokeAll(req.auth!.user.id, res.locals.requestId);
      policy.clear(res);
      res.sendStatus(204);
    }),
  );
  router.post(
    "/password/forgot",
    guards.origin,
    asyncRoute(async (req, res) => {
      const b = parse(schemas.destination, req);
      await accountLimit("recovery-send", b.phone, 3);
      await recovery.forgot(b.phone);
      res.status(202).json({ accepted: true });
    }),
  );
  router.post(
    "/password/reset",
    guards.origin,
    asyncRoute(async (req, res) => {
      const b = parse(schemas.reset, req);
      await limiter.take(`reset:${req.ip}`, 5, 900);
      await recovery.reset(b.token, b.password, res.locals.requestId);
      policy.clear(res);
      res.sendStatus(204);
    }),
  );
  router.post(
    "/password/change",
    guards.origin,
    guards.authenticate,
    asyncRoute(async (req, res) => {
      const b = parse(schemas.change, req);
      await accountLimit("password-change", req.auth!.user.id);
      await recovery.change(
        req.auth!,
        b.currentPassword,
        b.password,
        res.locals.requestId,
      );
      policy.clear(res);
      res.sendStatus(204);
    }),
  );
  router.post(
    "/reauthenticate",
    guards.origin,
    guards.authenticate,
    asyncRoute(async (req, res) => {
      const b = parse(schemas.reauthenticate, req);
      await accountLimit("reauthenticate", req.auth!.user.id);
      if (!(await passwords.verify(req.auth!.user.passwordHash, b.password)))
        throw new HttpError(401, "Invalid credentials");
      const updated = await repo.db.session.updateMany({
        where: {
          id: req.auth!.session.id,
          revokedAt: null,
          authVersion: req.auth!.user.authVersion,
          user: { authVersion: req.auth!.user.authVersion, status: "active" },
        },
        data: { authenticatedAt: new Date() },
      });
      if (!updated.count) throw new HttpError(401, "Authentication required");
      res.sendStatus(204);
    }),
  );
  return { router, guards };
}
