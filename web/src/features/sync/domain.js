import { appendEntry, factsOf } from '../../lib/ledger.js';
import { queueOperation } from './outbox.js';

export const domainKeys = ['products', 'txns', 'customers', 'ledger', 'invoiceSeq'];
export const domainOf = state => Object.fromEntries(domainKeys.map(key => [key, structuredClone(state[key])]));
const uuid = () => crypto.randomUUID();
const q = value => Math.round(Number(value) * 1000) / 1000;
export const toKobo = value => {
  const amount = Math.round(Number(value) * 100);
  if (!Number.isFinite(Number(value)) || Number(value) < 0 || !Number.isSafeInteger(amount)) throw new Error('Enter a valid naira amount.');
  return String(amount);
};
export function saleTotalNaira(items) {
  const total = items.reduce((sum, item) => {
    const units = validQty(item.qty);
    if (units <= 0) throw new Error('Sale quantities must be positive.');
    return sum + (BigInt(toKobo(item.price)) * BigInt(Math.round(units * 1000)) + 500n) / 1000n;
  }, 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This sale exceeds the supported browser money range.');
  return Number(total) / 100;
}
const validQty = value => {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 999999999.999 || Math.abs(number - q(number)) > Number.EPSILON * Math.max(1, Math.abs(number)) * 4)
    throw new Error('Quantities support up to three decimal places.');
  return q(number);
};
const sourceOf = source => ['tap', 'voice', 'whatsapp', 'offline'].includes(source) ? source : 'manual';
const metadata = record => ({ recordedBy: record.staffName || 'Account holder', localTxnId: record.id || '',
  ...(record.source ? { recordedVia: record.source } : {}) });
const newOperation = (action, payload, extra = {}) => ({ id: uuid(), action, payload, ...extra });
const productPayload = product => ({ name: product.name, unit: product.unit || 'piece', aliases: product.aliases || [],
  unitPrice: toKobo(product.price), costPrice: toKobo(product.cost || 0), lowStockAt: String(validQty(product.lowAt || 0)) });

/** Called inside the same IndexedDB transaction as the optimistic domain write. */
export function captureDomainChanges(replica, before, after, { offline = false } = {}) {
  const created = [];
  const previousTransactions = new Map(before.txns.map(record => [record.id, record]));
  const previousProducts = new Map(before.products.map(product => [product.id, product]));
  const enqueue = (action, payload, extra) => { const operation = newOperation(action, payload, extra); created.push(operation); return operation; };
  const transactionDeltas = new Map();
  const addDelta = (productId, delta) => transactionDeltas.set(productId, q((transactionDeltas.get(productId) || 0) + delta));
  for (const record of after.txns) {
    const previous = previousTransactions.get(record.id);
    if (!previous && record.type === 'sale') {
      for (const item of record.items) { validQty(item.qty); addDelta(item.productId, -item.qty); }
      enqueue('sale.create', { localId: record.id, items: record.items, amountPaid: toKobo(record.paid),
        customerId: record.customerId, customerName: record.customerName, source: sourceOf(record.source),
        metadata: metadata(record), fromOffline: offline, at: record.at }, { localTxnId: record.id });
    } else if (!previous && record.type === 'restock') {
      record.items.forEach((item, index) => {
        validQty(item.qty); addDelta(item.productId, item.qty);
        enqueue('stock.restock', { productId: item.productId, quantity: String(item.qty), at: record.at,
          source: sourceOf(record.source), metadata: { ...metadata(record), costKobo: toKobo(item.cost ?? item.price ?? 0), line: index } }, { localTxnId: record.id });
      });
    } else if (!previous && record.type === 'debtPayment') {
      let amount = Number(toKobo(record.amount));
      record.allocations = [];
      const sales = before.txns.filter(txn => txn.type === 'sale' && !txn.reversed && txn.syncStatus !== 'rejected' && txn.customerId === record.customerId)
        .sort((a, b) => a.at - b.at);
      for (const sale of sales) {
        const remote = replica.canonical.sales[replica.mappings.sales[sale.id]];
        const pending = replica.outbox.filter(operation => ['pending', 'applied'].includes(operation.status) && operation.action === 'sale.payment' && operation.payload.saleId === sale.id)
          .reduce((sum, operation) => sum + Number(operation.payload.amount), 0);
        const remaining = Math.max(0, (remote ? Number(remote.outstanding) : Number(toKobo(sale.amount)) - Number(toKobo(sale.paid))) - pending);
        const paid = Math.min(amount, remaining);
        if (paid) {
          const paymentOperation = enqueue('sale.payment', { saleId: sale.id, amount: String(paid), source: sourceOf(record.source), at: record.at,
            metadata: metadata(record) }, { localTxnId: record.id });
          record.allocations.push({ saleId: sale.id, amount: paid / 100, clientId: paymentOperation.id }); amount -= paid;
        }
      }
      if (amount) throw new Error('This payment does not match restored sale debt. Review the customer history before recording it.');
    }
    if (previous && !previous.reversed && record.reversed) {
      if (record.syncStatus === 'rejected') throw new Error('This sale was not posted. Review it in Sync status.');
      if (record.type !== 'sale') throw new Error('Use a stock count to correct a restock. Only sales support cancellation here.');
      record.items.forEach(item => addDelta(item.productId, item.qty));
      enqueue('sale.reverse', { saleId: record.id, reason: record.reversedReason || 'Entered by mistake',
        source: 'manual', metadata: metadata(record) }, { localTxnId: record.id });
    }
  }
  for (const product of after.products) {
    const previous = previousProducts.get(product.id);
    const payload = productPayload(product);
    validQty(product.qty);
    if (!previous) {
      const openingQty = q(product.qty - (transactionDeltas.get(product.id) || 0));
      if (openingQty < 0) throw new Error('Opening stock must be zero or positive. Record physical sales or a count afterward.');
      enqueue('product.create', { localId: product.id, product: structuredClone(product), ...payload, openingQty: String(openingQty),
        source: 'manual', metadata: {} }, { localProductId: product.id });
      continue;
    }
    const oldPayload = productPayload(previous);
    const edits = Object.fromEntries(Object.entries(payload).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(oldPayload[key])));
    if (Object.keys(edits).length) enqueue('product.update', { productId: product.id, ...edits, source: 'manual', metadata: {} });
    const residual = q(product.qty - previous.qty - (transactionDeltas.get(product.id) || 0));
    if (residual) {
      const observedQty = previous.qty;
      // Inputs describe a delta against what the form observed; live sales are
      // retained by the server's counted-minus-observed policy.
      const countedQty = q(observedQty + residual);
      enqueue('stock.count', { productId: product.id, countedQty: String(Math.max(0, countedQty)),
        observedQty: String(countedQty < 0 ? -residual : observedQty), reason: 'Physical stock count', source: 'manual', metadata: {} });
    }
  }
  const remainingProducts = new Set(after.products.map(product => product.id));
  for (const product of before.products) if (!remainingProducts.has(product.id))
    enqueue('product.delete', { productId: product.id, source: 'manual', metadata: {} });
  created.sort((a, b) => Number(b.action === 'product.create') - Number(a.action === 'product.create'));
  for (const operation of created) queueOperation(replica, operation);
  return created.map(operation => operation.id);
}

const reference = (replica, collection, localId) => {
  const id = replica.mappings[collection][localId] || (replica.canonical[collection]?.[localId] ? localId : null);
  if (!id) throw Object.assign(new Error('A referenced record has not synchronized. Review earlier rejected operations.'), { status: 409, code: 'DEPENDENCY_REJECTED' });
  return id;
};
export function prepareOperation(replica, operation) {
  const payload = structuredClone(operation.payload);
  const body = { clientId: operation.id, source: payload.source || 'manual', metadata: payload.metadata || {} };
  if (operation.action === 'product.create') {
    const { localId, product, ...fields } = payload;
    return { path: '/api/products', method: 'POST', body: { ...body, ...fields } };
  }
  if (operation.action.startsWith('product.') || operation.action.startsWith('stock.')) {
    const productId = reference(replica, 'products', payload.productId);
    delete payload.productId;
    const action = operation.action.split('.')[1];
    const method = action === 'delete' ? 'DELETE' : action === 'update' ? 'PATCH' : 'POST';
    return { path: `/api/products/${productId}${action === 'restock' || action === 'count' ? '/' + action : ''}`,
      method, body: { ...body, ...payload } };
  }
  if (operation.action === 'sale.create') {
    const customer = payload.customerName ? { name: payload.customerName,
      clientId: /^[0-9a-f-]{36}$/i.test(payload.customerId || '') ? payload.customerId : operation.id } : null;
    return { path: '/api/sales', method: 'POST', body: { ...body,
      items: payload.items.map(item => ({ productId: reference(replica, 'products', item.productId), quantity: String(item.qty), unitPrice: toKobo(item.price) })),
      amountPaid: payload.amountPaid, fromOffline: payload.fromOffline, at: payload.at,
      ...(payload.legacyId ? { legacyId: payload.legacyId } : {}),
      ...(customer ? replica.mappings.customers[payload.customerId] ? { customerId: replica.mappings.customers[payload.customerId] } : { customer } : {}) } };
  }
  const saleId = reference(replica, 'sales', payload.saleId);
  delete payload.saleId;
  return { path: `/api/sales/${saleId}/${operation.action === 'sale.reverse' ? 'reverse' : 'payments'}`, method: 'POST', body: { ...body, ...payload } };
}

export function acceptOperation(replica, operation, response) {
  const local = replica.domain?.txns.find(record => record.id === operation.localTxnId);
  if (local) local.syncStatus = 'synced';
  if (response.product && operation.localProductId) replica.mappings.products[operation.localProductId] = response.product.id;
  if (response.sale && operation.action === 'sale.create') {
    replica.mappings.sales[operation.localTxnId] = response.sale.id;
    if (response.sale.customer && operation.payload.customerId)
      replica.mappings.customers[operation.payload.customerId] = response.sale.customer.id;
  }
}

function localIdFor(replica, collection, value, existing) {
  return existing.find(item => item.serverId === value.id || replica.mappings[collection][item.id] === value.id)?.id || value.legacyId || value.clientId || value.id;
}
const recordedOnServer = (replica, operation) => {
  const collection = operation.action === 'product.create' ? 'products' : operation.action.startsWith('stock.') ? 'movements' : 'sales';
  return Object.values(replica.canonical[collection]).some(value => value.clientId === operation.id ||
    (operation.action === 'sale.payment' && value.payments?.some(payment => payment.clientId === operation.id)));
};

export function projectReplica(replica) {
  if (!replica.domain) return;
  const domain = structuredClone(replica.domain);
  for (const archive of [...(replica.rejections || []), ...(replica.discarded || [])]) {
    if (!archive.dismissedAt && !archive.discardedAt) continue;
    const record = domain.txns.find(txn => txn.id === archive.localTxnId);
    if (record && !record.serverId) record.syncStatus = 'discarded';
  }
  const allProducts = Object.values(replica.canonical.products).map(product => {
    const localId = localIdFor(replica, 'products', product, domain.products);
    const previous = domain.products.find(item => item.id === localId);
    replica.mappings.products[localId] = product.id;
    return { ...previous, id: localId, serverId: product.id, name: product.name, unit: product.unit,
      price: Number(product.unitPrice) / 100, cost: Number(product.costPrice || 0) / 100,
      qty: Number(product.currentQty), lowAt: Number(product.lowStockAt), aliases: product.aliases,
      updatedAt: Date.parse(product.updatedAt), deletedAt: product.deletedAt };
  });
  const productIdentity = serverId => allProducts.find(product => product.serverId === serverId)?.id || serverId;
  const records = domain.txns.filter(txn => !txn.restored || txn.type !== 'sale');
  const incoming = [];
  for (const sale of Object.values(replica.canonical.sales)) {
    const localId = localIdFor(replica, 'sales', sale, domain.txns);
    replica.mappings.sales[localId] = sale.id;
    const previous = domain.txns.find(txn => txn.id === localId);
    const customer = sale.customer;
    const customerId = customer ? Object.entries(replica.mappings.customers).find(([key, serverId]) => serverId === customer.id && domain.customers.some(c => c.id === key))?.[0]
      || customer.legacyId || customer.clientId || customer.id : null;
    const record = { ...(previous || { id: localId, type: sale.isReversal ? 'saleReversal' : 'sale',
      items: sale.items.map(item => ({ productId: productIdentity(item.productId), name: item.name, unit: item.unit,
        qty: Number(item.quantity), price: Number(item.unitPrice) / 100, cost: 0 })),
      amount: Number(sale.total) / 100 * (sale.isReversal ? -1 : 1), paid: Number(sale.checkoutPaid) / 100,
      at: Date.parse(sale.createdAt), source: sale.source, staffName: sale.metadata?.recordedBy || null,
      customerName: customer?.name || null, customerId, payStatus: 'recorded', restored: true }),
      serverId: sale.id, syncStatus: 'synced', serverAmountPaid: Number(sale.amountPaid) / 100,
      outstanding: Number(sale.outstanding) / 100, reversed: sale.status === 'REVERSED',
      invoiceNo: sale.invoiceNo, reversedSaleId: sale.reversedSaleId, createdById: sale.createdById };
    incoming.push(record);
    for (const payment of sale.payments) {
      const id = payment.clientId || payment.id;
      if (!domain.txns.some(txn => txn.id === id || txn.serverPaymentId === payment.id || txn.allocations?.some(allocation => allocation.clientId === payment.clientId))) incoming.push({ id, type: 'debtPayment', items: [],
        amount: Number(payment.amount) / 100, paid: Number(payment.amount) / 100, at: Date.parse(payment.createdAt),
        source: 'app', customerId, customerName: customer?.name || null, staffName: null, restored: true,
        serverPaymentId: payment.id, allocations: [{ saleId: localId, amount: Number(payment.amount) / 100 }], syncStatus: 'synced' });
    }
  }
  domain.products = allProducts.filter(product => !product.deletedAt);
  const byId = new Map(records.map(record => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  domain.txns = [...byId.values()].sort((a, b) => b.at - a.at);
  const productById = id => domain.products.find(product => product.id === id);
  for (const operation of replica.outbox.slice().sort((a, b) => a.sequence - b.sequence)) {
    const record = domain.txns.find(txn => txn.id === operation.localTxnId);
    if (record && operation.status === 'rejected') record.syncStatus = 'rejected';
    if (operation.status === 'rejected' || recordedOnServer(replica, operation)) continue;
    if (record) record.syncStatus = 'pending';
    const payload = operation.payload;
    if (operation.action === 'product.create') {
      if (!productById(payload.localId)) domain.products.push({ ...payload.product, qty: Number(payload.openingQty), syncStatus: 'pending' });
    } else if (operation.action === 'product.update') {
      const p = productById(payload.productId);
      if (p) Object.assign(p, { ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.unit !== undefined ? { unit: payload.unit } : {}), ...(payload.aliases ? { aliases: payload.aliases } : {}),
        ...(payload.unitPrice !== undefined ? { price: Number(payload.unitPrice) / 100 } : {}),
        ...(payload.costPrice !== undefined ? { cost: Number(payload.costPrice) / 100 } : {}),
        ...(payload.lowStockAt !== undefined ? { lowAt: Number(payload.lowStockAt) } : {}) });
    } else if (operation.action === 'product.delete') domain.products = domain.products.filter(p => p.id !== payload.productId);
    else if (operation.action === 'stock.restock' || operation.action === 'stock.count') {
      const p = productById(payload.productId);
      if (p) p.qty = q(p.qty + (operation.action === 'stock.count' ? Number(payload.countedQty) - Number(payload.observedQty) : Number(payload.quantity)));
    } else if (operation.action === 'sale.create') {
      for (const item of payload.items) { const p = productById(item.productId); if (p) p.qty = q(p.qty - item.qty); }
    } else if (operation.action === 'sale.reverse') {
      const original = domain.txns.find(txn => txn.id === payload.saleId);
      if (original) { original.reversed = true; original.items.forEach(item => { const p = productById(item.productId); if (p) p.qty = q(p.qty + item.qty); }); }
    }
  }
  // Preserve sealed local facts. Restored records receive an honest local
  // import entry, never fabricated bank/supplier evidence or a remote signature.
  for (const record of domain.txns.filter(txn => txn.restored).sort((a, b) => a.at - b.at)) {
    if (!domain.ledger.some(entry => entry.kind === 'record' && entry.ref === record.id))
      appendEntry(domain, { kind: 'record', ref: record.id, evidence: 'manual', data: factsOf(record), at: Date.now() });
  }
  const customers = new Map(domain.customers.map(customer => [customer.id, { ...customer, balance: 0 }]));
  for (const sale of Object.values(replica.canonical.sales)) if (sale.customer) {
    const c = sale.customer;
    const id = Object.entries(replica.mappings.customers).find(([key, serverId]) => serverId === c.id && customers.has(key))?.[0] || c.legacyId || c.clientId || c.id;
    customers.set(id, { ...customers.get(id), id, serverId: c.id, name: c.name, phone: c.phone || '',
      balance: (customers.get(id)?.balance || 0) + Number(sale.outstanding) / 100 });
  }
  for (const operation of replica.outbox) {
    if (operation.status === 'rejected' || recordedOnServer(replica, operation)) continue;
    const payload = operation.payload;
    if (operation.action === 'sale.create' && payload.customerId && payload.customerName) {
      const total = payload.items.reduce((sum, item) => sum + Math.round(Number(toKobo(item.price)) * item.qty), 0);
      const previous = customers.get(payload.customerId) || { id: payload.customerId, name: payload.customerName, phone: '', balance: 0 };
      customers.set(payload.customerId, { ...previous, balance: previous.balance + (total - Number(payload.amountPaid)) / 100 });
    }
    if (operation.action === 'sale.payment' || operation.action === 'sale.reverse') {
      const sale = domain.txns.find(txn => txn.id === payload.saleId);
      const customer = sale && customers.get(sale.customerId);
      if (customer) customer.balance = Math.max(0, customer.balance - (operation.action === 'sale.payment' ? Number(payload.amount) / 100 : sale.amount - sale.paid));
    }
  }
  domain.customers = [...customers.values()];
  replica.domain = domain;
}
