import assert from 'node:assert/strict';
import test from 'node:test';
import { startTestServer } from '../support/http';
import { apiActor } from '../support/api';
import { backfillBusiness } from '../../src/services/inventory-backfill.service';
import { Prisma } from '../../src/generated/prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { env, delivery } from '../helpers';
import { AuthRepository, type Transaction } from '../../src/repositories/auth.repository';
import { createDeliveryQueue } from '../../src/adapters/delivery-queue';
import { createWebhookWorker } from '../../src/services/webhook.service';

class LagosRepository extends AuthRepository {
  override transaction<T>(fn: (tx: Transaction) => Promise<T>) {
    return super.transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Lagos'`;
      return fn(tx);
    });
  }
}

test('M6 cutover blocks stale snapshot clients', { timeout: 180_000 }, async () => {
  const h = await startTestServer();
  try {
    const owner = await apiActor(h, 'Cutover protection');
    const snapshot = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
    const result = await owner.request('/api/inventory', 'PUT', {
      inventory: [], expectedUpdatedAt: snapshot.updatedAt.toISOString(),
    });
    assert.equal(result.status, 410);
    assert.equal((await owner.request('/api/inventory')).status, 410);
    assert.equal((await owner.request('/api/sales/sync', 'POST', { sales: [] })).status, 410);
    assert.equal((await owner.request('/api/sync', 'POST', {})).status, 410);
    await assert.rejects(h.db.businessSnapshot.update({ where: { businessId: owner.businessId }, data: { state: {} } }));
    const unchanged = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
    assert.deepEqual(unchanged.state, snapshot.state);
    assert.equal(unchanged.updatedAt.toISOString(), snapshot.updatedAt.toISOString());
  } finally { await h.stop(); }
});

test('M6 snapshot backfill is validated, fractional, idempotent and recoverable', { timeout: 240_000 }, async t => {
  const h = await startTestServer();
  const fixture = async (label: string, state: Prisma.InputJsonObject) => {
    const owner = await apiActor(h, label, 'SNAPSHOT');
    await h.db.businessSnapshot.update({ where: { businessId: owner.businessId }, data: { state } });
    return owner;
  };
  try {
    await t.test('dry-run reports a half-bag sale and writes nothing; live totals and cursor restore agree', async () => {
      const state = { inventory: [{ id: 'p_rice', name: 'Rice', price: 1000.25, cost: 800, qty: 4.5, lowAt: 2, unit: 'bag' }],
        customers: [{ id: 'c_1', name: 'Amina', balance: 500.13 }],
        sales: [{ id: 't_sale', type: 'sale', items: [{ productId: 'p_rice', qty: 0.5, price: 1000.25 }],
          amount: 500.125, paid: 0, at: 1_700_000_000_000, customerId: 'c_1', customerName: 'Amina' }],
        ledger: [{ kind: 'product', ref: 'p_rice', at: 1_699_999_000_000, data: { qty: 5 } },
          { kind: 'record', ref: 't_sale', at: 1_700_000_000_000,
            data: { type: 'sale', items: [['p_rice', 0.5, 1000.25]], amount: 500.125, paid: 0, customer: 'Amina', by: 'Cashier' } }] };
      const owner = await fixture('Fractional backfill', state);
      const dry = await backfillBusiness(h.db, owner.businessId, { dryRun: true, actorId: owner.userId });
      assert.equal(dry.status, 'ready');
      assert.equal(await h.db.product.count({ where: { businessId: owner.businessId } }), 0);
      assert.equal((await h.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).inventoryMode, 'SNAPSHOT');
      const before = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
      const report = await backfillBusiness(h.db, owner.businessId, { actorId: owner.userId });
      assert.equal(report.status, 'applied', JSON.stringify(report));
      const p = await h.db.product.findFirstOrThrow({ where: { businessId: owner.businessId, legacyId: 'p_rice' } });
      assert.equal(p.stockQty.toString(), '4.5');
      assert.equal(p.unitPrice, 100025n);
      const moves = await h.db.stockMovement.findMany({ where: { businessId: owner.businessId } });
      assert.equal(moves.reduce((qty, move) => qty.plus(move.quantity), new Prisma.Decimal(0)).toString(), '4.5');
      assert.equal(moves.filter(move => move.type === 'SALE').length, 1);
      const restored = await owner.request<{ sales: { total: string; customer: { name: string } }[] }>('/api/sales');
      assert.equal(restored.data.sales.length, 1);
      assert.equal(restored.data.sales[0]!.total, '50013');
      assert.equal(restored.data.sales[0]!.customer.name, 'Amina');
      const cursor = await owner.request<{ sales: unknown[]; products: unknown[] }>('/api/sync/changes?limit=500');
      assert.equal(cursor.data.sales.length, 1);
      assert(cursor.data.products.length > 0);
      const head = (await h.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).syncSeq;
      const replay = await backfillBusiness(h.db, owner.businessId);
      assert.equal(replay.status, 'already-relational');
      assert.equal((await h.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).syncSeq, head);
      assert.equal(await h.db.stockMovement.count({ where: { businessId: owner.businessId } }), moves.length);
      const after = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
      assert.deepEqual(after.state, before.state);
      assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
    });
    await t.test('empty snapshot cuts over safely', async () => {
      const owner = await fixture('Empty backfill', { inventory: [], sales: [] });
      assert.equal((await backfillBusiness(h.db, owner.businessId)).status, 'applied');
    });
    await t.test('existing legacy mappings are reused and inconsistent partial imports are blocked in dry-run', async () => {
      const owner = await fixture('Existing legacy mapping', { inventory: [{ id: 'p', name: 'Rice', unit: 'bag', qty: 0.5, price: 100 }] });
      const p = await h.db.product.create({ data: { businessId: owner.businessId, legacyId: 'p', name: 'Rice', unit: 'bag', unitPrice: 10000n } });
      assert.equal((await backfillBusiness(h.db, owner.businessId)).status, 'applied');
      assert.equal(await h.db.product.count({ where: { businessId: owner.businessId } }), 1);
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty.toString(), '0.5');
      const bad = await fixture('Inconsistent partial import', { inventory: [{ id: 'p', name: 'Rice', qty: 1, price: 100 }] });
      await h.db.product.create({ data: { businessId: bad.businessId, legacyId: 'p', name: 'Rice', unitPrice: 10000n, stockQty: 1 } });
      const dry = await backfillBusiness(h.db, bad.businessId, { dryRun: true });
      assert.equal(dry.status, 'blocked');
      assert(dry.issues.some(issue => issue.code === 'TOTAL_MISMATCH'));
      assert.equal((await h.db.business.findUniqueOrThrow({ where: { id: bad.businessId } })).inventoryMode, 'SNAPSHOT');
    });
    await t.test('an old array upload racing cutover is serialized or rejected without losing the chosen snapshot', async () => {
      const p = { id: 'race', name: 'Rice', unit: 'bag', qty: 5, price: 100 };
      const owner = await fixture('Cutover race', { inventory: [p] });
      const before = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
      const [report, upload] = await Promise.all([backfillBusiness(h.db, owner.businessId), owner.request('/api/inventory', 'PUT',
        { inventory: [{ ...p, qty: 6 }], expectedUpdatedAt: before.updatedAt.toISOString() })]);
      assert.equal(report.status, 'applied');
      assert([200, 410].includes(upload.status));
      const saved = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
      const state = saved.state as { inventory: { qty: number }[] };
      const product = await h.db.product.findFirstOrThrow({ where: { businessId: owner.businessId } });
      assert.equal(product.stockQty.toNumber(), state.inventory[0]!.qty);
    });
    await t.test('ledger-only restocks, corrections, sales and reversals are imported once', async () => {
      const owner = await fixture('Ledger history', { inventory: [{ id: 'p1', name: 'Beans', unit: 'kg', qty: 6.25, price: 200 }],
        ledger: [
          { kind: 'product', ref: 'p1', at: 1000, data: { qty: 5 } },
          { kind: 'record', ref: 'restock', at: 2000, data: { type: 'restock', items: [['p1', 2, 100]], amount: 200, paid: 200 } },
          { kind: 'record', ref: 'sale', at: 3000, data: { type: 'sale', items: [['p1', 0.5, 200]], amount: 100, paid: 100 } },
          { kind: 'adjust', ref: 'p1', at: 4000, data: { from: 6.5, to: 6.25 } },
          { kind: 'reversal', ref: 'sale', at: 5000, data: { reason: 'Returned' } },
        ] });
      const report = await backfillBusiness(h.db, owner.businessId);
      assert.equal(report.status, 'applied', JSON.stringify(report));
      const rows = await h.db.stockMovement.findMany({ where: { businessId: owner.businessId } });
      for (const type of ['OPENING', 'RESTOCK', 'SALE', 'COUNT_CORRECTION', 'SALE_REVERSAL'])
        assert(rows.some(row => row.type === type));
      assert(report.issues.some(issue => issue.code === 'RECONCILIATION'));
      const sales = await h.db.sale.findMany({ where: { businessId: owner.businessId } });
      assert.equal(sales.length, 2);
      assert(sales.some(row => row.status === 'REVERSED'));
    });
    await t.test('negative counts, missing prices and exact duplicate products are reported', async () => {
      const p = { id: 'negative', name: 'Garri', unit: 'kg', qty: -0.5 };
      const owner = await fixture('Reported corrections', { inventory: [p, p] });
      const report = await backfillBusiness(h.db, owner.businessId);
      assert.equal(report.status, 'applied', JSON.stringify(report));
      for (const code of ['NEGATIVE_QUANTITY', 'MISSING_PRICE', 'DUPLICATE']) assert(report.issues.some(issue => issue.code === code));
      assert.equal(await h.db.product.count({ where: { businessId: owner.businessId } }), 1);
      assert.equal(await h.db.notification.count({ where: { businessId: owner.businessId, type: 'OVERSOLD' } }), 1);
    });
    await t.test('malformed or conflicting data blocks cutover without partial rows', async () => {
      for (const state of [{ inventory: 'broken' }, { inventory: [{ id: 'p', name: 'Rice', qty: 0.0001 }] },
        { inventory: [{ id: 'p', name: 'Rice', qty: 1 }, { id: 'p', name: 'Rice', qty: 2 }] },
        { inventory: [], sales: [{ id: 's', type: 'sale', items: 'bad' }] }]) {
        const owner = await fixture('Malformed backfill', state);
        const report = await backfillBusiness(h.db, owner.businessId);
        assert.equal(report.status, 'blocked');
        assert(report.issues.some(issue => issue.severity === 'error'));
        assert.equal(await h.db.product.count({ where: { businessId: owner.businessId } }), 0);
        assert.equal((await h.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).inventoryMode, 'SNAPSHOT');
      }
    });
    await t.test('removed products remain tombstones while their physical sales remain recoverable', async () => {
      const owner = await fixture('Removed historical SKU', { inventory: [], sales: [{ id: 'sale1', type: 'sale',
        items: [{ productId: 'removed1', name: 'Removed rice', qty: 0.5, price: 100 }], amount: 50, paid: 50, at: 1000 }] });
      const report = await backfillBusiness(h.db, owner.businessId);
      assert.equal(report.status, 'applied', JSON.stringify(report));
      const p = await h.db.product.findFirstOrThrow({ where: { businessId: owner.businessId } });
      assert(p.deletedAt);
      assert.equal(p.stockQty.toString(), '0');
      assert.equal(await h.db.sale.count({ where: { businessId: owner.businessId } }), 1);
    });
    await t.test('SNAPSHOT endpoints still work and a foreign actor cannot request migration', async () => {
      const owner = await fixture('Still snapshot', { inventory: [] });
      const other = await apiActor(h, 'Foreign migration');
      assert.equal((await owner.request('/api/inventory')).status, 200);
      await assert.rejects(backfillBusiness(h.db, owner.businessId, { actorId: other.userId }));
    });
    await t.test('CLI dry-run prints the report without creating relational rows', async () => {
      const owner = await fixture('CLI dry run', { inventory: [{ id: 'p', name: 'Rice', qty: 0.5, price: 10 }] });
      const result = await promisify(execFile)(process.execPath,
        ['--import', 'tsx', resolve('scripts/inventory-backfill.ts'), '--business', owner.businessId, '--dry-run'],
        { env: { ...process.env, ...env, DATABASE_URL: h.config.DATABASE_URL }, timeout: 60_000 });
      const report: unknown = JSON.parse(result.stdout);
      assert(report && typeof report === 'object' && 'status' in report && report.status === 'ready');
      assert.equal(await h.db.product.count({ where: { businessId: owner.businessId } }), 0);
      assert.equal((await h.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).inventoryMode, 'SNAPSHOT');
    });
    await t.test('WhatsApp after cutover gives a clear app instruction and never mutates the rollback copy', async () => {
      const owner = await fixture('WhatsApp cutover', { inventory: [{ id: 'p', name: 'Rice', qty: 5, price: 100 }] });
      await backfillBusiness(h.db, owner.businessId);
      await h.db.business.update({ where: { id: owner.businessId }, data: { whatsappLinkedAt: new Date() } });
      const before = await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } });
      await h.db.webhookEvent.create({ data: { id: `cutover-${owner.businessId}`, provider: 'whatsapp',
        payload: { from: owner.phone, type: 'text', text: { body: 'I sold 1 Rice' } } } });
      const messages: string[] = [];
      const repo = new LagosRepository(h.db);
      const queue = createDeliveryQueue(repo, { ...h.config, whatsappEnabled: true },
        { ...delivery, sendMessage: async (_destination, message) => { messages.push(message); } });
      await createWebhookWorker(repo, queue)();
      await queue.drain();
      const timing = await h.db.$queryRaw<{ timezone: string; eligible: bigint; jobs: bigint }[]>`
        SELECT current_setting('TimeZone') AS timezone,
          (SELECT count(*) FROM vendora.delivery_jobs WHERE "expiresAt">NOW() AND attempts<5 AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW())) AS eligible,
          (SELECT count(*) FROM vendora.delivery_jobs) AS jobs`;
      assert(messages.some(message => message.includes('has not recorded a sale')),
        JSON.stringify({ timing: timing.map(value => ({ timezone: value.timezone, eligible: String(value.eligible), jobs: String(value.jobs) })) }));
      assert.deepEqual((await h.db.businessSnapshot.findUniqueOrThrow({ where: { businessId: owner.businessId } })).state, before.state);
      assert.equal(await h.db.sale.count({ where: { businessId: owner.businessId } }), 0);
    });
  } finally { await h.stop(); }
});

test('M6 lazy login migration is optional and malformed snapshots never break working auth', { timeout: 180_000 }, async () => {
  const h = await startTestServer({ lazyBackfill: true });
  try {
    for (const valid of [true, false]) {
      const owner = await h.account(valid ? 'Lazy valid' : 'Lazy malformed');
      if (!valid) await h.db.businessSnapshot.update({ where: { businessId: owner.businessId }, data: { state: { inventory: 'bad' } } });
      const result = await fetch(h.url + '/api/auth/login', { method: 'POST',
        headers: { origin: h.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: owner.phone, password: owner.password }) });
      assert.equal(result.status, 200);
      const body = await result.json() as { inventoryMigrations: { status: string }[] };
      assert.equal(body.inventoryMigrations[0]!.status, valid ? 'applied' : 'blocked');
      assert.equal((await h.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).inventoryMode, valid ? 'RELATIONAL' : 'SNAPSHOT');
    }
  } finally { await h.stop(); }
});
