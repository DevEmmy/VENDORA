import type { RequestHandler } from "express";
import { z } from "zod";
import type { LegacyStore } from "../adapters/legacy";
import type { Config } from "../config/env";
import { asyncRoute, HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import { phone } from "../schemas/auth.schemas";
import { Authorization } from "../services/authorization.service";

const amount = z.number().finite().nonnegative();
const text = z.string().max(200);
const inventory = z
  .object({
    id: text,
    name: text,
    aliases: z.array(text).max(20).default([]),
    unit: text,
    price: amount,
    qty: amount,
    lowAt: amount.optional(),
  })
  .strict();
const customer = z.object({ id: text, name: text, balance: amount }).strict();
export const syncSchema = z
  .object({
    phone: phone.optional(),
    profile: z
      .object({
        name: text.optional(),
        businessName: text.optional(),
        language: z.enum(["en", "pcm", "yo", "ig", "ha"]).optional(),
        whatsappAlerts: z.boolean().optional(),
      })
      .strict()
      .default({}),
    inventory: z.array(inventory).max(5000).default([]),
    customers: z.array(customer).max(5000).default([]),
    ackedThrough: z.number().int().nonnegative().default(0),
    creditsSince: amount.default(0),
    ledgerHead: z
      .object({
        seq: z.number().int().nonnegative(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        sig: z.string().max(2000).optional(),
        key: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const submissionSchema = z
  .object({
    phone: phone.optional(),
    accountNumber: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
    file: z
      .string()
      .max(12_000_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileName: z.string().max(120).optional(),
    from: amount.optional(),
    to: amount.optional(),
    invoices: z.number().int().nonnegative().optional(),
    total: amount.optional(),
  })
  .strict();
export function businessGuard(
  repo: AuthRepository,
  store: LegacyStore,
  config: Config,
): RequestHandler {
  const authorization = new Authorization(repo);
  return asyncRoute(async (req, _res, next) => {
    // Match Express's case-insensitive, trailing-slash-tolerant route semantics.
    const path = req.path.toLowerCase().replace(/\/+$/, "");
    const permission = path.startsWith("/wema")
      ? req.method === "GET"
        ? "bank:read"
        : "bank:write"
      : path === "/api/submissions"
        ? "submissions:write"
        : "sales:write";
    const membership = await authorization.business(
      req.auth!,
      permission,
      req.get("x-business-id"),
    );
    _res.locals.membership = membership;
    const ownerPhone = membership.business.phone;
    const raw: unknown = req.body;
    const body = z.record(z.string(), z.unknown()).safeParse(raw ?? {});
    if (!body.success) throw new HttpError(400, "Invalid request");
    req.body = body.data;
    if (body.data.phone !== undefined) {
      const supplied = phone.safeParse(body.data.phone);
      if (!supplied.success || supplied.data !== ownerPhone)
        throw new HttpError(403, "Identity mismatch");
    }
    if (req.query.phone !== undefined) {
      const supplied = phone.safeParse(req.query.phone);
      if (!supplied.success || supplied.data !== ownerPhone)
        throw new HttpError(403, "Identity mismatch");
    }
    if (path === "/api/sync") {
      const result = syncSchema.safeParse(req.body);
      if (!result.success) throw new HttpError(400, "Invalid sync request");
      req.body = { ...result.data, phone: ownerPhone };
    } else if (path === "/api/submissions") {
      if (req.method === "POST") {
        const result = submissionSchema.safeParse(req.body);
        if (!result.success) throw new HttpError(400, "Invalid submission");
        if (result.data.accountNumber)
          await repo.ownership(
            membership.businessId,
            "account",
            result.data.accountNumber,
          );
        req.body = { ...result.data, phone: ownerPhone };
      }
      req.query.phone = ownerPhone;
    } else if (path === "/api/score" || path === "/wema/loans/offer") {
      throw new HttpError(503, "Verified financial records required");
    } else if (path.startsWith("/wema")) {
      if (path === "/wema/simulate/credit" && !config.devRoutes)
        throw new HttpError(404, "Not found");
      if (
        path === "/wema/accounts" ||
        path === "/wema/loans" ||
        /\/repay$/.test(path)
      )
        throw new HttpError(403, "Independent second factor required");
      const accountPath = /^\/wema\/accounts\/([^/]+)/.exec(path)?.[1];
      const ref = /^\/wema\/payment-requests\/([^/]+)$/.exec(path)?.[1];
      const account = accountPath ?? body.data.accountNumber;
      if (account !== undefined) {
        if (typeof account !== "string")
          throw new HttpError(400, "Invalid account");
        await repo.ownership(membership.businessId, "account", account);
      }
      if (ref)
        await repo.ownership(membership.businessId, "payment-request", ref);
      if (body.data.virtualAccountNumber !== undefined) {
        const pr = Object.values(store.data.paymentRequests).find(
          (p) => p.virtualAccountNumber === body.data.virtualAccountNumber,
        );
        if (!pr || typeof pr.ref !== "string")
          throw new HttpError(404, "Not found");
        await repo.ownership(membership.businessId, "payment-request", pr.ref);
      }
      if (req.method !== "GET" && config.NODE_ENV === "production")
        throw new HttpError(503, "Durable banking storage required");
      // Unimplemented financial writers remain closed, rather than creating unowned resources.
      if (path === "/wema/payment-requests" && req.method === "POST")
        throw new HttpError(503, "Durable payment storage required");
    } else if (path === "/api/tts") {
      const result = z
        .object({ text: z.string().min(1).max(1200) })
        .strict()
        .safeParse(req.body);
      if (!result.success) throw new HttpError(400, "Invalid voice request");
      req.body = result.data;
    }
    next();
  });
}
