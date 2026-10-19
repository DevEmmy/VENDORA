import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient, type Customer } from "../generated/prisma/client";
import { HttpError } from "../middleware/error-handler";
import type { Transaction } from "../repositories/auth.repository";
import type { CreateSale, Repayment, ReverseSale, SaleBatch, SalesQuery } from "../schemas/sales.schemas";
import type { InventoryActor } from "../types/inventory";
import { activeProduct, applyStockMovement, ownedProduct } from "./inventory.service";
import { inventoryJson, inventoryOperation, nextInventorySeq, requireRelational } from "./inventory-transaction";
import { lagosDayRange } from "./lagos-time";
import { lineTotalKobo, MAX_KOBO } from "./money";
import { saleInclude, saleJson, type SaleView } from "./sales-serialization";

export async function ownedSale(tx: Transaction | PrismaClient, businessId: string, id: string) {
  const sale = await tx.sale.findFirst({ where: { businessId, id, deletedAt: null }, include: saleInclude });
  if (!sale) throw new HttpError(404, "Not found");
  return sale;
}

export async function publishSale(tx: Transaction, businessId: string, id: string) {
  const seq = await nextInventorySeq(tx, businessId);
  const sale = await tx.sale.update({ where: { businessId_id: { businessId, id } },
    data: { syncSeq: seq }, include: saleInclude });
  await tx.syncChange.create({ data: { businessId, seq, entity: "sale", entityId: id,
    payload: inventoryJson(saleJson(sale)) } });
  return saleJson(sale);
}

async function invoice(tx: Transaction, businessId: string, prefix = "INV") {
  const business = await tx.business.update({ where: { id: businessId }, data: { invoiceSeq: { increment: 1 } }, select: { invoiceSeq: true } });
  return `${prefix}-${business.invoiceSeq.toString().padStart(5, "0")}`;
}

async function customerForSale(tx: Transaction, actor: InventoryActor, input: CreateSale): Promise<Customer | null> {
  if (input.customerId) {
    const customer = await tx.customer.findFirst({ where: { businessId: actor.businessId, id: input.customerId } });
    if (!customer) throw new HttpError(404, "Not found");
    return customer;
  }
  if (!input.customer) return null;
  const clientId = input.customer.clientId;
  const existing = clientId ? await tx.customer.findUnique({ where: {
    businessId_clientId: { businessId: actor.businessId, clientId },
  } }) : null;
  if (existing) return existing;
  return tx.customer.create({ data: { businessId: actor.businessId, clientId: clientId ?? null,
    name: input.customer.name, phone: input.customer.phone ?? null } });
}

export function createSale(db: PrismaClient, actor: InventoryActor, input: CreateSale, transaction?: Transaction) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "sale.create", payload: input,
    metadata: { ...input.metadata, source: input.source, fromOffline: input.fromOffline } }, async tx => {
    const lines: { id: string; productId: string; productName: string;
      unit: string; quantity: Prisma.Decimal; unitPrice: bigint }[] = [];
    for (const item of input.items) {
      const product = await (input.fromOffline ? ownedProduct(tx, actor.businessId, item.productId) : activeProduct(tx, actor.businessId, item.productId));
      const unitPrice = item.unitPrice ?? product.unitPrice;
      lines.push({ id: randomUUID(), productId: product.id,
        productName: product.name, unit: product.unit, quantity: item.quantity, unitPrice });
    }
    const total = lines.reduce((sum, item) => sum + lineTotalKobo(item.unitPrice, item.quantity), 0n);
    if (total > MAX_KOBO) throw new HttpError(400, "Sale total exceeds supported money range", "MONEY_LIMIT");
    const initialPaid = input.amountPaid ?? (input.payments.length ? 0n : total);
    const amountPaid = initialPaid + input.payments.reduce((sum, payment) => sum + payment.amount, 0n);
    if (amountPaid > total) throw new HttpError(400, "Amount paid exceeds the sale total", "INVALID_PAYMENT");
    if (input.legacyId) {
      const previous = await tx.sale.findUnique({ where: { businessId_legacyId: { businessId: actor.businessId, legacyId: input.legacyId } }, include: saleInclude });
      if (previous) {
        const signature = (items: { productId: string; quantity: Prisma.Decimal; unitPrice: bigint }[]) =>
          items.map(item => `${item.productId}:${item.quantity.toString()}:${item.unitPrice}`).sort().join('|');
        const tender = previous.amountPaid - previous.payments.reduce((sum, payment) => sum + payment.amount, 0n);
        if (signature(previous.items) !== signature(lines) || previous.total !== total || tender !== initialPaid || input.payments.length)
          throw new HttpError(409, 'Legacy sale details differ from the saved record', 'LEGACY_CONFLICT');
        return { sale: saleJson(previous), legacyMatched: true };
      }
    }
    const customer = await customerForSale(tx, actor, input);
    const recordedAt = new Date();
    const sale = await tx.sale.create({ data: {
      clientId: input.clientId, legacyId: input.legacyId ?? null, businessId: actor.businessId,
      invoiceNo: await invoice(tx, actor.businessId), total, amountPaid, customerId: customer?.id ?? null,
      createdById: actor.userId, createdAt: input.at === undefined ? recordedAt : new Date(input.at),
      source: input.source, metadata: { ...input.metadata, fromOffline: input.fromOffline, recordedAt: recordedAt.toISOString() },
      items: { create: lines }, payments: { create: input.payments.map(payment => ({
        clientId: payment.clientId, amount: payment.amount, createdById: actor.userId,
        createdAt: payment.at === undefined ? recordedAt : new Date(payment.at),
      })) },
    } });
    for (const item of lines) await applyStockMovement(db, actor, { clientId: randomUUID(),
      productId: item.productId, type: "SALE", quantity: item.quantity.negated(), source: input.source,
      referenceId: sale.id, saleId: sale.id, allowNegative: input.fromOffline,
      metadata: { ...input.metadata, fromOffline: input.fromOffline } }, tx);
    return { sale: await publishSale(tx, actor.businessId, sale.id) };
  }, transaction);
}

export function createSaleBatch(db: PrismaClient, actor: InventoryActor, input: SaleBatch) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "sale.batch", payload: input, metadata: input.metadata }, async tx => {
    const sales: SaleView[] = [];
    for (const item of input.sales) sales.push((await createSale(db, actor, item, tx)).result.sale);
    return { sales };
  });
}

export function reverseSale(db: PrismaClient, actor: InventoryActor, id: string, input: ReverseSale) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "sale.reverse", payload: { id, ...input },
    metadata: { ...input.metadata, reason: input.reason } }, async tx => {
    await tx.$queryRaw`SELECT id FROM vendora.sales WHERE business_id=${actor.businessId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const original = await ownedSale(tx, actor.businessId, id);
    if (original.status === "REVERSED" || original.reversedSaleId)
      throw new HttpError(409, "This sale is already reversed or is a reversal", "ALREADY_REVERSED");
    const reversal = await tx.sale.create({ data: {
      clientId: input.clientId, businessId: actor.businessId,
      reversedSaleId: original.id, invoiceNo: await invoice(tx, actor.businessId, "CN"),
      total: original.total, amountPaid: original.amountPaid, customerId: original.customerId,
      createdById: actor.userId, source: input.source, metadata: { ...input.metadata, reason: input.reason },
      items: { create: original.items.map(item => ({ productId: item.productId,
        productName: item.productName || item.product.name, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice })) },
    } });
    for (const item of original.items) await applyStockMovement(db, actor, { clientId: randomUUID(),
      productId: item.productId, type: "SALE_REVERSAL", quantity: item.quantity, source: input.source,
      referenceId: original.id, saleId: reversal.id, metadata: { ...input.metadata, reason: input.reason } }, tx);
    await tx.sale.update({ where: { businessId_id: { businessId: actor.businessId, id } }, data: { status: "REVERSED" } });
    return { sale: await publishSale(tx, actor.businessId, id), reversal: await publishSale(tx, actor.businessId, reversal.id) };
  });
}

export function recordRepayment(db: PrismaClient, actor: InventoryActor, id: string, input: Repayment) {
  return inventoryOperation(db, actor, { clientId: input.clientId, action: "sale.payment", payload: { id, ...input }, metadata: input.metadata }, async tx => {
    await tx.$queryRaw`SELECT id FROM vendora.sales WHERE business_id=${actor.businessId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const sale = await ownedSale(tx, actor.businessId, id);
    if (sale.status !== "COMPLETED" || sale.reversedSaleId) throw new HttpError(409, "Cannot repay a reversed sale", "SALE_REVERSED");
    const remaining = sale.total - sale.amountPaid;
    if (input.amount > remaining) throw new HttpError(409, "Payment exceeds the outstanding amount", "OVERPAYMENT", { outstanding: remaining.toString() });
    await tx.payment.create({ data: { clientId: input.clientId, businessId: actor.businessId,
      saleId: id, amount: input.amount, createdById: actor.userId,
      createdAt: input.at === undefined ? new Date() : new Date(input.at) } });
    await tx.sale.update({ where: { businessId_id: { businessId: actor.businessId, id } }, data: { amountPaid: { increment: input.amount } } });
    return { sale: await publishSale(tx, actor.businessId, id) };
  });
}

const cursorSchema = z.object({ at: z.string().datetime(), id: z.uuid() }).strict();
function decodeCursor(value: string) {
  try { return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }
  catch { throw new HttpError(400, "Invalid sales cursor", "INVALID_CURSOR"); }
}

export async function salesHistory(db: PrismaClient, actor: InventoryActor, query: SalesQuery) {
  await requireRelational(db, actor.businessId);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const where: Prisma.SaleWhereInput = { businessId: actor.businessId, deletedAt: null,
    ...(query.from || query.to ? { createdAt: {
      ...(query.from ? { gte: lagosDayRange(query.from).start } : {}),
      ...(query.to ? { lt: lagosDayRange(query.to).end } : {}),
    } } : {}),
    ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.at) } },
      { createdAt: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
  };
  const rows = await db.sale.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1, include: saleInclude });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return { sales: page.map(saleJson), hasMore: rows.length > query.limit,
    nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString("base64url") : null };
}
