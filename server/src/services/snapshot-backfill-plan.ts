import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type StockMovementType } from '../generated/prisma/client';
import { quantity } from '../schemas/inventory.schemas';
import { lineTotalKobo, MAX_KOBO, nairaToKobo } from './money';

export interface BackfillIssue { severity: 'warning' | 'error'; code: string; path: string; message: string }
export interface LegacyProduct {
  legacyId: string; name: string; unit: string; aliases: string[]; price: bigint; cost: bigint;
  qty: Prisma.Decimal; lowAt: Prisma.Decimal; deleted: boolean;
}
export interface LegacyCustomer { legacyId: string; name: string; phone: string | null }
export interface LegacyLine { productId: string; quantity: Prisma.Decimal; unitPrice: bigint }
export interface LegacySale {
  legacyId: string; items: LegacyLine[]; total: bigint; paid: bigint; at: Date;
  customerId: string | null; source: string; recordedBy: string | null; reversed: boolean; reversedAt: Date;
}
export interface LegacyMovement {
  legacyId: string; productId: string; saleId: string | null; type: StockMovementType;
  quantity: Prisma.Decimal; at: Date; referenceId: string;
}
export interface BackfillPlan {
  hash: string; issues: BackfillIssue[]; products: LegacyProduct[]; customers: LegacyCustomer[];
  sales: LegacySale[]; movements: LegacyMovement[];
}
class InvalidLegacyRow extends Error {}
const object = z.record(z.string(), z.unknown());
const idSchema = z.string().min(1).max(200);
const textSchema = z.string().trim().min(1).max(200);

/** Pure validation: never write or silently drop a physical sale on bad input. */
export function planSnapshotBackfill(input: unknown): BackfillPlan {
  const issues: BackfillIssue[] = [];
  const products = new Map<string, LegacyProduct>();
  const customers = new Map<string, LegacyCustomer>();
  const sales = new Map<string, LegacySale>();
  const movements: LegacyMovement[] = [];
  const issue = (code: string, path: string, message: string, severity: 'warning' | 'error' = 'warning') =>
    issues.push({ severity, code, path, message });
  const invalid = (path: string, message: string): never => {
    issue('MALFORMED', path, message, 'error'); throw new InvalidLegacyRow(message);
  };
  const parse = <T>(schema: z.ZodType<T>, value: unknown, path: string): T => {
    const result = schema.safeParse(value);
    return result.success ? result.data : invalid(path, result.error.issues[0]?.message ?? 'Invalid value');
  };
  const row = (value: unknown, path: string) => parse(object, value, path);
  const rows = (value: unknown, path: string): unknown[] => value === undefined ? [] : parse(z.array(z.unknown()).max(100_000), value, path);
  const id = (value: unknown, path: string) => parse(idSchema, value, path);
  const qty = (value: unknown, path: string) => parse(quantity, value, path);
  const money = (value: unknown, path: string, fallback?: bigint): bigint => {
    if (value === undefined && fallback !== undefined) { issue('MISSING_PRICE', path, 'Missing legacy price imported as zero.'); return fallback; }
    const number = parse(z.number().finite().nonnegative(), value, path);
    try { return nairaToKobo(number); } catch { return invalid(path, 'Naira amount exceeds safe kobo conversion range.'); }
  };
  const at = (value: unknown, path: string) => {
    if (value === undefined) { issue('MISSING_TIME', path, 'Missing timestamp retained as Unix epoch; no clock order inferred.'); return new Date(0); }
    return new Date(parse(z.number().int().nonnegative().max(8_640_000_000_000_000), value, path));
  };
  const attempt = (callback: () => void) => { try { callback(); } catch (error: unknown) { if (!(error instanceof InvalidLegacyRow)) throw error; } };
  const unique = <T>(map: Map<string, T>, key: string, value: T, path: string) => {
    const prior = map.get(key);
    if (!prior) { map.set(key, value); return; }
    const json = (entry: T) => JSON.stringify(entry, (_key, field: unknown) => typeof field === 'bigint' ? field.toString() : field);
    if (json(prior) !== json(value)) invalid(path, 'Conflicting duplicate legacy ID; manual reconciliation required.');
    issue('DUPLICATE', path, 'Identical duplicate skipped.');
  };
  const empty: BackfillPlan = { hash: createHash('sha256').update(JSON.stringify(input) ?? 'null').digest('hex'),
    issues, products: [], customers: [], sales: [], movements };
  let state: Record<string, unknown>;
  try { state = row(input, 'state'); } catch { return empty; }
  attempt(() => rows('inventory' in state ? state.inventory : state.products, 'inventory').forEach((value, index) => attempt(() => {
    const path = `inventory[${index}]`, p = row(value, path), legacyId = id(p.id, path + '.id');
    const current = qty(p.qty, path + '.qty');
    if (current.lt(0)) issue('NEGATIVE_QUANTITY', path, 'Negative physical quantity preserved; reconciliation alert will be created.');
    let lowAt = qty(p.lowAt ?? 0, path + '.lowAt');
    if (lowAt.lt(0)) { lowAt = new Prisma.Decimal(0); issue('NEGATIVE_THRESHOLD', path, 'Negative low-stock threshold corrected to zero.'); }
    unique(products, legacyId, { legacyId, name: parse(textSchema, p.name, path + '.name'),
      unit: parse(z.string().trim().min(1).max(80), p.unit ?? 'piece', path + '.unit'),
      aliases: parse(z.array(textSchema).max(20), p.aliases ?? [], path + '.aliases'),
      price: money(p.price, path + '.price', 0n), cost: money(p.cost ?? 0, path + '.cost'),
      qty: current, lowAt, deleted: p.deletedAt !== undefined && p.deletedAt !== null }, path);
  })));
  attempt(() => rows(state.customers, 'customers').forEach((value, index) => attempt(() => {
    const path = `customers[${index}]`, c = row(value, path), legacyId = id(c.id, path + '.id');
    unique(customers, legacyId, { legacyId, name: parse(textSchema, c.name, path + '.name'),
      phone: c.phone === undefined || c.phone === null || c.phone === '' ? null : parse(z.string().max(30), c.phone, path + '.phone') }, path);
    if (c.balance !== undefined && c.balance !== 0) issue('LEGACY_CUSTOMER_BALANCE', path,
      'Snapshot customer balance retained in rollback copy. Relational debt is derived from imported sale tender; review against this balance.');
  })));
  const ensureProduct = (legacyId: string, item: Record<string, unknown>, path: string) => {
    if (!products.has(legacyId)) {
      products.set(legacyId, { legacyId, name: typeof item.name === 'string' ? item.name : `Removed item ${legacyId}`,
        unit: typeof item.unit === 'string' ? item.unit : 'piece', aliases: [], price: money(item.price, path + '.price', 0n),
        cost: 0n, qty: new Prisma.Decimal(0), lowAt: new Prisma.Decimal(0), deleted: true });
      issue('REMOVED_PRODUCT', path, 'Missing historical product retained as a zero-stock tombstone.');
    }
  };
  const lines = (value: unknown, path: string): LegacyLine[] => {
    const result = rows(value, path).map((raw, index) => {
      const location = `${path}[${index}]`;
      const item = Array.isArray(raw) ? { productId: raw[0], qty: raw[1], price: raw[2] } : row(raw, location);
      const productId = id(item.productId, location + '.productId');
      ensureProduct(productId, item, location);
      const amount = qty(item.qty, location + '.qty');
      if (amount.lte(0)) invalid(location, 'Sale/restock quantity must be positive.');
      return { productId, quantity: amount, unitPrice: item.price === undefined ? products.get(productId)!.price : money(item.price, location + '.price') };
    });
    if (!result.length || result.length > 500) invalid(path, 'Expected 1–500 line items.');
    return result;
  };
  const customerFor = (s: Record<string, unknown>, path: string) => {
    const customerId = typeof s.customerId === 'string' ? s.customerId : null;
    const name = typeof s.customerName === 'string' ? s.customerName : typeof s.customer === 'string' ? s.customer : null;
    if (customerId && customers.has(customerId)) return customerId;
    const match = name ? [...customers.values()].find(c => c.name === name) : null;
    if (match) return match.legacyId;
    if (!customerId && !name) return null;
    const legacyId = customerId ?? `legacy-name:${name}`;
    customers.set(legacyId, { legacyId, name: parse(textSchema, name ?? 'Historical customer', path + '.customerName'), phone: null });
    return legacyId;
  };
  const parseSale = (s: Record<string, unknown>, path: string) => {
    const legacyId = id(s.id, path + '.id'), items = lines(s.items, path + '.items');
    const total = items.reduce((sum, item) => sum + lineTotalKobo(item.unitPrice, item.quantity), 0n);
    if (total > MAX_KOBO) invalid(path, 'Sale total exceeds integer kobo range.');
    if (s.amount !== undefined && money(s.amount, path + '.amount') !== total)
      issue('TOTAL_CORRECTED', path, 'Total recomputed from rounded kobo line sums; original amount remains in snapshot.');
    let paid = s.paid === undefined ? total : money(s.paid, path + '.paid');
    if (paid > total) { paid = total; issue('PAYMENT_CORRECTED', path, 'Paid amount capped at recomputed sale total; review original snapshot.'); }
    const when = at(s.at, path + '.at');
    const normalized: LegacySale = { legacyId, items, total, paid, at: when, customerId: customerFor(s, path),
      source: typeof s.source === 'string' ? s.source : 'legacy',
      recordedBy: typeof s.staffName === 'string' ? s.staffName : typeof s.by === 'string' ? s.by : null,
      reversed: s.reversed === true, reversedAt: when };
    // The same facts may occur both in the sales upload and the device ledger.
    const prior = sales.get(legacyId);
    if (prior) {
      const signature = (entry: LegacySale) => JSON.stringify([entry.total.toString(), entry.paid.toString(),
        entry.items.map(line => [line.productId, line.quantity.toString(), line.unitPrice.toString()])]);
      if (signature(prior) !== signature(normalized)) invalid(path, 'Sale and ledger facts conflict for the same legacy ID.');
      prior.reversed ||= normalized.reversed;
      issue('DUPLICATE', path, 'Sale already represented; duplicate physical stock movement skipped.');
    } else sales.set(legacyId, normalized);
  };
  const restocks = new Map<string, { items: LegacyLine[]; at: Date; reversed: boolean }>();
  const parseRecord = (s: Record<string, unknown>, path: string) => {
    if (path.startsWith('sales[') && s.type !== 'sale') invalid(path, 'Saved sales must have type sale.');
    if (s.type === 'sale') return parseSale(s, path);
    if (s.type === 'restock') {
      const key = id(s.id, path + '.id');
      const value = { items: lines(s.items, path + '.items'), at: at(s.at, path + '.at'), reversed: s.reversed === true };
      unique(restocks, key, value, path);
    } else issue('NON_STOCK_HISTORY', path, 'Non-stock record retained in the immutable snapshot; not represented as a stock movement.');
  };
  for (const field of ['sales', 'txns']) attempt(() => rows(state[field], field).forEach((raw, index) => attempt(() => parseRecord(row(raw, `${field}[${index}]`), `${field}[${index}]`))));
  const ledgerRows: Record<string, unknown>[] = [];
  attempt(() => rows(state.ledger, 'ledger').forEach((raw, index) => attempt(() => {
    const entry = row(raw, `ledger[${index}]`); ledgerRows.push(entry);
    if (entry.kind === 'record') parseRecord({ ...row(entry.data, `ledger[${index}].data`), id: entry.ref, at: entry.at }, `ledger[${index}]`);
  })));
  if (!ledgerRows.length) issue('NO_DEVICE_LEDGER', 'ledger', 'Snapshot has no full device ledger; stock opening is inferred from saved quantity and sales.');
  else issue('UNVERIFIED_DEVICE_LEDGER', 'ledger', 'Imported legacy facts are not independent proof of a physical transaction; original signatures remain in the rollback copy.');
  ledgerRows.forEach((entry, index) => attempt(() => {
    const path = `ledger[${index}]`;
    if (entry.kind === 'reversal') {
      const ref = id(entry.ref, path + '.ref');
      const sale = sales.get(ref);
      if (sale) { sale.reversed = true; sale.reversedAt = at(entry.at, path + '.at'); }
      const restock = restocks.get(ref);
      if (restock) restock.reversed = true;
      if (!sale && !restock) issue('UNMATCHED_REVERSAL', path, 'Reversal retained in snapshot; no matching stock transaction.');
    }
    if (entry.kind === 'product' || entry.kind === 'adjust') {
      const productId = id(entry.ref, path + '.ref'), data = row(entry.data, path + '.data');
      ensureProduct(productId, data, path);
      const delta = entry.kind === 'product' ? qty(data.qty ?? 0, path + '.qty') : qty(data.to, path + '.to').minus(qty(data.from, path + '.from'));
      movements.push({ legacyId: `ledger:${entry.seq ?? index}:${entry.kind}:${productId}`, productId,
        saleId: null, type: entry.kind === 'product' ? 'OPENING' : 'COUNT_CORRECTION', quantity: delta,
        at: at(entry.at, path + '.at'), referenceId: productId });
    }
  }));
  for (const sale of sales.values()) sale.items.forEach((line, index) => {
    movements.push({ legacyId: `sale:${sale.legacyId}:${index}`, productId: line.productId, saleId: sale.legacyId,
      type: 'SALE', quantity: line.quantity.negated(), at: sale.at, referenceId: sale.legacyId });
    if (sale.reversed) movements.push({ legacyId: `reversal:${sale.legacyId}:${index}`, productId: line.productId,
      saleId: `reversal:${sale.legacyId}`, type: 'SALE_REVERSAL', quantity: line.quantity, at: sale.reversedAt, referenceId: sale.legacyId });
  });
  for (const [key, restock] of restocks) restock.items.forEach((line, index) => {
    movements.push({ legacyId: `restock:${key}:${index}`, productId: line.productId, saleId: null,
      type: 'RESTOCK', quantity: line.quantity, at: restock.at, referenceId: key });
    if (restock.reversed) movements.push({ legacyId: `restock-reversal:${key}:${index}`, productId: line.productId, saleId: null,
      type: 'LEGACY_ADJUSTMENT', quantity: line.quantity.negated(), at: restock.at, referenceId: key });
  });
  const uniqueMovements = new Map<string, LegacyMovement>();
  for (const movement of movements) {
    const previous = uniqueMovements.get(movement.legacyId);
    if (!previous) uniqueMovements.set(movement.legacyId, movement);
    else if (previous.productId === movement.productId && previous.type === movement.type && previous.quantity.eq(movement.quantity))
      issue('DUPLICATE', movement.legacyId, 'Identical movement skipped.');
    else issue('LEGACY_CONFLICT', movement.legacyId, 'Conflicting legacy movement key.', 'error');
  }
  const ordered = [...uniqueMovements.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  movements.length = 0;
  for (const p of products.values()) {
    const net = ordered.filter(m => m.productId === p.legacyId).reduce((sum, m) => sum.plus(m.quantity), new Prisma.Decimal(0));
    const opening = p.qty.minus(net);
    if (!opening.isZero()) {
      issue('RECONCILIATION', `inventory.${p.legacyId}`, `Inferred opening adjustment ${opening.toFixed(3)} makes ledger total equal saved quantity ${p.qty.toFixed(3)}.`);
      movements.push({ legacyId: `reconcile:${p.legacyId}`, productId: p.legacyId, saleId: null,
        type: 'LEGACY_ADJUSTMENT', quantity: opening, at: new Date(0), referenceId: p.legacyId });
    }
    let balance = opening;
    for (const movement of ordered.filter(m => m.productId === p.legacyId)) {
      balance = balance.plus(movement.quantity);
      if (balance.abs().gt('999999999.999') || movement.quantity.abs().gt('999999999.999'))
        issue('QUANTITY_LIMIT', `inventory.${p.legacyId}`, 'Historical movements exceed Decimal(12,3) capacity.', 'error');
    }
    if (opening.abs().gt('999999999.999')) issue('QUANTITY_LIMIT', `inventory.${p.legacyId}`, 'Inferred opening exceeds Decimal(12,3).', 'error');
  }
  movements.push(...ordered);
  return { ...empty, products: [...products.values()], customers: [...customers.values()], sales: [...sales.values()] };
}
