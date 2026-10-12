// Wema / ALAT integration layer.
// MOCK mode simulates the bank so the full product can be demoed end to end.
// LIVE mode is where Wema's real APIs plug in once access is granted (see README: "Going live with Wema").
'use strict';
const express = require('express');
const { loanOffer, repaymentPlan } = require('./finance');

const HOUR = 60 * 60 * 1000;

function randomDigits(n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; }

function createWema(store, { onCredit } = {}) {
  const db = () => store.data;

  function openAccount({ name, phone, bvn, nin, businessName }) {
    const id = String(bvn || nin || '');
    if (!name || !phone) throw httpError(400, 'name and phone are required');
    if (!/^\d{11}$/.test(id)) throw httpError(400, 'A valid 11-digit BVN or NIN is required');
    const existing = Object.values(db().accounts).find(a => a.phone === phone);
    if (existing) return existing;
    const accountNumber = '02' + randomDigits(8);
    const acct = { accountNumber, accountName: (businessName || name).toUpperCase(), phone, bank: 'Wema Bank (ALAT)', balance: 0, createdAt: Date.now(), kycTier: 1 };
    db().accounts[accountNumber] = acct;
    store.save();
    return acct;
  }

  function requireAccount(accountNumber) {
    const a = db().accounts[accountNumber];
    if (!a) throw httpError(404, 'Account not found');
    return a;
  }

  // One-time "pay-per-sale" account number for an exact amount.
  function createPaymentRequest({ accountNumber, amount, note, saleId }) {
    requireAccount(accountNumber);
    if (!(amount > 0)) throw httpError(400, 'amount must be positive');
    const ref = store.nextId('pr');
    const pr = { ref, accountNumber, amount: Math.round(amount), note: note || '', saleId: saleId || null,
      virtualAccountNumber: '99' + randomDigits(8), bank: 'Wema Bank', status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 2 * HOUR };
    db().paymentRequests[ref] = pr;
    store.save();
    return pr;
  }

  // Simulates money arriving (in LIVE mode this is Wema's credit-notification webhook).
  function receiveCredit({ accountNumber, virtualAccountNumber, amount, senderName, senderBank, narration }) {
    let pr = null;
    if (virtualAccountNumber) {
      pr = Object.values(db().paymentRequests).find(p => p.virtualAccountNumber === virtualAccountNumber);
      if (!pr) throw httpError(404, 'Unknown pay-per-sale account');
      accountNumber = pr.accountNumber;
    }
    const acct = requireAccount(accountNumber);
    const credit = { id: store.nextId('cr'), accountNumber, amount: Math.round(amount), senderName: senderName || 'Unknown sender',
      senderBank: senderBank || 'Bank transfer', narration: narration || '', at: Date.now(), verified: true,
      paymentRequestRef: pr ? pr.ref : null, saleId: pr ? pr.saleId : null };
    if (pr) {
      if (credit.amount >= pr.amount && pr.status === 'pending' && Date.now() <= pr.expiresAt) pr.status = 'paid';
      else if (pr.status === 'pending') pr.status = credit.amount < pr.amount ? 'part_paid' : pr.status;
      pr.paidAt = credit.at;
    }
    acct.balance += credit.amount;
    db().credits.push(credit);
    store.save();
    if (onCredit) onCredit(credit, acct);
    return credit;
  }

  // "Customer says they paid" check: is there a real credit matching this amount recently?
  function verifyTransfer({ accountNumber, amount, senderName, withinMinutes = 60 }) {
    requireAccount(accountNumber);
    const since = Date.now() - withinMinutes * 60 * 1000;
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const match = db().credits.filter(c => c.accountNumber === accountNumber && c.at >= since && c.amount === Math.round(amount) && !c.claimed)
      .sort((a, b) => b.at - a.at)
      .find(c => !senderName || norm(c.senderName).includes(norm(senderName).slice(0, 4)));
    if (!match) return { verified: false, message: 'No matching payment has reached your Wema account. Do not release goods yet.' };
    match.claimed = true; store.save();
    return { verified: true, credit: match, message: `Confirmed by Wema: ₦${match.amount.toLocaleString('en-NG')} from ${match.senderName}.` };
  }

  function offer({ accountNumber, score, avgDailySales, activeDays }) {
    requireAccount(accountNumber);
    const active = Object.values(db().loans).find(l => l.accountNumber === accountNumber && l.status === 'active');
    if (active) return { eligible: false, reason: 'You already have an active loan.', activeLoan: active };
    return loanOffer({ score, avgDailySales, activeDays });
  }

  function takeLoan({ accountNumber, amount, supplier, consent, score, avgDailySales, activeDays }) {
    requireAccount(accountNumber);
    if (!consent) throw httpError(400, 'Trader consent to share business records is required');
    if (!supplier || !supplier.name || !supplier.accountNumber) throw httpError(400, 'Supplier name and account number are required');
    const o = offer({ accountNumber, score, avgDailySales, activeDays });
    if (!o.eligible) throw httpError(422, o.reason);
    if (amount > o.limit) throw httpError(422, `Maximum available is ₦${o.limit.toLocaleString('en-NG')}`);
    const plan = repaymentPlan(amount, o.rate, o.tenorDays);
    const loan = { id: store.nextId('ln'), accountNumber, principal: Math.round(amount), rate: o.rate, ...plan,
      supplier, disbursedTo: 'supplier', status: 'active', repaid: 0, repayments: [], createdAt: Date.now(),
      dueAt: Date.now() + o.tenorDays * 24 * HOUR };
    db().loans[loan.id] = loan;
    store.save();
    return loan;
  }

  function repay({ id, amount }) {
    const loan = db().loans[id];
    if (!loan) throw httpError(404, 'Loan not found');
    if (loan.status !== 'active') throw httpError(422, 'Loan is not active');
    const pay = Math.min(Math.round(amount), loan.totalRepayable - loan.repaid);
    loan.repaid += pay;
    loan.repayments.push({ amount: pay, at: Date.now() });
    if (loan.repaid >= loan.totalRepayable) loan.status = 'repaid';
    store.save();
    return loan;
  }

  const router = express.Router();
  const wrap = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  router.post('/accounts', wrap(r => openAccount(r.body)));
  router.get('/accounts/:acct', wrap(r => requireAccount(r.params.acct)));
  router.get('/accounts/:acct/credits', wrap(r => db().credits.filter(c => c.accountNumber === r.params.acct && c.at > Number(r.query.since || 0))));
  router.post('/payment-requests', wrap(r => createPaymentRequest(r.body)));
  router.get('/payment-requests/:ref', wrap(r => { const p = db().paymentRequests[r.params.ref]; if (!p) throw httpError(404, 'Not found'); return p; }));
  router.post('/verify', wrap(r => verifyTransfer(r.body)));
  router.post('/loans/offer', wrap(r => offer(r.body)));
  router.post('/loans', wrap(r => takeLoan(r.body)));
  router.post('/loans/:id/repay', wrap(r => repay({ id: r.params.id, amount: r.body.amount })));
  router.get('/accounts/:acct/loans', wrap(r => Object.values(db().loans).filter(l => l.accountNumber === r.params.acct)));
  // Demo/sandbox only: simulate a customer transfer.
  router.post('/simulate/credit', wrap(r => receiveCredit(r.body)));

  return { router, openAccount, createPaymentRequest, receiveCredit, verifyTransfer, offer, takeLoan, repay };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { createWema, httpError };
