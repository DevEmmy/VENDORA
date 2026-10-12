// Vendora app state: offline-first (saved on the phone), with every business action.
// All sales, restocks and payments are written to the tamper-evident ledger (ledger.js).
import { parse } from './parser.js';
import { replies } from './i18n.js';
import { naira, uid, startOfDay, DAY, qtyUnit } from './format.js';
import { totals, qtySold, scoreFor, restockForecast, periodRange } from './insights.js';
import { createMockWema, createHttpWema, WemaError } from './wema.js';
import { buildDemo } from './seed.js';
import { appendEntry, factsOf, verifyChain, verifyTxns, signHash, deviceKey, trustStats } from './ledger.js';
import { seller as hubSeller } from './hub.js';
import { SERVER_URL, API_KEY } from './config.js';

const KEY = 'vendora:v2';

export const emptyState = () => ({
  profile: { name: '', phone: '', email: '', businessName: '', businessType: '', city: '', country: 'Nigeria', currency: 'NGN', language: 'en', accountNumber: null, accountName: null, onboarded: false, premium: false, consentShareData: false, whatsappLinked: false, whatsappAlerts: true, speakReplies: true, autoRepay: true, demo: false, location: null },
  products: [], txns: [], customers: [], staff: [], currentStaffId: null,
  savings: { enabled: false, percent: 5, balance: 0, lastSavedDay: null, history: [] },
  loans: [], paymentRequests: [], credits: [], chat: [], orders: [], usedReceipts: {},
  invoiceSeq: 0, submissions: [], advert: null,
  cac: { status: 'none', plan: null, application: null, number: null },
  ledger: [], ledgerKey: null, wemaMock: null,
  sync: { ackedThrough: 0, creditsSince: 0, lastSyncAt: null, lastError: null },
  alerts: [], waSim: [],
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch { /* storage blocked or corrupt: start fresh */ }
  return emptyState();
}

let state = load();
const listeners = new Set();
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full or blocked */ } }, 120);
}
export const getState = () => state;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setState(fn) {
  const draft = structuredClone(state);
  fn(draft);
  state = draft;
  persist();
  listeners.forEach(l => l());
  if (state.ledger.some(e => !e.sig)) scheduleSign();
}

// ---------- device signatures for the ledger ----------
let signing = false;
function scheduleSign() {
  if (signing) return;
  signing = true;
  setTimeout(async () => {
    try {
      const k = await deviceKey();
      if (!k) return;
      if (!state.ledgerKey) setState(d => { d.ledgerKey = { publicJwk: k.publicJwk, fingerprint: k.fingerprint }; });
      const todo = state.ledger.filter(e => !e.sig).slice(0, 200);
      const sigs = {};
      for (const e of todo) sigs[e.seq] = await signHash(e.hash);
      if (todo.length) setState(d => { for (const e of d.ledger) if (!e.sig && sigs[e.seq]) e.sig = sigs[e.seq]; });
    } catch { /* signing unavailable on this browser */ } finally {
      signing = false;
      if (state.ledger.some(e => !e.sig) && state.ledgerKey) setTimeout(scheduleSign, 50);
    }
  }, 30);
}

// ---------- integrity (cached) ----------
let integrityCache = { key: '', value: null };
export function integrity(s = state) {
  const head = s.ledger[s.ledger.length - 1];
  const key = `${s.ledger.length}:${head?.hash}:${s.txns.length}:${s.txns[0]?.id}:${s.sync?.sealOk}`;
  if (integrityCache.key === key) return integrityCache.value;
  const chain = verifyChain(s.ledger);
  const problems = verifyTxns(s.txns, s.ledger);
  const trust = trustStats(s.txns, s.ledger, Date.now() - 30 * DAY);
  const serverOk = s.sync?.sealOk !== false;
  const value = { ok: chain.ok && problems.length === 0 && serverOk, serverOk, chain, problems, trust, flags: s.ledger.filter(e => e.flag).length };
  integrityCache = { key, value };
  return value;
}

// ---------- helpers ----------
const R = () => replies(state.profile.language);
export const currentStaff = (s = state) => s.staff.find(x => x.id === s.currentStaffId) || null;
export const isOwner = (s = state) => { const c = currentStaff(s); return !c || c.isOwner; };
export function toast(text, tone = 'info') { setState(d => { d.alerts.push({ id: uid('al'), kind: 'toast', text, tone, at: Date.now() }); }); }
export function dismissAlert(id) { setState(d => { d.alerts = d.alerts.filter(a => a.id !== id); }); }
const findProduct = (d, id) => d.products.find(p => p.id === id);
function findOrCreateCustomer(d, c) {
  if (!c || !c.name) return null;
  let cust = (c.id && d.customers.find(x => x.id === c.id)) || d.customers.find(x => x.name.toLowerCase() === c.name.toLowerCase());
  if (!cust) { cust = { id: uid('c'), name: c.name, phone: c.phone || '', balance: 0 }; d.customers.push(cust); }
  return cust;
}
const staffStamp = d => { const s = currentStaff(d); return { staffId: s ? s.id : null, staffName: s ? s.name : d.profile.name }; };
const EVIDENCE_OF = { voice: 'voice', chat: 'manual', whatsapp: 'whatsapp', tap: 'tap', transfer: 'bank', manual: 'manual', supplier: 'supplier', system: 'manual', receipt: 'receipt' };

/** Add a transaction AND its ledger entry. Call inside setState. */
function record(d, t, evidence) {
  if (t.type === 'sale' && !t.invoiceNo) { d.invoiceSeq = (d.invoiceSeq || 0) + 1; t.invoiceNo = invoiceNo(d.invoiceSeq); }
  d.txns.unshift(t);
  appendEntry(d, { kind: 'record', ref: t.id, evidence: evidence || EVIDENCE_OF[t.source] || 'manual', data: factsOf(t), at: t.at });
  return t;
}
function verifyEvent(d, id, evidence, extra = {}) {
  appendEntry(d, { kind: 'verify', ref: id, evidence, data: extra });
}

export const invoiceNo = n => `INV-${String(n).padStart(5, '0')}`;

// ---------- Wema ----------
let wemaCache = { key: null, api: null };
export function wema() {
  const key = SERVER_URL ? 'http' : 'mock';
  if (wemaCache.key !== key) {
    wemaCache = { key, api: SERVER_URL
      ? createHttpWema(SERVER_URL, API_KEY, c => handleCredit(c))
      : createMockWema(getState, fn => setState(d => { d.wemaMock = fn(d.wemaMock); }), c => handleCredit(c)) };
  }
  return wemaCache.api;
}

// ---------- recording ----------
/** Parse free text (voice, chat or WhatsApp) and apply it. */
export function recordText(text, source = 'voice') {
  const result = parse(text, { inventory: state.products, customers: state.customers });
  return { result, ...applyParsed(result, source, text) };
}

export function applyParsed(op, source = 'voice', rawText = '', evidenceOverride = null) {
  const r = R();
  if (op.type.startsWith('query_')) return { reply: answerQuery(op), txnIds: [] };
  if (op.type === 'unknown') return { reply: r.notUnderstood, txnIds: [] };
  if ((op.type === 'sale' || op.type === 'restock') && !op.items.length) {
    return { reply: r.unknownItem(op.unknown[0]?.name || '?'), txnIds: [], needsProduct: op.unknown[0] || null };
  }
  const txnIds = [];
  let reply = '', warn = '';
  setState(d => {
    const stamp = staffStamp(d);
    const ev = evidenceOverride || EVIDENCE_OF[source] || 'manual';
    if (op.type === 'sale') {
      const items = op.items.map(it => { const p = findProduct(d, it.productId); return { productId: it.productId, name: p.name, qty: it.qty, unit: p.unit, price: it.price ?? p.price, cost: p.cost }; });
      const total = op.total || items.reduce((a, i) => a + i.qty * i.price, 0);
      const paid = Math.min(op.paid ?? total, total);
      const cust = findOrCreateCustomer(d, op.customer);
      if (cust && total - paid > 0) cust.balance += total - paid;
      for (const it of items) {
        const p = findProduct(d, it.productId);
        p.qty = Math.max(0, p.qty - it.qty); p.updatedAt = Date.now();
        if (p.qty <= p.lowAt) warn = p.qty <= 0 ? r.stockOut(p.name) : r.lowWarn(p.name, p.qty, p.unit);
      }
      const t = record(d, { id: uid('t'), type: 'sale', items, amount: total, paid, customerId: cust?.id || null, customerName: cust?.name || op.customer?.name || null,
        source, payStatus: op.payStatus || (paid <= 0 ? 'credit' : 'cash'), at: Date.now(), note: '', raw: rawText, ...stamp }, ev);
      txnIds.push(t.id);
      reply = r.sale(items, total, total - paid, cust?.name || '');
    } else if (op.type === 'restock') {
      const items = op.items.map(it => { const p = findProduct(d, it.productId); return { productId: it.productId, name: p.name, qty: it.qty, unit: p.unit, price: it.cost ?? p.cost, cost: it.cost ?? p.cost }; });
      for (const it of items) { const p = findProduct(d, it.productId); p.qty += it.qty; p.updatedAt = Date.now(); }
      const amount = op.cost ?? items.reduce((a, i) => a + i.qty * i.cost, 0);
      const t = record(d, { id: uid('t'), type: 'restock', items, amount, paid: amount, source, payStatus: 'cash', at: Date.now(), note: op.note || '', raw: rawText, ...stamp }, ev);
      txnIds.push(t.id);
      reply = r.restock(items);
    } else if (op.type === 'debt_payment') {
      const cust = findOrCreateCustomer(d, op.customer || { name: 'Customer' });
      const before = cust.balance;
      cust.balance = Math.max(0, cust.balance - op.amount);
      const t = record(d, { id: uid('t'), type: 'debtPayment', items: [], amount: op.amount, paid: op.amount, customerId: cust.id, customerName: cust.name, source, payStatus: 'cash', at: Date.now(), note: 'Debt payment', raw: rawText, prevBalance: before, ...stamp }, ev);
      txnIds.push(t.id);
      reply = r.debtPaid(cust.name, op.amount, cust.balance);
    }
  });
  return { reply: warn ? `${reply} ${warn}` : reply, txnIds };
}

/** Mistakes are never deleted: a reversal entry cancels the original and both stay on record. */
export function reverseTxn(id, reason = 'Entered by mistake') {
  setState(d => {
    const t = d.txns.find(x => x.id === id);
    if (!t || t.reversed) return;
    if (t.type === 'sale') {
      for (const it of t.items) { const p = findProduct(d, it.productId); if (p) p.qty += it.qty; }
      const c = t.customerId && d.customers.find(x => x.id === t.customerId);
      if (c) c.balance = Math.max(0, c.balance - (t.amount - t.paid));
    } else if (t.type === 'restock') {
      for (const it of t.items) { const p = findProduct(d, it.productId); if (p) p.qty = Math.max(0, p.qty - it.qty); }
    } else if (t.type === 'debtPayment') {
      const c = d.customers.find(x => x.id === t.customerId);
      if (c) c.balance = t.prevBalance ?? c.balance + t.amount;
    }
    t.reversed = true; t.reversedReason = reason;
    appendEntry(d, { kind: 'reversal', ref: id, evidence: 'manual', data: { reason, by: staffStamp(d).staffName } });
  });
}
export const undoTxn = id => reverseTxn(id, 'Undone right after recording');

// ---------- quick sales & restocks (no typing) ----------
/** Till checkout. method: cash | transfer | credit | part. */
export function completeSale({ items, customer = null, method = 'cash', paidNow = null, payStatus = null }) {
  const total = items.reduce((a, i) => a + i.qty * i.price, 0);
  const paid = method === 'credit' ? 0 : method === 'part' ? Math.min(Number(paidNow) || 0, total) : total;
  const res = applyParsed({ type: 'sale', items, total, paid, customer, payStatus: payStatus || (method === 'transfer' ? 'pending' : paid <= 0 ? 'credit' : 'cash') }, 'tap');
  return { ...res, total, paid };
}
export function quickRestock(changes) { // { productId: qty }
  const items = Object.entries(changes).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }));
  if (!items.length) return null;
  return applyParsed({ type: 'restock', items }, 'tap');
}

// ---------- answering questions ----------
export function answerQuery(q) {
  const r = R();
  const s = state;
  const live = s.txns.filter(t => !t.reversed);
  switch (q.type) {
    case 'query_stock': {
      const p = s.products.find(x => x.id === q.productId);
      if (!p) return r.notUnderstood;
      if (p.qty <= 0) return r.stockOut(p.name);
      const f = restockForecast([p], live).at(0);
      const extra = f && isFinite(f.daysLeft) && f.daysLeft < 7 ? ` (${Math.max(1, Math.round(f.daysLeft))} day${Math.round(f.daysLeft) <= 1 ? '' : 's'} at this rate)` : '';
      return r.stock(p.name, p.qty, p.unit) + extra;
    }
    case 'query_sales': {
      const t = totals(live, q.period);
      if (!t.count) return r.noSales(q.period);
      const [from, to] = periodRange(q.period);
      const best = Object.values(qtySold(live, from, to)).sort((a, b) => b.revenue - a.revenue)[0];
      return r.sales(q.period, t.revenue, t.count, best?.name);
    }
    case 'query_profit': return r.profit(q.period, totals(live, q.period).profit);
    case 'query_best': {
      const [from, to] = periodRange('week');
      const best = Object.values(qtySold(live, from, to)).sort((a, b) => b.qty - a.qty)[0];
      return best ? r.best(best.name, qtyUnit(best.qty, best.unit)) : r.noSales('week');
    }
    case 'query_slow': {
      const [from, to] = periodRange('week');
      const sold = qtySold(live, from, to);
      const slow = s.products.filter(p => p.qty > 0).map(p => ({ p, q: sold[p.id]?.qty || 0 })).sort((a, b) => a.q - b.q)[0];
      return slow ? r.slow(slow.p.name, qtyUnit(slow.q, slow.p.unit)) : r.allGood;
    }
    case 'query_debts': {
      const owing = s.customers.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance);
      return owing.length ? r.debts(owing.slice(0, 5).map(c => `${c.name} ${naira(c.balance)}`).join(', ')) : r.noDebts;
    }
    case 'query_low_stock': {
      const low = s.products.filter(p => p.qty <= p.lowAt);
      return low.length ? r.low(low.map(p => `${p.name} (${p.qty})`).join(', ')) : r.allGood;
    }
    default: return r.notUnderstood;
  }
}

// ---------- assistant chat ----------
export function sendChat(text, viaVoice = false) {
  setState(d => { d.chat.push({ id: uid('m'), fromUser: true, text, at: Date.now(), voice: viaVoice }); });
  const { result, reply, txnIds, needsProduct } = recordText(text, viaVoice ? 'voice' : 'chat');
  setState(d => {
    d.chat.push({ id: uid('m'), fromUser: false, text: reply, at: Date.now(), txnIds, kind: result.type, needsProduct: needsProduct || null });
    if (d.chat.length > 200) d.chat.splice(0, d.chat.length - 200);
  });
  return { reply, result, txnIds };
}

// WhatsApp preview inside the app (grouped confirmations, like the real channel)
const WA_BATCH = 5;
export function whatsappSimSend(text) {
  setState(d => { d.waSim.push({ fromUser: true, text, at: Date.now() }); });
  const { result, reply } = recordText(text, 'whatsapp');
  setState(d => {
    const isEntry = ['sale', 'restock', 'debt_payment'].includes(result.type) && !reply.startsWith('"');
    if (isEntry && !d.profile.premium) {
      d.waSim.push({ fromUser: false, pendingConfirm: true, text: reply, at: Date.now(), hidden: true });
      const batch = d.waSim.filter(m => m.pendingConfirm);
      if (batch.length >= WA_BATCH) { batch.forEach(m => { m.pendingConfirm = false; }); d.waSim.push({ fromUser: false, text: `✅ Recorded ${batch.length} entries. Open Vendora for details.`, at: Date.now() }); }
      else d.waSim.push({ fromUser: false, text: '✓', tick: true, at: Date.now() });
    } else if (isEntry) {
      d.waSim.push({ fromUser: false, text: `✅ ${reply}`, at: Date.now() });
    } else {
      const batch = d.waSim.filter(m => m.pendingConfirm);
      if (batch.length) { batch.forEach(m => { m.pendingConfirm = false; }); d.waSim.push({ fromUser: false, text: `✅ Recorded ${batch.length} ${batch.length === 1 ? 'entry' : 'entries'}.`, at: Date.now() }); }
      d.waSim.push({ fromUser: false, text: reply, at: Date.now() });
    }
    d.waSim = d.waSim.filter(m => !m.tick || m === d.waSim[d.waSim.length - 1]);
    if (d.waSim.length > 100) d.waSim.splice(0, d.waSim.length - 100);
  });
}

// ---------- products & customers ----------
export function saveProduct(p) {
  let id = p.id;
  setState(d => {
    const clean = { ...p, price: Number(p.price) || 0, cost: Number(p.cost) || 0, qty: Number(p.qty) || 0, lowAt: Number(p.lowAt) || 0,
      aliases: typeof p.aliases === 'string' ? p.aliases.split(',').map(s => s.trim()).filter(Boolean) : p.aliases || [], updatedAt: Date.now() };
    const i = d.products.findIndex(x => x.id === p.id);
    if (i >= 0) {
      const before = d.products[i];
      if (before.qty !== clean.qty) appendEntry(d, { kind: 'adjust', ref: before.id, evidence: 'manual', data: { from: before.qty, to: clean.qty, reason: p.reason || 'Stock count corrected', by: staffStamp(d).staffName } });
      if (before.price !== clean.price || before.cost !== clean.cost) appendEntry(d, { kind: 'price', ref: before.id, evidence: 'manual', data: { price: clean.price, cost: clean.cost } });
      d.products[i] = clean;
    } else {
      id = p.id || uid('p');
      d.products.push({ ...clean, id });
      appendEntry(d, { kind: 'product', ref: id, evidence: 'manual', data: { name: clean.name, qty: clean.qty, price: clean.price, cost: clean.cost } });
    }
  });
  return id;
}
export function deleteProduct(id) {
  setState(d => { d.products = d.products.filter(p => p.id !== id); appendEntry(d, { kind: 'product-removed', ref: id, evidence: 'manual', data: {} }); });
}
export function saveCustomer(c) {
  setState(d => {
    const i = d.customers.findIndex(x => x.id === c.id);
    if (i >= 0) d.customers[i] = { ...d.customers[i], ...c };
    else {
      const nc = { id: uid('c'), balance: 0, phone: '', ...c };
      d.customers.push(nc);
      if (nc.balance > 0) appendEntry(d, { kind: 'opening-debt', ref: nc.id, evidence: 'manual', data: { name: nc.name, amount: nc.balance } });
    }
  });
}
export function recordDebtPayment(customerId, amount) {
  const c = state.customers.find(x => x.id === customerId);
  return applyParsed({ type: 'debt_payment', customer: { id: c.id, name: c.name }, amount: Number(amount) }, 'manual');
}

// ---------- payments ----------
export async function requestPayment({ amount, items = [], customerName = null }) {
  if (!state.profile.accountNumber) throw new WemaError('Open your Wema account first.');
  let saleId = null;
  if (items.length) saleId = completeSale({ items, customer: customerName ? { name: customerName } : null, method: 'transfer' }).txnIds[0];
  const pr = await wema().createPaymentRequest(state.profile.accountNumber, amount, saleId);
  setState(d => { d.paymentRequests.unshift(pr); const t = saleId && d.txns.find(x => x.id === saleId); if (t) t.paymentRef = pr.ref; });
  return pr;
}

export function guessForAmount(amount) {
  for (const p of state.products) for (let q = 1; q <= 10; q++) if (Math.abs(p.price * q - amount) < 1) return { product: p, qty: q };
  return null;
}

/** Money arrived in the trader's Wema account. */
export function handleCredit(c) {
  if (state.credits.some(x => x.id === c.id)) return;
  setState(d => {
    const credit = { ...c, handled: false };
    d.credits.unshift(credit);
    if (c.at > d.sync.creditsSince) d.sync.creditsSince = c.at;
    const sale = c.saleId && d.txns.find(t => t.id === c.saleId);
    if (sale) {
      sale.payStatus = c.amount >= sale.paid ? 'verified' : 'unverified';
      sale.payerName = c.senderName;
      credit.handled = true; credit.linkedTxnId = sale.id;
      verifyEvent(d, sale.id, 'bank', { amount: c.amount, reference: c.reference || null });
      d.alerts.push({ id: uid('al'), kind: 'toast', tone: 'good', text: `${naira(c.amount)} received from ${c.senderName}. Confirmed by Wema.`, at: Date.now() });
    } else {
      d.alerts.push({ id: uid('al'), kind: 'credit', creditId: c.id, at: Date.now() });
    }
  });
}
export function reopenCredit(id) {
  setState(d => { if (!d.alerts.some(a => a.kind === 'credit' && a.creditId === id)) d.alerts.push({ id: uid('al'), kind: 'credit', creditId: id, at: Date.now() }); });
}

/** Trader answers "What was this payment for?" */
export function resolveCredit(creditId, choice) {
  const c = state.credits.find(x => x.id === creditId);
  if (!c) return null;
  const ev = c.viaReceipt ? 'receipt' : 'bank';
  let txnId = null;
  if (choice.type === 'sale') {
    txnId = applyParsed({ type: 'sale', items: choice.items, total: c.amount, paid: c.amount, customer: { name: c.senderName }, payStatus: 'verified' }, 'transfer', '', ev).txnIds[0];
  } else if (choice.type === 'debt') {
    const cust = state.customers.find(x => x.id === choice.customerId);
    txnId = applyParsed({ type: 'debt_payment', customer: { id: cust.id, name: cust.name }, amount: c.amount }, 'transfer', '', ev).txnIds[0];
    setState(d => { const t = d.txns.find(x => x.id === txnId); if (t) t.payStatus = 'verified'; });
  } else {
    setState(d => { const t = record(d, { id: uid('t'), type: 'income', items: [], amount: c.amount, paid: c.amount, customerName: c.senderName, source: 'transfer', payStatus: 'verified', at: Date.now(), note: 'Money received', ...staffStamp(d) }, ev); txnId = t.id; });
  }
  setState(d => {
    const cc = d.credits.find(x => x.id === creditId); if (cc) { cc.handled = true; cc.linkedTxnId = txnId; }
    d.alerts = d.alerts.filter(a => !(a.kind === 'credit' && a.creditId === creditId));
  });
  return txnId;
}

/**
 * "Customer says they paid": check the receipt (scanned or typed) against the real Wema account.
 * A receipt (same reference or same picture) can only ever be used once.
 */
export async function confirmPayment({ amount, senderName = '', reference = '', fingerprint = null, txnId = null }) {
  if (!state.profile.accountNumber) throw new WemaError('Open your Wema account first.');
  const ref = String(reference || '').replace(/\s/g, '');
  const used = (ref && state.usedReceipts['ref:' + ref]) || (fingerprint && state.usedReceipts['img:' + fingerprint]);
  if (used) return { verified: false, duplicate: true, message: `This receipt was already used on ${new Date(used.at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}. It can't be used again.` };
  const res = await wema().verifyTransfer(state.profile.accountNumber, Number(amount), senderName, ref);
  setState(d => {
    if (res.verified) {
      const mark = { at: Date.now(), amount: Number(amount) };
      if (ref) d.usedReceipts['ref:' + ref] = mark;
      if (fingerprint) d.usedReceipts['img:' + fingerprint] = mark;
      if (res.credit?.reference) d.usedReceipts['ref:' + res.credit.reference] = mark;
    }
    const t = txnId && d.txns.find(x => x.id === txnId);
    if (t) {
      t.payStatus = res.verified ? 'verified' : 'unverified';
      t.flagged = !res.verified;
      if (res.verified) { t.payerName = res.credit?.senderName || senderName; verifyEvent(d, t.id, 'receipt', { amount: Number(amount), reference: ref || res.credit?.reference || null }); }
    }
    if (!res.verified) appendEntry(d, { kind: 'failed-check', ref: txnId || 'none', evidence: 'manual', data: { amount: Number(amount), reference: ref || null } });
  });
  if (res.verified && !txnId && res.credit) handleCredit({ ...res.credit, viaReceipt: true });
  return res;
}

export const simulateCustomerPayment = p => wema().simulateCustomerPayment({ accountNumber: state.profile.accountNumber, ...p });

// ---------- score & loans ----------
export const businessScoreNow = () => scoreFor(state, integrity().ok);
export async function getLoanOffer() {
  if (!state.profile.accountNumber) return { eligible: false, reason: 'Open your Wema account to see loan offers.' };
  return wema().loanOffer(state.profile.accountNumber, businessScoreNow());
}
export async function takeLoan({ amount, supplier, order }) {
  const loan = await wema().takeLoan(state.profile.accountNumber, Number(amount), supplier, businessScoreNow());
  setState(d => {
    d.loans.unshift({ ...loan, supplierName: supplier.name, supplierAccount: supplier.accountNumber, lastAutoRepayDay: startOfDay() });
    appendEntry(d, { kind: 'loan', ref: loan.id, evidence: 'bank', data: { amount: Number(amount), supplier: supplier.name } });
  });
  if (order) placeOrder({ ...order, pay: 'loan', loanId: loan.id });
  toast(`Wema paid ${naira(amount)} to ${supplier.name}.`, 'good');
  return loan;
}
export async function repayLoan(id, amount) {
  const loan = await wema().repay(id, Number(amount));
  setState(d => {
    const l = d.loans.find(x => x.id === id);
    if (l) Object.assign(l, { repaid: loan.repaid, status: loan.status });
    record(d, { id: uid('t'), type: 'loanRepayment', items: [], amount: Number(amount), paid: Number(amount), source: 'system', payStatus: 'verified', at: Date.now(), note: 'Loan repayment' }, 'bank');
  });
  return loan;
}

// ---------- Vendors Hub orders ----------
export function placeOrder({ sellerId, lines, pay = 'wallet', loanId = null }) {
  const s = hubSeller(sellerId);
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const id = uid('o');
  setState(d => {
    d.orders.unshift({ id, sellerId, sellerName: s.name, lines, total, pay, loanId, status: 'on the way', at: Date.now(), etaHours: s.deliveryHours });
    appendEntry(d, { kind: 'order', ref: id, evidence: pay === 'loan' ? 'bank' : 'manual', data: { seller: s.name, total, lines: lines.map(l => [l.key, l.qty, l.price]) } });
  });
  return id;
}
/** Goods arrived: stock goes up with "verified supplier" evidence. */
export function confirmDelivery(orderId) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o || o.status === 'delivered') return;
  const items = [];
  for (const l of o.lines) {
    let pid = l.productId;
    if (!pid) pid = saveProduct({ name: l.name, unit: l.unit, price: Math.round(l.price * 1.2), cost: l.price, qty: 0, lowAt: 2, aliases: [] });
    items.push({ productId: pid, qty: l.qty, cost: l.price });
  }
  const res = applyParsed({ type: 'restock', items, cost: o.total, note: `Delivered by ${o.sellerName}` }, 'supplier');
  setState(d => { const x = d.orders.find(y => y.id === orderId); x.status = 'delivered'; x.deliveredAt = Date.now(); x.txnId = res.txnIds[0]; });
  toast(`Stock updated from ${o.sellerName}.`, 'good');
}

// ---------- daily jobs: savings + automatic loan repayment ----------
export async function runDaily(now = Date.now()) {
  const today = startOfDay(now);
  if (state.savings.enabled) {
    const from = state.savings.lastSavedDay ? state.savings.lastSavedDay + DAY : today - DAY;
    let added = 0; const hist = [];
    for (let day = from; day < today; day += DAY) {
      const daySales = state.txns.filter(t => t.type === 'sale' && !t.reversed && t.at >= day && t.at < day + DAY).reduce((a, t) => a + t.amount, 0);
      const amt = Math.round(daySales * state.savings.percent / 100);
      if (amt > 0) { added += amt; hist.push({ day, amount: amt }); }
    }
    if (from < today) setState(d => { d.savings.balance += added; d.savings.lastSavedDay = today - DAY; d.savings.history.unshift(...hist.reverse()); d.savings.history = d.savings.history.slice(0, 60); });
    if (added > 0) toast(`${naira(added)} moved to your savings.`, 'good');
  }
  const plan = state.cac.plan;
  if (plan && state.cac.status === 'saving') {
    const from = plan.lastDay ? plan.lastDay + DAY : startOfDay(plan.startedAt) + DAY;
    let add = 0; const hist = [];
    for (let day = from; day <= today && plan.saved + add < plan.target; day += DAY) {
      const a = Math.min(plan.daily, plan.target - plan.saved - add);
      add += a; hist.push({ day, amount: a });
    }
    if (add > 0) {
      setState(d => {
        const p = d.cac.plan; p.saved += add; p.lastDay = today; p.history.unshift(...hist.reverse());
        if (p.saved >= p.target) d.cac.status = 'ready';
      });
      toast(state.cac.status === 'ready' ? 'Your CAC money is complete. Fill the short form to register.' : `${naira(add)} kept aside for your CAC registration.`, 'good');
    }
  }
  if (state.profile.autoRepay) {
    for (const l of state.loans.filter(x => x.status === 'active')) {
      const last = l.lastAutoRepayDay || startOfDay(l.createdAt);
      const days = Math.floor((today - last) / DAY);
      if (days <= 0) continue;
      const amt = Math.min(days * l.dailyRepayment, l.totalRepayable - l.repaid);
      try { await repayLoan(l.id, amt); setState(d => { const x = d.loans.find(y => y.id === l.id); if (x) x.lastAutoRepayDay = today; }); } catch { /* offline: retry later */ }
    }
  }
}
export function setSavings(patch) { setState(d => { Object.assign(d.savings, patch); if (patch.enabled && !d.savings.lastSavedDay) d.savings.lastSavedDay = startOfDay() - DAY; }); }
export function withdrawSavings(amount) {
  const a = Math.min(Number(amount) || 0, state.savings.balance);
  setState(d => { d.savings.balance -= a; d.savings.history.unshift({ day: Date.now(), amount: -a }); });
  toast(`${naira(a)} moved to your Wema account.`);
}

// ---------- shop location ----------
export function setLocation(loc) {
  setState(d => {
    d.profile.location = loc;
    appendEntry(d, { kind: 'location', ref: 'shop', evidence: 'manual', data: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy } });
  });
}

// ---------- CAC registration through Wema (save a little daily, Wema files it) ----------
export const CAC_TARGET = 25000;
export function startCacPlan(daily) {
  setState(d => {
    const prev = d.cac.plan;
    d.cac.plan = { daily: Number(daily), target: CAC_TARGET, saved: prev?.saved || 0, startedAt: prev?.startedAt || Date.now(), lastDay: prev?.lastDay || startOfDay(), history: prev?.history || [] };
    d.cac.status = d.cac.plan.saved >= CAC_TARGET ? 'ready' : 'saving';
  });
}
export function cacTopUp(amount) {
  const a = Math.min(Number(amount) || 0, CAC_TARGET - (state.cac.plan?.saved || 0));
  if (a <= 0) return;
  setState(d => {
    d.cac.plan.saved += a; d.cac.plan.history.unshift({ day: Date.now(), amount: a, manual: true });
    if (d.cac.plan.saved >= d.cac.plan.target) d.cac.status = 'ready';
  });
  toast(`${naira(a)} added to your CAC savings.`, 'good');
}
export function stopCacPlan() {
  setState(d => { if (d.cac.plan) d.cac.plan.paused = true; d.cac.status = 'paused'; });
}
export function resumeCacPlan() {
  setState(d => { if (d.cac.plan) { d.cac.plan.paused = false; d.cac.plan.lastDay = startOfDay(); } d.cac.status = d.cac.plan?.saved >= CAC_TARGET ? 'ready' : 'saving'; });
}
/** Send the registration details. Wema files with CAC; status moves to approved, then registered. */
export function submitCac(form) {
  setState(d => {
    d.cac.application = { ...form, submittedAt: Date.now() };
    d.cac.status = 'submitted';
    appendEntry(d, { kind: 'cac', ref: 'application', evidence: 'bank', data: { names: form.names, type: form.type } });
  });
}
/** Mock: CAC replies after a short wait. In production this comes from Wema's webhook. */
export function refreshCac(now = Date.now()) {
  const c = state.cac;
  if (!c.application || !['submitted', 'approved'].includes(c.status)) return;
  const waited = now - c.application.submittedAt;
  if (c.status === 'submitted' && waited > 20e3) setState(d => { d.cac.status = 'approved'; d.cac.application.approvedName = d.cac.application.names[0]; });
  if (waited > 60e3) setState(d => {
    if (d.cac.status === 'registered') return;
    d.cac.status = 'registered';
    d.cac.number = 'BN ' + String(3000000 + Math.floor(Math.random() * 999999));
    d.cac.registeredAt = Date.now();
    appendEntry(d, { kind: 'cac', ref: 'registered', evidence: 'bank', data: { number: d.cac.number } });
  });
}

// ---------- Vendors Hub advert ----------
export function saveAdvert(ad) {
  setState(d => { d.advert = { ...(d.advert || {}), ...ad, updatedAt: Date.now() }; });
}

// ---------- records sent to Wema ----------
export function recordSubmission(sub) {
  setState(d => {
    d.submissions.unshift(sub);
    appendEntry(d, { kind: 'submission', ref: sub.id, evidence: 'bank', data: { file: sub.fileName, sha256: sub.sha256, from: sub.from, to: sub.to, invoices: sub.invoices } });
  });
}

// ---------- staff (shop assistant mode) ----------
export function addStaff(name, pin) { setState(d => { d.staff.push({ id: uid('s'), name, pin, isOwner: false }); }); }
export function removeStaff(id) { setState(d => { d.staff = d.staff.filter(s => s.id !== id || s.isOwner); }); }
export function setStaffPin(id, pin) { setState(d => { const x = d.staff.find(y => y.id === id); if (x) x.pin = pin; }); }
export function switchStaff(pin) {
  const s = state.staff.find(x => x.pin === pin);
  if (!s) return false;
  setState(d => { d.currentStaffId = s.id; });
  return true;
}
export function staffSummary(now = Date.now()) {
  const from = startOfDay(now);
  const map = {};
  for (const t of state.txns) if (t.type === 'sale' && !t.reversed && t.at >= from) {
    const k = t.staffName || state.profile.name || 'Owner';
    const e = map[k] || (map[k] = { name: k, count: 0, revenue: 0 });
    e.count++; e.revenue += t.amount;
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

// ---------- profile / onboarding ----------
export function updateProfile(patch) { setState(d => { Object.assign(d.profile, patch); }); }
export function completeSetup(fields) {
  setState(d => {
    Object.assign(d.profile, fields);
    if (!d.staff.length) { d.staff.push({ id: 'owner', name: fields.name || 'Owner', pin: '0000', isOwner: true }); d.currentStaffId = 'owner'; }
  });
}
export async function openAccount(idNumber) {
  const p = state.profile;
  const acct = await wema().openAccount({ name: p.name, phone: p.phone, idNumber, businessName: p.businessName });
  setState(d => { d.profile.accountNumber = acct.accountNumber; d.profile.accountName = acct.accountName; });
  return acct;
}
export function finishOnboarding() { setState(d => { d.profile.onboarded = true; }); }

export function loadDemo() {
  const demo = buildDemo();
  const s = { ...emptyState(), ...demo, ledger: [] };
  // Write the demo history into the secured ledger, oldest first
  const ordered = [...demo.txns].sort((a, b) => a.at - b.at);
  for (const t of ordered) {
    appendEntry(s, { kind: 'record', ref: t.id, evidence: t.evidence || EVIDENCE_OF[t.source] || 'manual', data: factsOf(t), at: t.at });
  }
  for (const t of demo.txns) delete t.evidence;
  let n = 0;
  for (const t of ordered) if (t.type === 'sale') t.invoiceNo = invoiceNo(++n);
  s.invoiceSeq = n;
  state = s; wemaCache = { key: null, api: null }; integrityCache = { key: '', value: null };
  persist(); listeners.forEach(l => l()); scheduleSign();
}
export function resetAll() { state = emptyState(); wemaCache = { key: null, api: null }; persist(); listeners.forEach(l => l()); }

// ---------- sync with the Vendora server (WhatsApp entries, Wema credits, ledger anchoring) ----------
let syncing = false;
export async function syncNow() {
  const p = state.profile;
  if (!SERVER_URL || syncing || !p.phone) return { skipped: true };
  syncing = true;
  try {
    const api = wema();
    const head = state.ledger[state.ledger.length - 1];
    const body = {
      phone: p.phone, ackedThrough: state.sync.ackedThrough, creditsSince: state.sync.creditsSince,
      profile: { name: p.name, businessName: p.businessName, language: p.language, accountNumber: p.accountNumber, whatsappAlerts: p.whatsappAlerts },
      inventory: state.products.map(({ id, name, aliases, unit, price, qty, lowAt }) => ({ id, name, aliases, unit, price, qty, lowAt })),
      customers: state.customers.map(({ id, name, balance }) => ({ id, name, balance })),
      ledgerHead: head ? { seq: head.seq, hash: head.hash, sig: head.sig || null, key: state.ledgerKey?.publicJwk || null } : null,
    };
    const res = await api.call('POST', '/api/sync', body);
    let last = state.sync.ackedThrough;
    for (const e of res.entries || []) {
      if (e.op && e.op.type !== 'voice_pending') applyParsed(e.op, 'whatsapp', e.text || '');
      last = Math.max(last, e.seq);
    }
    for (const c of res.credits || []) handleCredit(c);
    setState(d => { d.sync.ackedThrough = last; d.sync.lastSyncAt = Date.now(); d.sync.lastError = null; if (res.sealOk !== undefined) d.sync.sealOk = res.sealOk; });
    if ((res.entries || []).length) toast(`${res.entries.length} WhatsApp ${res.entries.length === 1 ? 'entry' : 'entries'} added.`, 'good');
    return res;
  } catch (e) {
    setState(d => { d.sync.lastError = e.message; });
    return { error: e.message };
  } finally { syncing = false; }
}
export const hasServer = () => !!SERVER_URL;

export { WemaError };
