'use strict';
const express = require('express');
const { createStore } = require('./store');
const { createWema } = require('./wema');
const { createWhatsApp, normPhone } = require('./whatsapp');
const { applyOp } = require('./snapshot');
const { businessScore, loanOffer } = require('./finance');

function createApp(opts = {}) {
  const store = opts.store || createStore(opts.dataFile);
  const apiKey = opts.apiKey ?? process.env.VENDORA_API_KEY ?? '';
  const wa = createWhatsApp(store, opts.whatsapp || {});
  const wema = createWema(store, {
    // Real-time payment alert on WhatsApp (an important, un-batched message).
    onCredit: (credit, acct) => {
      const phone = normPhone(acct.phone);
      const trader = store.data.traders[phone];
      if (trader && trader.whatsappAlerts !== false) {
        const amt = '₦' + credit.amount.toLocaleString('en-NG');
        wa.send(phone, `💰 ${amt} received from ${credit.senderName}. Confirmed by Wema ✅`).catch(() => {});
      }
    },
  });

  const app = express();
  app.use(express.json({ limit: '15mb' }));
  // The web app may be served from a different origin (e.g. a phone opening the PWA).
  const allowed = (process.env.CORS_ORIGINS || '*').split(',').map(x => x.trim());
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'content-type, x-vendora-key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/health', (req, res) => res.json({ ok: true, mode: process.env.WEMA_MODE || 'mock' }));

  // WhatsApp webhook is called by Meta, so it is not behind the app API key.
  app.use('/whatsapp', wa.router);

  // Everything the app calls needs the API key (when one is configured).
  app.use((req, res, next) => {
    if (!apiKey || req.get('x-vendora-key') === apiKey) return next();
    res.status(401).json({ error: 'Invalid API key' });
  });
  app.use('/wema', wema.router);

  /**
   * POST /api/sync
   * body: {phone, profile:{name,businessName,language,accountNumber,whatsappAlerts},
   *        inventory:[{id,name,aliases,unit,price,qty,lowAt}], customers:[{id,name,balance}], ackedThrough}
   * The phone is the source of truth. The server replaces its snapshot with the phone's,
   * re-applies WhatsApp entries the phone hasn't acknowledged yet, and returns them.
   */
  app.post('/api/sync', (req, res) => {
    const b = req.body || {};
    const phone = normPhone(b.phone);
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const acked = Number(b.ackedThrough || 0);
    const db = store.data;
    // drop acknowledged entries
    db.inbox = db.inbox.filter(e => !(e.phone === phone && e.seq <= acked));
    const trader = db.traders[phone] || { phone };
    Object.assign(trader, b.profile || {}, {
      phone,
      inventory: (b.inventory || []).map(p => ({ ...p })),
      customers: (b.customers || []).map(c => ({ ...c })),
      updatedAt: Date.now(),
    });
    // Anchor the phone's sealed record: the history can only grow. A shorter or different chain is flagged for Wema.
    let sealOk = true;
    const h = b.ledgerHead;
    if (h && Number.isInteger(h.seq) && typeof h.hash === 'string') {
      const anchors = trader.seals || [];
      const last = anchors[anchors.length - 1];
      const same = anchors.find(a => a.seq === h.seq);
      if ((last && h.seq < last.seq) || (same && same.hash !== h.hash)) { sealOk = false; trader.sealAlert = { at: Date.now(), head: h, expected: same || last }; }
      else if (!last || h.seq > last.seq) anchors.push({ seq: h.seq, hash: h.hash, sig: h.sig || null, at: Date.now() });
      if (h.key && !trader.deviceKey) trader.deviceKey = h.key;
      trader.seals = anchors.slice(-500);
    }
    const fresh = db.inbox.filter(e => e.phone === phone).sort((a, b2) => a.seq - b2.seq);
    for (const e of fresh) if (e.op && e.op.type !== 'voice_pending') applyOp(trader, JSON.parse(JSON.stringify(e.op)));
    db.traders[phone] = trader;
    const acct = trader.accountNumber;
    const credits = acct ? db.credits.filter(c => c.accountNumber === acct && c.at > Number(b.creditsSince || 0)) : [];
    store.save();
    res.json({ entries: fresh, credits, sealOk, serverTime: Date.now() });
  });

  /**
   * POST /api/submissions: the trader sends their evidence workbook (invoices, money in, deliveries, sealed record) to Wema.
   * We check the file matches the fingerprint the phone sealed, keep it, and Wema's credit team can download it.
   */
  app.post('/api/submissions', (req, res) => {
    const b = req.body || {};
    const phone = normPhone(b.phone);
    if (!phone || !b.file || !/^[0-9a-f]{64}$/.test(String(b.sha256 || ''))) return res.status(400).json({ error: 'phone, file and sha256 are required' });
    const bytes = Buffer.from(String(b.file), 'base64');
    const hash = require('crypto').createHash('sha256').update(bytes).digest('hex');
    if (hash !== b.sha256) return res.status(422).json({ error: 'The file does not match its fingerprint. Please send it again.' });
    const db = store.data;
    db.submissions = db.submissions || [];
    const sub = { id: 'sub_' + Date.now().toString(36), phone, accountNumber: b.accountNumber || null, fileName: String(b.fileName || 'records.xlsx').slice(0, 120),
      sha256: hash, from: Number(b.from) || 0, to: Number(b.to) || 0, invoices: Number(b.invoices) || 0, total: Number(b.total) || 0, size: bytes.length, at: Date.now(), status: 'Received by Wema' };
    db.submissions.push({ ...sub, file: String(b.file) });
    store.save();
    res.status(201).json(sub);
  });
  app.get('/api/submissions', (req, res) => {
    const phone = normPhone(req.query.phone);
    res.json(((store.data.submissions) || []).filter(s => !phone || s.phone === phone).map(({ file, ...s }) => s));
  });

  // Server-side score check (lets Wema recompute from the records the trader agreed to share).
  app.post('/api/score', (req, res) => {
    const s = businessScore(req.body || {});
    res.json({ ...s, offer: loanOffer(s) });
  });

  app.locals.store = store; app.locals.wa = wa; app.locals.wema = wema;
  return app;
}

module.exports = { createApp };
