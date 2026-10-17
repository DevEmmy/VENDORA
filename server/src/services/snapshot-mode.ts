import type { PrismaClient, InventoryMode } from '../generated/prisma/client';
import type { Transaction } from '../repositories/auth.repository';
import { HttpError } from '../middleware/error-handler';

export async function requireSnapshot(tx: Transaction | PrismaClient, businessId: string) {
  const business = await tx.business.findUnique({ where: { id: businessId }, select: { inventoryMode: true } });
  if (business) assertSnapshotMode(business.inventoryMode);
}
export function assertSnapshotMode(mode: InventoryMode) {
  if (mode === 'RELATIONAL')
    throw new HttpError(410, 'Inventory has moved to the current Vendora sync API. Update this client.', 'SNAPSHOT_RETIRED');
}
