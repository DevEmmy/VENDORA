// Wema / ALAT integration layer for the web app.
// mock: simulates the bank in the browser (works fully offline, for demos and pilots without bank access).
// http: talks to the Vendora server (server/src/wema.js), where Wema's real APIs plug in.
import { loanOffer, repaymentPlan } from './finance.js';
import { uid, naira } from './format.js';

const digits = n => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const wait = ms => new Promise(r => setTimeout(r, ms));
export class WemaError extends Error {}

export function createMockWema(getState, setMock, onCredit) {
  const ms = () => getState().wemaMock || { accounts: {}, requests: {}, credits: [], loans: {} };
  const save = fn => setMock(m => { const next = structuredClone(m || { accounts: {}, requests: {}, credits: [], loans: {} }); fn(next); return next; });

  return {
    mode: 'mock',
    async openAccount({ name, phone, idNumber, businessName }) {
      await wait(500);
      if (!/^\d{11}$/.test(idNumber || '')) throw new WemaError('Enter a valid 11-digit BVN or NIN.');
      const existing = Object.values(ms().accounts).find(a => a.phone === phone);
      if (existing) return existing;
      const acct = { accountNumber: '02' + digits(8), accountName: (businessName || name).toUpperCase(), phone, balance: 0 };
      save(m => { m.accounts[acct.accountNumber] = acct; });
      return acct;
    },
    async createPaymentRequest(accountNumber, amount, saleId) {
      await wait(400);
      if (!(amount > 0)) throw new WemaError('Amount must be more than zero.');
      const now = Date.now();
      const pr = { ref: uid('pr'), amount: Math.round(amount), virtualAccountNumber: '99' + digits(8), bank: 'Wema Bank', status: 'pending', saleId: saleId || null, createdAt: now, expiresAt: now + 2 * 3600e3 };
      save(m => { m.requests[pr.ref] = pr; });
      return pr;
    },
    async getPaymentRequest(ref) { return ms().requests[ref] || null; },
    async simulateCustomerPayment({ accountNumber, virtualAccountNumber, amount, senderName }) {
      await wait(600);
      let pr = null;
      if (virtualAccountNumber) {
        pr = Object.values(ms().requests).find(p => p.virtualAccountNumber === virtualAccountNumber);
        if (!pr) throw new WemaError('Unknown pay-per-sale account.');
        pr = { ...pr };
        if (amount >= pr.amount && pr.status === 'pending' && Date.now() <= pr.expiresAt) pr.status = 'paid';
        else if (pr.status === 'pending' && amount < pr.amount) pr.status = 'part_paid';
      }
      const credit = { id: uid('cr'), accountNumber, amount: Math.round(amount), senderName: senderName || 'Unknown sender', senderBank: 'Bank transfer', at: Date.now(), reference: '1000' + digits(26), paymentRequestRef: pr ? pr.ref : null, saleId: pr ? pr.saleId : null };
      save(m => { if (pr) m.requests[pr.ref] = pr; m.credits.push(credit); });
      onCredit(credit);
      return credit;
    },
    async verifyTransfer(accountNumber, amount, senderName, reference) {
      await wait(900);
      const since = Date.now() - 24 * 60 * 60e3;
      const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
      const sn = norm(senderName);
      const ref = String(reference || '').replace(/\s/g, '');
      const match = [...ms().credits].reverse().find(c => !c.claimed && c.at >= since && c.amount === Math.round(amount)
        && (!ref || !c.reference || c.reference === ref)
        && (!sn || norm(c.senderName).includes(sn.slice(0, 4)) || sn.includes(norm(c.senderName).slice(0, 4))));
      if (!match) return { verified: false, message: 'No matching payment has reached your Wema account. Do not release the goods yet.' };
      save(m => { const c = m.credits.find(x => x.id === match.id); if (c) c.claimed = true; });
      return { verified: true, credit: match, message: `Confirmed by Wema: ${naira(match.amount)} from ${match.senderName}.` };
    },
    async loanOffer(accountNumber, score) {
      await wait(500);
      if (Object.values(ms().loans).some(l => l.status === 'active')) return { eligible: false, reason: 'You already have an active loan.' };
      return loanOffer(score);
    },
    async takeLoan(accountNumber, amount, supplier, score) {
      const o = await this.loanOffer(accountNumber, score);
      if (!o.eligible) throw new WemaError(o.reason || 'Not eligible yet.');
      if (amount > o.limit) throw new WemaError(`Maximum available is ${naira(o.limit)}.`);
      const plan = repaymentPlan(amount, o.rate, o.tenorDays);
      const now = Date.now();
      const loan = { id: uid('ln'), accountNumber, principal: Math.round(amount), rate: o.rate, ...plan, supplier, disbursedTo: 'supplier', status: 'active', repaid: 0, repayments: [], createdAt: now, dueAt: now + o.tenorDays * 86400e3 };
      save(m => { m.loans[loan.id] = loan; });
      return loan;
    },
    async repay(id, amount) {
      await wait(400);
      const l = ms().loans[id];
      if (!l) throw new WemaError('Loan not found.');
      const loan = structuredClone(l);
      const pay = Math.min(Math.round(amount), loan.totalRepayable - loan.repaid);
      loan.repaid += pay; loan.repayments.push({ amount: pay, at: Date.now() });
      if (loan.repaid >= loan.totalRepayable) loan.status = 'repaid';
      save(m => { m.loans[id] = loan; });
      return loan;
    },
  };
}

export function createHttpWema(baseUrl, apiKey, onCredit) {
  const base = baseUrl.replace(/\/$/, '');
  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-vendora-key': apiKey } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new WemaError('No connection to Wema right now. Try again when you have network.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new WemaError(j.error || `Request failed (${r.status})`);
    return j;
  }
  const scoreBody = s => ({ score: s.score, avgDailySales: s.avgDailySales, activeDays: s.activeDays });
  return {
    mode: 'http', call,
    openAccount: ({ name, phone, idNumber, businessName }) => call('POST', '/wema/accounts', { name, phone, businessName, bvn: idNumber }),
    createPaymentRequest: (accountNumber, amount, saleId) => call('POST', '/wema/payment-requests', { accountNumber, amount, saleId }),
    getPaymentRequest: ref => call('GET', `/wema/payment-requests/${ref}`).catch(() => null),
    async simulateCustomerPayment(p) { const c = await call('POST', '/wema/simulate/credit', p); onCredit(c); return c; },
    verifyTransfer: (accountNumber, amount, senderName, reference) => call('POST', '/wema/verify', { accountNumber, amount, senderName, reference, withinMinutes: 1440 }),
    loanOffer: (accountNumber, score) => call('POST', '/wema/loans/offer', { accountNumber, ...scoreBody(score) }),
    takeLoan: (accountNumber, amount, supplier, score) => call('POST', '/wema/loans', { accountNumber, amount, supplier, consent: true, ...scoreBody(score) }),
    repay: (id, amount) => call('POST', `/wema/loans/${id}/repay`, { amount }),
  };
}
