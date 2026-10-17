import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type StockMovementType } from "../generated/prisma/client";
import { HttpError } from "../middleware/error-handler";
import type { Transaction } from "../repositories/auth.repository";
import type { CreateProduct, UpdateProduct } from "../schemas/inventory.schemas";
import type { InventoryActor, OperationOutcome } from "../types/inventory";
import { inventoryJson, inventoryOperation, nextInventorySeq, requireRelational } from "./inventory-transaction";
import { movementJson, productJson } from "./inventory-serialization";

export async function activeProduct(tx: Transaction | PrismaClient, businessId: string, id: string) {
  const product = await tx.product.findFirst({ where: { businessId, id, deletedAt: null } });
  if (!product) throw new HttpError(404, "Not found");
  return product;
}

export async function publishProduct(tx: Transaction, businessId: string, id: string) {
  const seq = await nextInventorySeq(tx, businessId);
  const product = await tx.product.update({ where: { businessId_id: { businessId, id } }, data: { syncSeq: seq } });
  await tx.syncChange.create({ data: { businessId, seq, entity: "product", entityId: id,
    payload: inventoryJson(productJson(product)) } });
  return product;
}

interface MovementBase {
  clientId: string; productId: string; source: string;
  metadata?: Prisma.InputJsonObject; referenceId?: string; saleId?: string;
}
export type MovementInput = MovementBase & (
  { type: "COUNT_CORRECTION"; countedQty: Prisma.Decimal; observedQty: Prisma.Decimal } |
  { type: Exclude<StockMovementType, "COUNT_CORRECTION">; quantity: Prisma.Decimal }
);
export interface MovementResult {
  product: ReturnType<typeof productJson>;
  movement: ReturnType<typeof movementJson>;
}

async function moveInTransaction(tx: Transaction, actor: InventoryActor, input: MovementInput): Promise<MovementResult> {
  await tx.$queryRaw`SELECT id FROM vendora.products WHERE business_id=${actor.businessId}::uuid AND id=${input.productId}::uuid FOR UPDATE`;
  const before = await activeProduct(tx, actor.businessId, input.productId);
  const delta = input.type === "COUNT_CORRECTION" ? input.countedQty.minus(input.observedQty) : input.quantity;
  const after = before.stockQty.plus(delta);
  if (!delta.isFinite() || delta.decimalPlaces() > 3 || !after.isFinite() || after.abs().gt("999999999.999"))
    throw new HttpError(409, "Quantity exceeds the supported range", "QUANTITY_LIMIT");
  if (after.lt(0)) throw new HttpError(409, "Insufficient stock", "INSUFFICIENT_STOCK",
    { productId: before.id, availableQuantity: before.stockQty.toFixed(3) });
  await tx.product.update({ where: { businessId_id: { businessId: actor.businessId, id: before.id } }, data: { stockQty: after } });
  const product = await publishProduct(tx, actor.businessId, before.id);
  const seq = await nextInventorySeq(tx, actor.businessId);
  const movement = await tx.stockMovement.create({ data: {
    businessId: actor.businessId, productId: before.id, type: input.type,
    quantity: delta, quantityBefore: before.stockQty, quantityAfter: after,
    source: input.source, clientId: input.clientId, createdById: actor.userId,
    referenceId: input.referenceId ?? null, saleId: input.saleId ?? null,
    metadata: input.metadata ?? {}, syncSeq: seq,
  } });
  await tx.syncChange.create({ data: { businessId: actor.businessId, seq, entity: "movement", entityId: movement.id,
    payload: inventoryJson(movementJson(movement)) } });
  if (before.stockQty.gt(before.lowStockAt) && after.lte(before.lowStockAt)) {
    const existing = await tx.notification.findFirst({ where: { businessId: actor.businessId, productId: before.id, readAt: null } });
    if (!existing) await tx.notification.create({ data: { businessId: actor.businessId, productId: before.id,
      type: "LOW_STOCK", message: `Low stock: ${before.name} has ${after.toString()} ${before.unit} left.` } });
  }
  return { product: productJson(product), movement: movementJson(movement) };
}

// Every live quantity change enters here. An existing transaction lets product
// creation and (in M5) an entire sale share one atomic unit; no nested commit.
export async function applyStockMovement(db: PrismaClient, actor: InventoryActor, input: MovementInput,
  transaction?: Transaction): Promise<OperationOutcome<MovementResult>> {
  if (transaction) return { result: await moveInTransaction(transaction, actor, input), duplicate: false };
  return inventoryOperation(db, actor, { clientId: input.clientId, action: `stock.${input.type.toLowerCase()}`,
    payload: input, metadata: input.metadata ?? {} }, tx => moveInTransaction(tx, actor, input));
}

export function createProduct(db: PrismaClient, actor: InventoryActor, input: CreateProduct) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "product.create", payload: input,
    metadata: { ...input.metadata, source: input.source } }, async tx => {
    const product = await tx.product.create({ data: { businessId: actor.businessId,
      name: input.name, unit: input.unit, aliases: input.aliases, unitPrice: input.unitPrice,
      costPrice: input.costPrice, lowStockAt: input.lowStockAt, stockQty: 0,
      clientId: input.clientId, createdById: actor.userId } });
    if (input.openingQty.gt(0)) {
      const opened = await applyStockMovement(db, actor, { clientId: randomUUID(), productId: product.id,
        type: "OPENING", quantity: input.openingQty, source: input.source,
        referenceId: input.clientId, metadata: input.metadata }, tx);
      return { product: opened.result.product };
    }
    return { product: productJson(await publishProduct(tx, actor.businessId, product.id)) };
  });
}

export function updateProduct(db: PrismaClient, actor: InventoryActor, id: string, input: UpdateProduct) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "product.update", payload: { id, ...input },
    metadata: { ...input.metadata, source: input.source } }, async tx => {
    await activeProduct(tx, actor.businessId, id);
    const data: Prisma.ProductUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.aliases !== undefined) data.aliases = input.aliases;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.costPrice !== undefined) data.costPrice = input.costPrice;
    if (input.lowStockAt !== undefined) data.lowStockAt = input.lowStockAt;
    await tx.product.update({ where: { businessId_id: { businessId: actor.businessId, id } }, data });
    return { product: productJson(await publishProduct(tx, actor.businessId, id)) };
  });
}

export function removeProduct(db: PrismaClient, actor: InventoryActor, id: string,
  input: { clientId: string; metadata: Prisma.InputJsonObject; source: string }) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "product.delete", payload: { id, ...input },
    metadata: { ...input.metadata, source: input.source } }, async tx => {
    await activeProduct(tx, actor.businessId, id);
    await tx.product.update({ where: { businessId_id: { businessId: actor.businessId, id } }, data: { deletedAt: new Date() } });
    return { product: productJson(await publishProduct(tx, actor.businessId, id)) };
  });
}

export async function inventoryChanges(db: PrismaClient, actor: InventoryActor, since: bigint, limit: number) {
  return db.$transaction(async tx => {
    const business = await requireRelational(tx, actor.businessId);
    if (since > business.syncSeq) throw new HttpError(409, "Sync cursor is ahead of this business", "CURSOR_AHEAD",
      { head: business.syncSeq.toString() });
    const rows = await tx.syncChange.findMany({ where: { businessId: actor.businessId,
      seq: { gt: since, lte: business.syncSeq } }, orderBy: { seq: "asc" }, take: limit + 1 });
    const page = rows.slice(0, limit);
    const changes = page.map(row => ({ seq: row.seq.toString(), entity: row.entity, entityId: row.entityId, data: row.payload }));
    return { changes, products: changes.filter(change => change.entity === "product").map(change => change.data),
      sales: changes.filter(change => change.entity === "sale").map(change => change.data),
      movements: changes.filter(change => change.entity === "movement").map(change => change.data),
      nextCursor: page.at(-1)?.seq.toString() ?? since.toString(), hasMore: rows.length > limit };
  }, { isolationLevel: "RepeatableRead" });
}
