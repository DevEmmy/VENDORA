import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// One-service deploy: the server also hands out the website (web/dist), so the site and /api share
// one address and the Strict login cookies just work. Only on with SERVE_WEB=true and a built website.
const API = /^\/(api|wema|whatsapp|health)(\/|$)/i;

// The website needs a little more than the API's locked-down default: OCR runs WebAssembly in a
// blob worker, and voice audio comes from YarnGPT.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://api.yarngpt.ai https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob: https://api.yarngpt.ai",
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function webDist(): string | undefined {
  if (process.env.SERVE_WEB !== "true") return undefined;
  const dir = resolve(process.env.WEB_DIST ?? join(__dirname, "..", "..", "web", "dist"));
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

export function serveWebsite(app: Express, dir: string) {
  const site = express.static(dir, {
    index: false,
    setHeaders(res, file) {
      res.setHeader("Content-Security-Policy", SITE_CSP);
      // Hashed build files can be cached for a long time; the page and service worker must stay fresh.
      res.setHeader(
        "Cache-Control",
        file.includes(`${join(dir, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache",
      );
    },
  });
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || API.test(req.path)) return next();
    site(req, res, () => {
      // Anything else that looks like a page gets the app shell (single-page app).
      if (!req.accepts("html")) return next();
      res.setHeader("Content-Security-Policy", SITE_CSP);
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(join(dir, "index.html"));
    });
  });
}
