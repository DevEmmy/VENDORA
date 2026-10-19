import { z } from 'zod';
import { inventorySchemas } from './inventory.schemas';
import { salesSchemas } from './sales.schemas';

const entityId = z.uuid();
const operation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('product.create'), body: inventorySchemas.create }).strict(),
  z.object({ action: z.literal('product.update'), entityId, body: inventorySchemas.update }).strict(),
  z.object({ action: z.literal('product.delete'), entityId, body: inventorySchemas.remove }).strict(),
  z.object({ action: z.literal('stock.restock'), entityId, body: inventorySchemas.restock }).strict(),
  z.object({ action: z.literal('stock.count'), entityId, body: inventorySchemas.count }).strict(),
  z.object({ action: z.literal('sale.create'), body: salesSchemas.create }).strict(),
  z.object({ action: z.literal('sale.reverse'), entityId, body: salesSchemas.reverse }).strict(),
  z.object({ action: z.literal('sale.payment'), entityId, body: salesSchemas.payment }).strict(),
]);
export const pushSchema = z.object({ operations: z.array(operation).min(1).max(25) }).strict()
  .refine(value => new Set(value.operations.map(operation => operation.body.clientId)).size === value.operations.length, 'Operation IDs must be distinct')
  .refine(value => value.operations.reduce((sum, operation) => sum + (operation.action === 'sale.create' ? operation.body.items.length : 0), 0) <= 1000,
    'Batch exceeds 1000 sale lines');
export type SyncOperation = z.infer<typeof operation>;
