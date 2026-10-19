import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { HttpError } from '../middleware/error-handler';
import { inventoryJson } from './inventory-transaction';
import { applyStockMovement, publishProduct } from './inventory.service';
import { publishSale } from './sales.service';
import { planSnapshotBackfill, type BackfillIssue } from './snapshot-backfill-plan';

export interface BackfillReport {
  businessId: string; dryRun: boolean; status: 'ready' | 'applied' | 'blocked' | 'already-relational';
  snapshotHash: string | null; issues: BackfillIssue[];
  counts: { products: number; customers: number; sales: number; movements: number; skipped: number };
  stockTotals: { legacyId: string; quantity: string }[];
}
class Blocked extends Error {
  constructor(public report: BackfillReport) { super('Snapshot requires reconciliation'); }
}

/** A single business transaction: dry-run validates only; failures never cut over. */
export async function backfillBusiness(db: PrismaClient, businessId: string,
  options: { dryRun?: boolean; actorId?: string } = {}): Promise<BackfillReport> {
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM vendora.businesses WHERE id=${businessId}::uuid FOR UPDATE`;
      const business = await tx.business.findUnique({ where: { id: businessId } });
      if (!business) throw new HttpError(404, 'Not found');
      if (options.actorId) {
        const member = await tx.membership.findUnique({ where: { userId_businessId: { userId: options.actorId, businessId } }, include: { user: true } });
        if (!member || member.status !== 'active' || member.user.status !== 'active' || !member.permissions.includes('sales:write'))
          throw new HttpError(403, 'Permission required');
      }
      if (business.inventoryMode === 'RELATIONAL') return {
        businessId, dryRun: options.dryRun === true, status: 'already-relational', snapshotHash: null,
        issues: [], counts: { products: 0, customers: 0, sales: 0, movements: 0, skipped: 0 }, stockTotals: [],
      };
      const snapshot = await tx.businessSnapshot.findUnique({ where: { businessId } });
      const plan = planSnapshotBackfill(snapshot?.state ?? {});
      const report: BackfillReport = { businessId, dryRun: options.dryRun === true, status: 'ready',
        snapshotHash: plan.hash, issues: plan.issues,
        counts: { products: plan.products.length, customers: plan.customers.length,
          sales: plan.sales.reduce((count, sale) => count + (sale.reversed ? 2 : 1), 0), movements: plan.movements.length, skipped: 0 },
        stockTotals: plan.products.map(p => ({ legacyId: p.legacyId, quantity: p.qty.toFixed(3) })) };
      const block = (code: string, message: string): never => {
        report.issues.push({ severity: 'error', code, path: 'database', message });
        report.status = 'blocked'; throw new Blocked(report);
      };
      if (report.issues.some(issue => issue.severity === 'error')) { report.status = 'blocked'; return report; }
      // Relational rows without a legacy key cannot be matched safely to a snapshot.
      if (await tx.product.count({ where: { businessId, legacyId: null } }) ||
          await tx.sale.count({ where: { businessId, legacyId: null } }))
        return block('MIXED_STORAGE', 'Unmapped relational rows already exist; reconcile them before cutover.');
      const existingProducts = await tx.product.findMany({ where: { businessId } });
      const existingMovements = await tx.stockMovement.findMany({ where: { businessId } });
      const movementByLegacy = new Map(existingMovements.map(movement => [movement.legacyId, movement]));
      // Simulate skipped receipts and pending deltas before the first write. Dry
      // runs therefore catch partially imported or conflicting relational data.
      for (const p of plan.products) {
        const existing = existingProducts.find(product => product.legacyId === p.legacyId);
        if (existing && (existing.name !== p.name || existing.unitPrice !== p.price || existing.unit !== p.unit))
          block('LEGACY_CONFLICT', `Product ${p.legacyId} differs from its saved legacy mapping.`);
        let pending = new Prisma.Decimal(0);
        for (const movement of plan.movements.filter(m => m.productId === p.legacyId)) {
          const saved = movementByLegacy.get(movement.legacyId);
          if (saved) {
            if (!saved.quantity.eq(movement.quantity) || saved.productId !== existing?.id || saved.type !== movement.type)
              block('LEGACY_CONFLICT', `Movement ${movement.legacyId} differs from its saved legacy mapping.`);
          } else pending = pending.plus(movement.quantity);
        }
        const storedLedger = existingMovements.filter(m => m.productId === existing?.id)
          .reduce((sum, movement) => sum.plus(movement.quantity), new Prisma.Decimal(0));
        if (!(existing?.stockQty ?? new Prisma.Decimal(0)).plus(pending).eq(p.qty) || !storedLedger.plus(pending).eq(p.qty))
          block('TOTAL_MISMATCH', `Stock/ledger total for ${p.legacyId} would not equal the snapshot.`);
      }
      if (options.dryRun) return report;
      const productIds = new Map<string, string>();
      const customerIds = new Map<string, string>();
      const saleIds = new Map<string, string>();
      for (const p of plan.products) {
        const existing = await tx.product.findUnique({ where: { businessId_legacyId: { businessId, legacyId: p.legacyId } } });
        if (existing) {
          if (existing.name !== p.name || existing.unitPrice !== p.price || existing.unit !== p.unit)
            block('LEGACY_CONFLICT', `Product ${p.legacyId} differs from its saved legacy mapping.`);
          productIds.set(p.legacyId, existing.id); report.counts.skipped++; continue;
        }
        const product = await tx.product.create({ data: { businessId, legacyId: p.legacyId,
          name: p.name, unit: p.unit, aliases: p.aliases, unitPrice: p.price, costPrice: p.cost,
          stockQty: 0, lowStockAt: p.lowAt, deletedAt: p.deleted ? new Date() : null } });
        productIds.set(p.legacyId, product.id);
      }
      for (const c of plan.customers) {
        const existing = await tx.customer.findUnique({ where: { businessId_legacyId: { businessId, legacyId: c.legacyId } } });
        const customer = existing ?? await tx.customer.create({ data: { businessId, ...c } });
        if (existing) report.counts.skipped++;
        customerIds.set(c.legacyId, customer.id);
      }
      for (const s of plan.sales) {
        const existing = await tx.sale.findUnique({ where: { businessId_legacyId: { businessId, legacyId: s.legacyId } } });
        if (existing && (existing.total !== s.total || existing.amountPaid !== s.paid))
          block('LEGACY_CONFLICT', `Sale ${s.legacyId} differs from its saved legacy mapping.`);
        const allocated = await tx.business.update({ where: { id: businessId }, data: { invoiceSeq: { increment: 1 } }, select: { invoiceSeq: true } });
        const sale = existing ?? await tx.sale.create({ data: { businessId, legacyId: s.legacyId,
          invoiceNo: `LEG-${allocated.invoiceSeq}`, customerId: s.customerId ? customerIds.get(s.customerId)! : null,
          total: s.total, amountPaid: s.paid, createdAt: s.at, status: s.reversed ? 'REVERSED' : 'COMPLETED',
          source: s.source, metadata: { imported: true, recordedBy: s.recordedBy, snapshotHash: plan.hash },
          items: { create: s.items.map(item => ({ productId: productIds.get(item.productId)!,
            productName: plan.products.find(p => p.legacyId === item.productId)!.name,
            unit: plan.products.find(p => p.legacyId === item.productId)!.unit, quantity: item.quantity, unitPrice: item.unitPrice })) } } });
        saleIds.set(s.legacyId, sale.id);
        if (existing) report.counts.skipped++;
        if (s.reversed) {
          const legacyId = `reversal:${s.legacyId}`;
          const prior = await tx.sale.findUnique({ where: { businessId_legacyId: { businessId, legacyId } } });
          const reversal = prior ?? await tx.sale.create({ data: { businessId, legacyId, reversedSaleId: sale.id,
            invoiceNo: `LEG-CN-${allocated.invoiceSeq}`, total: s.total, amountPaid: s.paid,
            customerId: sale.customerId, createdAt: s.reversedAt, source: s.source,
            metadata: { imported: true, snapshotHash: plan.hash },
            items: { create: s.items.map(item => ({ productId: productIds.get(item.productId)!,
              productName: plan.products.find(p => p.legacyId === item.productId)!.name,
              unit: plan.products.find(p => p.legacyId === item.productId)!.unit, quantity: item.quantity, unitPrice: item.unitPrice })) } } });
          saleIds.set(legacyId, reversal.id);
          if (prior) report.counts.skipped++;
        }
      }
      for (const m of plan.movements) {
        const existing = await tx.stockMovement.findUnique({ where: { businessId_legacyId: { businessId, legacyId: m.legacyId } } });
        if (existing) {
          if (!existing.quantity.eq(m.quantity) || existing.productId !== productIds.get(m.productId) || existing.type !== m.type)
            block('LEGACY_CONFLICT', `Movement ${m.legacyId} differs from its legacy mapping.`);
          report.counts.skipped++; continue;
        }
        const common = { clientId: randomUUID(), productId: productIds.get(m.productId)!, source: 'legacy-backfill',
          legacyId: m.legacyId, at: m.at, referenceId: m.referenceId, allowNegative: true, allowDeleted: true,
          suppressNotifications: true, metadata: { imported: true, snapshotHash: plan.hash, importedBy: options.actorId ?? null },
          ...(m.saleId ? { saleId: saleIds.get(m.saleId)! } : {}) };
        await applyStockMovement(db, { businessId, userId: null }, m.type === 'COUNT_CORRECTION' ?
          { ...common, type: 'COUNT_CORRECTION', countedQty: m.quantity, observedQty: new Prisma.Decimal(0) } :
          { ...common, type: m.type, quantity: m.quantity }, tx);
      }
      for (const p of plan.products) {
        const id = productIds.get(p.legacyId)!;
        const product = await tx.product.findUniqueOrThrow({ where: { id } });
        const sum = await tx.stockMovement.aggregate({ where: { businessId, productId: id }, _sum: { quantity: true } });
        if (!product.stockQty.eq(p.qty) || !(sum._sum.quantity ?? new Prisma.Decimal(0)).eq(p.qty))
          block('TOTAL_MISMATCH', `Stock/ledger total for ${p.legacyId} does not equal the snapshot.`);
        await publishProduct(tx, businessId, id);
        if (p.qty.lt(0) || (!p.deleted && p.qty.lte(p.lowAt)))
          await tx.notification.createMany({ data: { businessId, productId: id,
            type: p.qty.lt(0) ? 'OVERSOLD' : 'LOW_STOCK', message: p.qty.lt(0) ? `Oversold: reconcile stock for ${p.name}` : `Low stock: ${p.name}` }, skipDuplicates: true });
      }
      for (const id of saleIds.values()) await publishSale(tx, businessId, id);
      report.status = 'applied';
      await tx.business.update({ where: { id: businessId }, data: { inventoryMode: 'RELATIONAL',
        inventoryMigratedAt: new Date(), inventoryMigrationReport: inventoryJson(report) } });
      // Do not write the snapshot: the original bytes and timestamp are the rollback copy.
      return report;
    }, { maxWait: 30_000, timeout: 120_000 });
  } catch (error: unknown) {
    if (error instanceof Blocked) return error.report;
    throw error;
  }
}
