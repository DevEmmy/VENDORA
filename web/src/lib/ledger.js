// Tamper-evident sales record ("ledger").
// - Every sale, restock, payment and correction is APPENDED; nothing is ever edited or deleted.
//   A mistake is fixed with a "reversal" entry that points at the original.
// - Each entry carries the hash of the previous one, so changing or removing any past entry breaks the chain.
// - Each entry is signed with a private key that never leaves this device (WebCrypto, non-extractable).
// - Each sale carries its evidence: bank (Wema confirmed the money), receipt (receipt checked with Wema),
//   supplier (verified supplier delivery), voice / whatsapp / tap (recorded live), manual.
// - Time can only move forward: an entry dated before the previous one is flagged.
import { sha256 } from './sha256.js';

export const EVIDENCE = {
  bank: { label: 'Confirmed by Wema', weight: 1, verified: true },
  receipt: { label: 'Receipt checked with Wema', weight: 1, verified: true },
  supplier: { label: 'Verified supplier delivery', weight: 1, verified: true },
  voice: { label: 'Recorded by voice', weight: 0.6 },
  whatsapp: { label: 'Recorded on WhatsApp', weight: 0.6 },
  tap: { label: 'Recorded on the till', weight: 0.6 },
  manual: { label: 'Typed in', weight: 0.4 },
};

export const GENESIS = '0'.repeat(64);
const CLOCK_SLACK = 2 * 60 * 1000;

// Only the facts that must never change go into the hash.
export function canonical(e) {
  return JSON.stringify([e.seq, e.kind, e.ref, e.at, e.evidence, e.data]);
}

export function factsOf(t) {
  return {
    type: t.type,
    items: (t.items || []).map(i => [i.productId, i.qty, i.price]),
    amount: t.amount, paid: t.paid ?? t.amount,
    customer: t.customerName || null, by: t.staffName || null,
  };
}

/** Append an entry to state.ledger (call inside setState). Returns the entry. */
export function appendEntry(d, { kind, ref, evidence = 'manual', data = {}, at = Date.now() }) {
  d.ledger = d.ledger || [];
  const prev = d.ledger[d.ledger.length - 1];
  const seq = prev ? prev.seq + 1 : 1;
  let flag = null;
  if (prev && at < prev.at - CLOCK_SLACK) flag = 'clock';
  const e = { seq, kind, ref, at, evidence, data, prev: prev ? prev.hash : GENESIS, flag };
  e.hash = sha256(e.prev + '|' + canonical(e));
  d.ledger.push(e);
  return e;
}

/** Check the chain. Returns {ok, count, brokenAt, reason}. */
export function verifyChain(ledger = []) {
  let prevHash = GENESIS, prevSeq = 0;
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.seq !== prevSeq + 1) return { ok: false, count: ledger.length, brokenAt: i, reason: 'An entry is missing.' };
    if (e.prev !== prevHash) return { ok: false, count: ledger.length, brokenAt: i, reason: 'Entries were reordered or removed.' };
    if (sha256(e.prev + '|' + canonical(e)) !== e.hash) return { ok: false, count: ledger.length, brokenAt: i, reason: 'An entry was changed after it was recorded.' };
    prevHash = e.hash; prevSeq = e.seq;
  }
  return { ok: true, count: ledger.length, head: prevHash };
}

/** Do the transactions on screen match what the ledger recorded? */
export function verifyTxns(txns = [], ledger = []) {
  const byRef = new Map();
  for (const e of ledger) if (e.kind === 'record') byRef.set(e.ref, e);
  const problems = [];
  for (const t of txns) {
    const e = byRef.get(t.id);
    if (!e) { problems.push({ id: t.id, reason: 'Not in the secured record' }); continue; }
    if (JSON.stringify(e.data) !== JSON.stringify(factsOf(t))) problems.push({ id: t.id, reason: 'Changed after it was recorded' });
  }
  return problems;
}

/** Best evidence for each transaction (a sale recorded by voice can later be confirmed by Wema). */
export function evidenceMap(ledger = []) {
  const m = new Map();
  const rank = k => (EVIDENCE[k]?.verified ? 2 : EVIDENCE[k] ? 1 : 0);
  for (const e of ledger) {
    if (e.kind !== 'record' && e.kind !== 'verify') continue;
    const cur = m.get(e.ref);
    if (!cur || rank(e.evidence) > rank(cur)) m.set(e.ref, e.evidence);
  }
  return m;
}

export function reversedSet(ledger = []) {
  return new Set(ledger.filter(e => e.kind === 'reversal').map(e => e.ref));
}

/** Share of sales value backed by bank/receipt/supplier evidence, over a window. */
export function trustStats(txns = [], ledger = [], from = 0) {
  const ev = evidenceMap(ledger);
  const out = { total: 0, verified: 0, byEvidence: {}, flags: ledger.filter(e => e.flag).length };
  for (const t of txns) {
    if (t.type !== 'sale' || t.reversed || t.at < from) continue;
    const k = ev.get(t.id) || 'manual';
    out.total += t.amount;
    out.byEvidence[k] = (out.byEvidence[k] || 0) + t.amount;
    if (EVIDENCE[k]?.verified) out.verified += t.amount;
  }
  out.verifiedShare = out.total ? out.verified / out.total : 0;
  return out;
}

// ---------- device signatures (WebCrypto ECDSA P-256) ----------
const DB = 'vendora-keys', STORE = 'keys';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise(res => { const t = db.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(null); }); }
async function idbPut(k, v) { const db = await idb(); return new Promise(res => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); t.onsuccess = () => res(true); t.onerror = () => res(false); }); }

const canSign = () => typeof crypto !== 'undefined' && crypto.subtle && typeof indexedDB !== 'undefined';
let keyPromise = null;
export function deviceKey() {
  if (!canSign()) return Promise.resolve(null);
  if (!keyPromise) {
    keyPromise = (async () => {
      let pair = await idbGet('ledger');
      if (!pair) {
        pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        await idbPut('ledger', pair);
      }
      const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
      return { pair, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, fingerprint: sha256(jwk.x + jwk.y).slice(0, 16) };
    })().catch(() => null);
  }
  return keyPromise;
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function signHash(hash) {
  const k = await deviceKey();
  if (!k) return null;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.pair.privateKey, new TextEncoder().encode(hash));
  return b64(sig);
}

export async function verifySignatures(ledger, publicJwk) {
  if (!canSign() || !publicJwk) return { checked: 0, bad: 0, unsigned: ledger.length };
  const key = await crypto.subtle.importKey('jwk', { ...publicJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  let checked = 0, bad = 0, unsigned = 0;
  for (const e of ledger) {
    if (!e.sig) { unsigned++; continue; }
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(e.sig), new TextEncoder().encode(e.hash));
    checked++; if (!ok) bad++;
  }
  return { checked, bad, unsigned };
}
