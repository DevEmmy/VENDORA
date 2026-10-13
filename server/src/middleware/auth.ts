import type { Request, RequestHandler } from "express";
import type { cookiePolicy } from "../config/cookies";
import type { Config } from "../config/env";
import type { Sessions } from "../services/session.service";
import { HttpError, asyncRoute } from "./error-handler";

export function cookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === "string" && value.length <= 4096 ? value : undefined;
}

export function createGuards(
  config: Config,
  policy: ReturnType<typeof cookiePolicy>,
  sessions: Sessions,
) {
  const origin: RequestHandler = (req, _res, next) => {
    const source = req.get("origin");
    // API clients such as Postman do not send an Origin header.
    if (source && !config.origins.includes(source))
      return next(new HttpError(403, "Untrusted origin"));
    if (!req.is("application/json"))
      return next(new HttpError(415, "JSON required"));
    next();
  };
  const authenticate = asyncRoute(async (req, _res, next) => {
    const value = cookie(req, policy.names.access);
    if (!value) throw new HttpError(401, "Authentication required");
    req.auth = await sessions.authenticate(value);
    next();
  });
  return { origin, authenticate };
}
