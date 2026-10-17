import type { PrismaClient } from '../generated/prisma/client';
import type { SyncOperation } from '../schemas/sync.schemas';
import type { InventoryActor, OperationOutcome } from '../types/inventory';
import { applyStockMovement, createProduct, removeProduct, updateProduct } from './inventory.service';
import { createSale, recordRepayment, reverseSale } from './sales.service';

export function executeSyncAction(db: PrismaClient, actor: InventoryActor, operation: SyncOperation): Promise<OperationOutcome<object>> {
  switch (operation.action) {
    case 'product.create': return createProduct(db, actor, operation.body);
    case 'product.update': return updateProduct(db, actor, operation.entityId, operation.body);
    case 'product.delete': return removeProduct(db, actor, operation.entityId, operation.body);
    case 'sale.create': return createSale(db, actor, operation.body);
    case 'sale.reverse': return reverseSale(db, actor, operation.entityId, operation.body);
    case 'sale.payment': return recordRepayment(db, actor, operation.entityId, operation.body);
    case 'stock.restock': {
      const body = operation.body;
      return applyStockMovement(db, actor, { clientId: body.clientId, productId: operation.entityId,
        type: 'RESTOCK', quantity: body.quantity, source: body.source, metadata: body.metadata,
        ...(body.legacyId ? { legacyId: body.legacyId } : {}), ...(body.at !== undefined ? { at: new Date(body.at) } : {}) });
    }
    case 'stock.count': {
      const body = operation.body;
      return applyStockMovement(db, actor, { clientId: body.clientId, productId: operation.entityId,
        type: 'COUNT_CORRECTION', countedQty: body.countedQty, observedQty: body.observedQty, source: body.source,
        metadata: { ...body.metadata, reason: body.reason, countedQty: body.countedQty.toFixed(3), observedQty: body.observedQty.toFixed(3) },
        ...(body.legacyId ? { legacyId: body.legacyId } : {}), ...(body.at !== undefined ? { at: new Date(body.at) } : {}) });
    }
  }
}
