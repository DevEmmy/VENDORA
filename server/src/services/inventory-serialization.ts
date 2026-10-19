import type { Product, StockMovement } from "../generated/prisma/client";

export function productJson(product: Product) {
  return {
    id: product.id, clientId: product.clientId, legacyId: product.legacyId,
    name: product.name, unit: product.unit, aliases: product.aliases,
    unitPrice: product.unitPrice.toString(), costPrice: product.costPrice?.toString() ?? null,
    currentQty: product.stockQty.toFixed(3), lowStockAt: product.lowStockAt.toFixed(3),
    createdById: product.createdById, syncSeq: product.syncSeq.toString(),
    createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt.toISOString(),
    deletedAt: product.deletedAt?.toISOString() ?? null,
  };
}

export function movementJson(movement: StockMovement) {
  return {
    id: movement.id, productId: movement.productId, saleId: movement.saleId,
    type: movement.type, quantity: movement.quantity.toFixed(3),
    quantityBefore: movement.quantityBefore.toFixed(3), quantityAfter: movement.quantityAfter.toFixed(3),
    source: movement.source, referenceId: movement.referenceId, createdById: movement.createdById,
    clientId: movement.clientId, legacyId: movement.legacyId, oversold: movement.oversold,
    metadata: movement.metadata, syncSeq: movement.syncSeq.toString(),
    createdAt: movement.createdAt.toISOString(), updatedAt: movement.updatedAt.toISOString(), deletedAt: null,
  };
}
