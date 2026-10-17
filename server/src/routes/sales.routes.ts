import { Router } from "express";
import { z } from "zod";
import { asyncRoute, HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import { inventorySchemas } from "../schemas/inventory.schemas";
import { salesSchemas } from "../schemas/sales.schemas";
import { Authorization } from "../services/authorization.service";
import { requireRelational } from "../services/inventory-transaction";
import { saleJson } from "../services/sales-serialization";
import { createSale, createSaleBatch, ownedSale, recordRepayment, reverseSale, salesHistory } from "../services/sales.service";
import type { InventoryActor } from "../types/inventory";

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid sale request", "INVALID_INPUT", {
    fields: result.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  });
  return result.data;
}

export function salesRoutes(repo: AuthRepository) {
  const router = Router();
  const authorization = new Authorization(repo);
  const scope = async (auth: Parameters<Authorization["business"]>[0], requested: string | undefined): Promise<InventoryActor> => {
    const membership = await authorization.business(auth, "sales:write", requested);
    return { businessId: membership.businessId, userId: auth.user.id };
  };
  router.post("/api/sales", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const body: unknown = req.body;
    if (body && typeof body === "object" && "sales" in body) {
      const result = await createSaleBatch(repo.db, actor, parse(salesSchemas.batch, body));
      res.status(result.duplicate ? 200 : 201).json({ ...result.result, duplicate: result.duplicate });
    } else {
      const result = await createSale(repo.db, actor, parse(salesSchemas.create, body));
      res.status(result.duplicate ? 200 : 201).json({ ...result.result, duplicate: result.duplicate });
    }
  }));
  router.get("/api/sales", asyncRoute(async (req, res, next) => {
    // Preserve the snapshot API for shops not cut over yet, including old clients.
    const membership = await authorization.business(req.auth!, "sales:write", req.get("x-business-id"));
    if (membership.business.inventoryMode !== "RELATIONAL") return next();
    const actor = { businessId: membership.businessId, userId: req.auth!.user.id };
    res.json(await salesHistory(repo.db, actor, parse(salesSchemas.list, req.query)));
  }));
  router.get("/api/sales/:id", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    await requireRelational(repo.db, actor.businessId);
    res.json({ sale: saleJson(await ownedSale(repo.db, actor.businessId, parse(inventorySchemas.id, req.params.id))) });
  }));
  router.post("/api/sales/:id/reverse", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const result = await reverseSale(repo.db, actor, parse(inventorySchemas.id, req.params.id), parse(salesSchemas.reverse, req.body));
    res.json({ ...result.result, duplicate: result.duplicate });
  }));
  router.post("/api/sales/:id/payments", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const result = await recordRepayment(repo.db, actor, parse(inventorySchemas.id, req.params.id), parse(salesSchemas.payment, req.body));
    res.json({ ...result.result, duplicate: result.duplicate });
  }));
  return router;
}
