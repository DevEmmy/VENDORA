'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { businessScore, loanOffer, repaymentPlan, DAY } = require('../src/finance');

function start(opts = {}) {
  const app = createApp({ apiKey: 'k', whatsapp: { batchSize: 3 }, ...opts });
  return new Promise(resolve => {
    const srv = app.listen(0, () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const call = async (method, path, body, key = 'k') => {
        const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-vendora-key': key }, body: body ? JSON.stringify(body) : undefined });
        const text = await r.text();
        let json; try { json = JSON.parse(text); } catch { json = text; }
        return { status: r.status, body: json };
      };
      resolve({ app, srv, call, close: () => new Promise(r => srv.close(r)) });
    });
  });
}

const inventory = [
  { id: 'rice', name: 'Rice (50kg)', aliases: ['iresi'], unit: 'bag', price: 8500, qty: 4, lowAt: 3 },
  { id: 'milk', name: 'Peak Milk', aliases: [], unit: 'carton', price: 8400, qty: 6, lowAt: 2 },
];

test('API key is enforced on app endpoints but not on the WhatsApp webhook', async () => {
  const s = await start();
  assert.equal((await s.call('POST', '/wema/accounts', {}, 'wrong')).status, 401);
  const v = await fetch(`http://127.0.0.1:${s.srv.address().port}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vendora-dev&hub.challenge=123`);
  assert.equal(await v.text(), '123');
  await s.close();
});

test('Account opening validates BVN/NIN', async () => {
  const s = await start();
  assert.equal((await s.call('POST', '/wema/accounts', { name: 'Ngozi', phone: '08030000000', bvn: '123' })).status, 400);
  const ok = await s.call('POST', '/wema/accounts', { name: 'Ngozi Okafor', phone: '08030000000', bvn: '12345678901', businessName: 'Ngozi Provisions' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.accountNumber, /^\d{10}$/);
  // idempotent per phone
  const again = await s.call('POST', '/wema/accounts', { name: 'Ngozi Okafor', phone: '08030000000', bvn: '12345678901' });
  assert.equal(again.body.accountNumber, ok.body.accountNumber);
  await s.close();
});

test('Pay-per-sale account: paid in full marks request paid; fake claim fails verification', async () => {
  const s = await start();
  const acct = (await s.call('POST', '/wema/accounts', { name: 'Ngozi', phone: '08030000000', nin: '12345678901' })).body;
  const pr = (await s.call('POST', '/wema/payment-requests', { accountNumber: acct.accountNumber, amount: 8500, saleId: 's1' })).body;
  assert.equal(pr.status, 'pending');
  const cr = await s.call('POST', '/wema/simulate/credit', { virtualAccountNumber: pr.virtualAccountNumber, amount: 8500, senderName: 'Emeka Chukwu' });
  assert.equal(cr.body.saleId, 's1');
  assert.equal((await s.call('GET', `/wema/payment-requests/${pr.ref}`)).body.status, 'paid');
  // A customer claims they sent 5,000 but nothing arrived
  const fake = await s.call('POST', '/wema/verify', { accountNumber: acct.accountNumber, amount: 5000 });
  assert.equal(fake.body.verified, false);
  // A real direct transfer is confirmed, and can only be claimed once
  await s.call('POST', '/wema/simulate/credit', { accountNumber: acct.accountNumber, amount: 5000, senderName: 'Chidi Obi' });
  assert.equal((await s.call('POST', '/wema/verify', { accountNumber: acct.accountNumber, amount: 5000, senderName: 'Chidi' })).body.verified, true);
  assert.equal((await s.call('POST', '/wema/verify', { accountNumber: acct.accountNumber, amount: 5000 })).body.verified, false);
  await s.close();
});

test('Business score and loan offer maths', () => {
  const now = Date.now();
  const sales = [];
  for (let d = 0; d < 28; d++) sales.push({ amount: 40000 + (d % 3) * 5000, at: now - d * DAY - 1000 });
  const s = businessScore({ sales, debts: { collected: 90000, outstanding: 10000 }, now });
  assert.ok(s.score >= 60 && s.score <= 100, `score ${s.score}`);
  assert.equal(s.activeDays, 28);
  const o = loanOffer(s);
  assert.equal(o.eligible, true);
  assert.ok(o.limit >= 100000);
  const plan = repaymentPlan(100000, 0.03, 30);
  assert.equal(plan.totalRepayable, 103000);
  assert.equal(plan.dailyRepayment, 3450);
  assert.equal(loanOffer({ score: 30, avgDailySales: 50000, activeDays: 20 }).eligible, false);
});

test('Loans need consent, go to a supplier, and can be repaid', async () => {
  const s = await start();
  const acct = (await s.call('POST', '/wema/accounts', { name: 'Ngozi', phone: '08030000000', nin: '12345678901' })).body;
  const base = { accountNumber: acct.accountNumber, score: 72, avgDailySales: 40000, activeDays: 25 };
  const offer = (await s.call('POST', '/wema/loans/offer', base)).body;
  assert.equal(offer.limit, 200000);
  const supplier = { name: 'Dangote Distributor, Alaba', accountNumber: '0123456789' };
  assert.equal((await s.call('POST', '/wema/loans', { ...base, amount: 100000, supplier, consent: false })).status, 400);
  assert.equal((await s.call('POST', '/wema/loans', { ...base, amount: 300000, supplier, consent: true })).status, 422);
  const loan = (await s.call('POST', '/wema/loans', { ...base, amount: 100000, supplier, consent: true })).body;
  assert.equal(loan.disbursedTo, 'supplier');
  assert.equal(loan.totalRepayable, 103000);
  assert.equal((await s.call('POST', '/wema/loans/offer', base)).body.eligible, false); // one at a time
  const repaid = (await s.call('POST', `/wema/loans/${loan.id}/repay`, { amount: 200000 })).body;
  assert.equal(repaid.status, 'repaid');
  assert.equal(repaid.repaid, 103000);
  await s.close();
});

test('WhatsApp: entries are recorded, confirmations grouped, questions answered, app sync applies them', async () => {
  const s = await start();
  const phone = '08030000000';
  // unlinked number gets a welcome
  assert.equal((await s.call('POST', '/whatsapp/dev/inbound', { phone, text: 'I sold 1 bag rice' })).body.status, 'unlinked');
  // phone links via sync
  await s.call('POST', '/api/sync', { phone, profile: { name: 'Ngozi', language: 'pcm' }, inventory, customers: [] });
  const r1 = await s.call('POST', '/whatsapp/dev/inbound', { phone, text: 'I sell 2 bag rice give Emeka 17k he pay 10k' });
  assert.equal(r1.body.status, 'recorded');
  await s.call('POST', '/whatsapp/dev/inbound', { phone, text: 'I don sell 1 carton peak milk' });
  let out = (await s.call('GET', `/whatsapp/dev/outbox?phone=${phone}`)).body;
  const before = out.length;
  // question gets an immediate answer from the updated snapshot (4 - 2 = 2 bags)
  const q = await s.call('POST', '/whatsapp/dev/inbound', { phone, text: 'How much rice remain?' });
  assert.equal(q.body.status, 'answered');
  out = (await s.call('GET', `/whatsapp/dev/outbox?phone=${phone}`)).body;
  const texts = out.slice(before).map(m => m.text);
  assert.ok(texts.some(t => /record 2/.test(t)), texts.join(' | '));  // pending batch flushed first
  assert.ok(texts.some(t => /Rice \(50kg\): 2 bag remain/.test(t)), texts.join(' | '));
  // debt question
  const d = await s.call('POST', '/whatsapp/dev/inbound', { phone, text: 'who dey owe me?' });
  assert.equal(d.body.status, 'answered');
  out = (await s.call('GET', `/whatsapp/dev/outbox?phone=${phone}`)).body;
  assert.match(out.at(-1).text, /Emeka: ₦7,000/);
  // app syncs: gets both entries, then acknowledges them
  const sync1 = (await s.call('POST', '/api/sync', { phone, profile: {}, inventory, customers: [] })).body;
  assert.equal(sync1.entries.length, 2);
  const last = sync1.entries.at(-1).seq;
  const sync2 = (await s.call('POST', '/api/sync', { phone, profile: {}, inventory, customers: [], ackedThrough: last })).body;
  assert.equal(sync2.entries.length, 0);
  // unknown phrase
  assert.equal((await s.call('POST', '/whatsapp/dev/inbound', { phone, text: 'good morning' })).body.status, 'not_understood');
  await s.close();
});

test('WhatsApp payment alert is sent when Wema receives money', async () => {
  const s = await start();
  const phone = '08030000000';
  const acct = (await s.call('POST', '/wema/accounts', { name: 'Ngozi', phone, nin: '12345678901' })).body;
  await s.call('POST', '/api/sync', { phone, profile: { accountNumber: acct.accountNumber }, inventory, customers: [] });
  await s.call('POST', '/wema/simulate/credit', { accountNumber: acct.accountNumber, amount: 8500, senderName: 'Emeka Chukwu' });
  await new Promise(r => setTimeout(r, 20));
  const out = (await s.call('GET', `/whatsapp/dev/outbox?phone=${phone}`)).body;
  assert.match(out.at(-1).text, /₦8,500 received from Emeka Chukwu/);
  const sync = (await s.call('POST', '/api/sync', { phone, profile: {}, inventory, customers: [] })).body;
  assert.equal(sync.credits.length, 1);
  await s.close();
});

test('sync anchors the sealed record and catches a rolled-back history', async () => {
  const s = await start();
  try {
    const base = { phone: '08099990000', profile: { name: 'T' }, inventory, customers: [] };
    let r = await s.call('POST', '/api/sync', { ...base, ledgerHead: { seq: 10, hash: 'a'.repeat(64) } });
    assert.equal(r.body.sealOk, true);
    r = await s.call('POST', '/api/sync', { ...base, ledgerHead: { seq: 12, hash: 'b'.repeat(64) } });
    assert.equal(r.body.sealOk, true);
    r = await s.call('POST', '/api/sync', { ...base, ledgerHead: { seq: 9, hash: 'c'.repeat(64) } });
    assert.equal(r.body.sealOk, false, 'shorter history must be flagged');
    r = await s.call('POST', '/api/sync', { ...base, ledgerHead: { seq: 12, hash: 'd'.repeat(64) } });
    assert.equal(r.body.sealOk, false, 'rewritten history must be flagged');
  } finally { await s.close(); }
});

test('evidence workbook submission is checked against its fingerprint', async () => {
  const s = await start();
  try {
    const file = Buffer.from('fake xlsx bytes').toString('base64');
    const sha = require('crypto').createHash('sha256').update(Buffer.from('fake xlsx bytes')).digest('hex');
    let r = await s.call('POST', '/api/submissions', { phone: '08099990000', file, sha256: sha, invoices: 3, total: 9000 });
    assert.equal(r.status, 201); assert.equal(r.body.status, 'Received by Wema');
    r = await s.call('POST', '/api/submissions', { phone: '08099990000', file, sha256: 'a'.repeat(64) });
    assert.equal(r.status, 422);
    r = await s.call('GET', '/api/submissions?phone=08099990000');
    assert.equal(r.body.length, 1); assert.equal(r.body[0].file, undefined);
  } finally { await s.close(); }
});

test('natural voice: key stays on the server, phone gets a stream link', async () => {
  const realFetch = global.fetch;
  process.env.YARNGPT_API_KEY = 'secret-key';
  let seen = null;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.yarngpt.ai')) {
      seen = { url, auth: opts.headers.authorization, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ ticket: 't1', stream_url: '/api/v1/tts/stream/t1', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
  const s = await start();
  try {
    const r = await s.call('POST', '/api/tts', { text: 'Recorded. Rice: 2 bags left.' });
    assert.equal(r.status, 200);
    assert.equal(r.body.url, 'https://api.yarngpt.ai/api/v1/tts/stream/t1');
    assert.equal(seen.auth, 'Bearer secret-key');
    assert.equal(seen.body.voice, 'idera');
    assert.ok(!JSON.stringify(r.body).includes('secret-key'));
  } finally { await s.close(); global.fetch = realFetch; delete process.env.YARNGPT_API_KEY; }
});

test('CORS allows the Vendora website on github.io and onrender.com, not other sites', async () => {
  process.env.CORS_ORIGINS = 'https://devemmy.github.io,https://*.onrender.com';
  const s = await start();
  try {
    const base = `http://127.0.0.1:${s.srv.address().port}/health`;
    const h = async o => (await fetch(base, { headers: { origin: o } })).headers.get('access-control-allow-origin');
    assert.equal(await h('https://vendora-app.onrender.com'), 'https://vendora-app.onrender.com');
    assert.equal(await h('https://devemmy.github.io'), 'https://devemmy.github.io');
    assert.equal(await h('https://evil.example.com'), null);
    assert.equal(await h('https://x.onrender.com.evil.com'), null);
  } finally { await s.close(); delete process.env.CORS_ORIGINS; }
});
