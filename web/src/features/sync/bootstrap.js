import { queueOperation } from './outbox.js';
import { toKobo } from './domain.js';

/** Convert only the authenticated account's own old records, once per replica. */
export function bootstrapLegacy(replica) {
  if (replica.legacyImported || !replica.domain) return;
  const domain = replica.domain;
  replica.legacyArchive ||= structuredClone(domain);
  if (domain.customers.some(customer => customer.balance > 0))
    replica.migrationWarning = 'Legacy customer balances are saved for review. Compare them with restored sale debt before relying on the debt screen.';
  const uuid = () => crypto.randomUUID();
  const hasQueued = (id, kind) => replica.outbox.some(operation => operation[kind] === id);
  const saleByLocal = id => Object.values(replica.canonical.sales).find(sale => sale.legacyId === id || sale.clientId === id || sale.id === id);
  const productByLocal = id => Object.values(replica.canonical.products).find(product => product.legacyId === id || product.clientId === id || product.id === id);
  const pendingDeltas = new Map();
  const transactions = [];
  const delta = (id, amount) => pendingDeltas.set(id, (pendingDeltas.get(id) || 0) + amount);
  for (const record of domain.txns.slice().sort((a, b) => a.at - b.at)) {
    if (hasQueued(record.id, 'localTxnId') || record.restored || record.syncStatus === 'rejected') continue;
    if (record.type === 'sale') {
      const existing = saleByLocal(record.id);
      if (existing) {
        replica.mappings.sales[record.id] = existing.id;
        if (record.reversed && existing.status !== 'REVERSED') transactions.push({ id: uuid(), action: 'sale.reverse', localTxnId: record.id,
          payload: { saleId: record.id, reason: record.reversedReason || 'Legacy reversal', metadata: { legacyImport: true }, source: 'manual' } });
        continue;
      }
      const operation = { id: uuid(), action: 'sale.create', localTxnId: record.id, payload: { localId: record.id, legacyId: record.id,
        items: record.items, amountPaid: toKobo(record.paid ?? record.amount), customerId: record.customerId,
        customerName: record.customerName, at: record.at, fromOffline: true, source: 'offline',
        metadata: { legacyImport: true, recordedBy: record.staffName || 'Legacy record', localTxnId: record.id } } };
      transactions.push(operation);
      if (record.reversed) transactions.push({ id: uuid(), action: 'sale.reverse', localTxnId: record.id,
        payload: { saleId: record.id, reason: record.reversedReason || 'Legacy reversal', source: 'manual', metadata: { legacyImport: true } } });
      else record.items.forEach(item => delta(item.productId, -item.qty));
    } else if (record.type === 'restock') record.items.forEach((item, index) => {
      const legacyId = `restock:${record.id}:${index}`;
      if (Object.values(replica.canonical.movements).some(movement => movement.legacyId === legacyId)) return;
      if (record.reversed) { replica.migrationWarning = 'A legacy restock reversal needs a physical stock count. Original records are saved.'; return; }
      transactions.push({ id: uuid(), action: 'stock.restock', localTxnId: record.id,
        payload: { legacyId, productId: item.productId, quantity: String(item.qty), at: record.at, source: 'offline',
          metadata: { legacyImport: true, localTxnId: record.id, costKobo: toKobo(item.cost ?? item.price ?? 0) } } });
      delta(item.productId, item.qty);
    });
  }
  for (const product of domain.products) {
    const existing = productByLocal(product.id);
    if (existing) { replica.mappings.products[product.id] = existing.id; continue; }
    if (hasQueued(product.id, 'localProductId')) continue;
    const openingQty = Math.round((Number(product.qty) - (pendingDeltas.get(product.id) || 0)) * 1000) / 1000;
    if (openingQty < 0) throw Object.assign(new Error('Legacy opening stock needs review before sync. Original records are saved.'),
      { status: 409, code: 'LEGACY_RECONCILIATION_REQUIRED' });
    queueOperation(replica, { id: uuid(), action: 'product.create', localProductId: product.id, payload: {
      localId: product.id, legacyId: product.id, product, name: product.name, unit: product.unit || 'piece', aliases: product.aliases || [],
      unitPrice: toKobo(product.price), costPrice: toKobo(product.cost || 0), openingQty: String(openingQty),
      lowStockAt: String(product.lowAt || 0), source: 'offline', metadata: { legacyImport: true } } });
  }
  // Product creation always precedes any operation referencing the mapped ID.
  for (const operation of transactions) queueOperation(replica, operation);
  if (transactions.length) replica.migrationWarning = 'Old device records were imported. Check the physical stock and record a count if the earlier snapshot already included them.';
  replica.legacyImported = true;
}
