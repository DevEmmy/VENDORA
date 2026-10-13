import type { CookieOptions, Response } from "express";
import type { Config } from "./env";

export function cookiePolicy(config: Config) {
  const prefix = config.secureCookies ? "__Host-vendora-" : "vendora-dev-";
  const names = {
    access: prefix + "access",
    refresh: prefix + "refresh",
  };
  const options: CookieOptions = {
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  };
  return {
    names,
    options,
    clear(res: Response) {
      for (const name of Object.values(names)) res.clearCookie(name, options);
    },
    set(res: Response, access: string, refresh: string, expiresAt: Date) {
      res.cookie(names.access, access, { ...options, maxAge: 300_000 });
      res.cookie(names.refresh, refresh, {
        ...options,
        maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
      });
    },
  };
}
