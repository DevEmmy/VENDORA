import type { Prisma } from "../generated/prisma/client";
import { lineTotalKobo } from "./money";

export const saleInclude = {
  items: { include: { product: true }, orderBy: { id: "asc" } },
  customer: true, payments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.SaleInclude;
export type SaleRecord = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export function saleJson(sale: SaleRecord) {
  const repayments = sale.payments.reduce((sum, payment) => sum + payment.amount, 0n);
  return {
    id: sale.id, clientId: sale.clientId, legacyId: sale.legacyId, invoiceNo: sale.invoiceNo,
    status: sale.status, reversedSaleId: sale.reversedSaleId, isReversal: sale.reversedSaleId !== null,
    total: sale.total.toString(), amountPaid: sale.amountPaid.toString(), checkoutPaid: (sale.amountPaid - repayments).toString(),
    outstanding: (sale.status === "COMPLETED" && !sale.reversedSaleId ? sale.total - sale.amountPaid : 0n).toString(),
    customer: sale.customer ? { id: sale.customer.id, clientId: sale.customer.clientId,
      legacyId: sale.customer.legacyId, name: sale.customer.name, phone: sale.customer.phone } : null,
    items: sale.items.map(item => ({ id: item.id, productId: item.productId,
      name: item.productName || item.product.name, unit: item.unit, quantity: item.quantity.toFixed(3),
      unitPrice: item.unitPrice.toString(), lineTotal: lineTotalKobo(item.unitPrice, item.quantity).toString() })),
    payments: sale.payments.map(payment => ({ id: payment.id, clientId: payment.clientId, amount: payment.amount.toString(),
      createdById: payment.createdById, createdAt: payment.createdAt.toISOString() })),
    createdById: sale.createdById, source: sale.source, metadata: sale.metadata,
    syncSeq: sale.syncSeq.toString(), createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(), deletedAt: sale.deletedAt?.toISOString() ?? null,
  };
}
export type SaleView = ReturnType<typeof saleJson>;
