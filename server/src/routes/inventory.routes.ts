import { Router } from "express";
import { z } from "zod";
import { asyncRoute, HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import { inventorySchemas } from "../schemas/inventory.schemas";
import { Authorization } from "../services/authorization.service";
import { productJson } from "../services/inventory-serialization";
import { requireRelational } from "../services/inventory-transaction";
import { activeProduct, applyStockMovement, createProduct, inventoryChanges, removeProduct, updateProduct } from "../services/inventory.service";
import type { InventoryActor, OperationOutcome } from "../types/inventory";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid inventory request", "INVALID_INPUT", {
    fields: result.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  });
  return result.data;
}

export function inventoryRoutes(repo: AuthRepository) {
  const router = Router();
  const authorization = new Authorization(repo);
  const scope = async (auth: Parameters<Authorization["business"]>[0], requested: string | undefined): Promise<InventoryActor> => {
    const membership = await authorization.business(auth, "sales:write", requested);
    return { businessId: membership.businessId, userId: auth.user.id };
  };
  const outcome = <T extends object>(value: OperationOutcome<T>) => ({ ...value.result, duplicate: value.duplicate });
  router.post("/api/products", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const result = await createProduct(repo.db, actor, parse(inventorySchemas.create, req.body));
    res.status(result.duplicate ? 200 : 201).json(outcome(result));
  }));
  router.get("/api/products", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    await requireRelational(repo.db, actor.businessId);
    const query = parse(inventorySchemas.list, req.query);
    const products = await repo.db.product.findMany({ where: { businessId: actor.businessId,
      ...(query.includeDeleted === "true" ? {} : { deletedAt: null }),
      ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}) },
      orderBy: { id: "asc" }, take: query.limit });
    res.json({ products: products.map(productJson) });
  }));
  router.get("/api/products/:id", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    await requireRelational(repo.db, actor.businessId);
    res.json({ product: productJson(await activeProduct(repo.db, actor.businessId, parse(inventorySchemas.id, req.params.id))) });
  }));
  router.patch("/api/products/:id", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    res.json(outcome(await updateProduct(repo.db, actor, parse(inventorySchemas.id, req.params.id), parse(inventorySchemas.update, req.body))));
  }));
  router.delete("/api/products/:id", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    res.json(outcome(await removeProduct(repo.db, actor, parse(inventorySchemas.id, req.params.id), parse(inventorySchemas.remove, req.body))));
  }));
  router.post("/api/products/:id/restock", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const body = parse(inventorySchemas.restock, req.body);
    res.json(outcome(await applyStockMovement(repo.db, actor, { ...body,
      productId: parse(inventorySchemas.id, req.params.id), type: "RESTOCK" })));
  }));
  router.post("/api/products/:id/count", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const body = parse(inventorySchemas.count, req.body);
    res.json(outcome(await applyStockMovement(repo.db, actor, { clientId: body.clientId,
      productId: parse(inventorySchemas.id, req.params.id), type: "COUNT_CORRECTION",
      countedQty: body.countedQty, observedQty: body.observedQty, source: body.source,
      metadata: { ...body.metadata, reason: body.reason, countedQty: body.countedQty.toFixed(3), observedQty: body.observedQty.toFixed(3) } })));
  }));
  router.get("/api/sync/changes", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    const query = parse(inventorySchemas.changes, req.query);
    res.json(await inventoryChanges(repo.db, actor, query.since, query.limit));
  }));
  router.get("/api/notifications", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    await requireRelational(repo.db, actor.businessId);
    const query = parse(inventorySchemas.notifications, req.query);
    const notifications = await repo.db.notification.findMany({ where: { businessId: actor.businessId,
      product: { deletedAt: null }, ...(query.unread === "true" ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ notifications });
  }));
  router.post("/api/notifications/:id/read", asyncRoute(async (req, res) => {
    const actor = await scope(req.auth!, req.get("x-business-id"));
    await requireRelational(repo.db, actor.businessId);
    parse(z.object({}).strict(), req.body);
    const result = await repo.db.notification.updateMany({ where: { businessId: actor.businessId,
      id: parse(inventorySchemas.id, req.params.id), readAt: null }, data: { readAt: new Date() } });
    if (!result.count && !await repo.db.notification.findFirst({ where: { businessId: actor.businessId,
      id: parse(inventorySchemas.id, req.params.id) } })) throw new HttpError(404, "Not found");
    res.json({ ok: true });
  }));
  return router;
}
