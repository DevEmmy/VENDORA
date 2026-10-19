import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyReplica, mergeChange } from '../src/features/sync/outbox.js';
import { captureDomainChanges, domainOf, projectReplica, saleTotalNaira } from '../src/features/sync/domain.js';
import { appendEntry, factsOf, verifyChain, verifyTxns } from '../src/lib/ledger.js';

const product = { id: 'local-p', name: 'Rice', unit: 'bag', aliases: [], price: 1000.25, cost: 800, lowAt: 1, qty: 5 };
const canonicalProduct = qty => ({ id: 'server-p', legacyId: 'local-p', clientId: null, name: 'Rice', unit: 'bag', aliases: [],
  unitPrice: '100025', costPrice: '80000', lowStockAt: '1.000', currentQty: qty, syncSeq: '3', updatedAt: new Date().toISOString(), deletedAt: null });

test('fractional sale pricing rounds each line exactly before summing', () => {
  assert.equal(saleTotalNaira([{ qty: 0.5, price: 1000.25 }, { qty: 0.5, price: 1000.25 }]), 1000.26);
  assert.throws(() => saleTotalNaira([{ qty: 0.0001, price: 100 }]));
});
test('pending projections are repeatable and a lost response does not apply stock twice after pull', () => {
  const replica = emptyReplica();
  replica.legacyImported = true;
  replica.domain = { products: [structuredClone(product)], txns: [], customers: [], ledger: [], invoiceSeq: 0 };
  mergeChange(replica, { entity: 'product', data: canonicalProduct('5.000') });
  const before = structuredClone(replica.domain);
  const transaction = { id: 'local-sale', type: 'sale', items: [{ productId: product.id, qty: 0.5, price: 1000.25, name: 'Rice', unit: 'bag' }],
    amount: 500.13, paid: 500.13, at: 1000, source: 'tap', customerName: null, staffName: null };
  replica.domain.txns.push(transaction);
  replica.domain.products[0].qty = 4.5;
  appendEntry(replica.domain, { kind: 'record', ref: transaction.id, data: factsOf(transaction), at: 1000 });
  captureDomainChanges(replica, before, domainOf(replica.domain), { offline: true });
  for (let index = 0; index < 3; index++) { projectReplica(replica); assert.equal(replica.domain.products[0].qty, 4.5); }
  const operation = replica.outbox[0];
  mergeChange(replica, { entity: 'product', data: { ...canonicalProduct('4.500'), syncSeq: '5' } });
  mergeChange(replica, { entity: 'sale', data: { id: 'server-sale', clientId: operation.id, legacyId: null,
    status: 'COMPLETED', isReversal: false, reversedSaleId: null, total: '50013', checkoutPaid: '50013', amountPaid: '50013', outstanding: '0',
    customer: null, payments: [], metadata: {}, source: 'tap', createdById: 'user', invoiceNo: 'INV-00001',
    syncSeq: '7', createdAt: new Date(1000).toISOString(),
    items: [{ productId: 'server-p', name: 'Rice', unit: 'bag', quantity: '0.500', unitPrice: '100025' }] } });
  // The receipt may be lost but the durable wire/clientId identifies the sale
  // already present in canonical state; retry remains pending without doubling qty.
  replica.mappings.sales['local-sale'] = 'server-sale';
  projectReplica(replica);
  assert.equal(replica.domain.products[0].qty, 4.5);
  assert.equal(replica.domain.txns.length, 1);
  assert.equal(verifyChain(replica.domain.ledger).ok, true);
  assert.deepEqual(verifyTxns(replica.domain.txns, replica.domain.ledger), []);
});
test('a rejected online sale restores the server quantity and retains its sealed local facts', () => {
  const replica = emptyReplica();
  replica.domain = { products: [structuredClone(product)], txns: [], customers: [], ledger: [], invoiceSeq: 0 };
  mergeChange(replica, { entity: 'product', data: canonicalProduct('0.000') });
  const before = structuredClone(replica.domain);
  replica.domain.txns = [{ id: 'rejected', type: 'sale', items: [{ productId: product.id, qty: 1, price: 1000.25 }],
    amount: 1000.25, paid: 1000.25, at: 1000, source: 'tap' }];
  replica.domain.products[0].qty = 4;
  appendEntry(replica.domain, { kind: 'record', ref: 'rejected', data: factsOf(replica.domain.txns[0]), at: 1000 });
  captureDomainChanges(replica, before, replica.domain);
  replica.outbox[0].status = 'rejected';
  replica.outbox[0].error = { code: 'INSUFFICIENT_STOCK' };
  projectReplica(replica);
  assert.equal(replica.domain.products[0].qty, 0);
  assert.equal(replica.domain.txns[0].syncStatus, 'rejected');
  assert.deepEqual(verifyTxns(replica.domain.txns, replica.domain.ledger), []);
});
