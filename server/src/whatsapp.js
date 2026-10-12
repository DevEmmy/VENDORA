// WhatsApp channel (Meta WhatsApp Business Platform / Cloud API).
// Inbound text and voice notes become Vendora entries; confirmations are GROUPED to keep
// per-message costs low (Meta charges per business reply since Oct 1, 2026).
'use strict';
const express = require('express');
const { parse } = require('./parser');
const { applyOp, answer, phrases } = require('./snapshot');

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '234' + d.slice(1);
  return d;
}

function createWhatsApp(store, opts = {}) {
  const cfg = {
    verifyToken: opts.verifyToken || process.env.WA_VERIFY_TOKEN || 'vendora-dev',
    token: opts.token ?? process.env.WA_TOKEN,
    phoneNumberId: opts.phoneNumberId ?? process.env.WA_PHONE_NUMBER_ID,
    batchSize: Number(opts.batchSize || process.env.WA_BATCH_SIZE || 5),
    batchWindowMs: Number(opts.batchWindowMs || process.env.WA_BATCH_WINDOW_MS || 15 * 60 * 1000),
    sttUrl: opts.sttUrl ?? process.env.STT_URL,       // OpenAI-compatible /audio/transcriptions endpoint
    sttKey: opts.sttKey ?? process.env.STT_API_KEY,
    fetch: opts.fetch || globalThis.fetch,
  };
  const db = () => store.data;
  const pending = new Map(); // phone -> {count, total, firstAt}

  async function send(phone, text) {
    const msg = { to: phone, text, at: Date.now(), sent: false };
    db().outbox.push(msg);
    if (db().outbox.length > 500) db().outbox.splice(0, db().outbox.length - 500);
    store.save();
    if (!cfg.token || !cfg.phoneNumberId) return msg; // dev mode: kept in outbox only
    const r = await cfg.fetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }),
    });
    msg.sent = r.ok;
    if (!r.ok) msg.error = await r.text().catch(() => String(r.status));
    return msg;
  }

  function T(trader) { return phrases[(trader && trader.language) || 'en'] || phrases.en; }

  async function queueConfirmation(trader, amount) {
    const p = pending.get(trader.phone) || { count: 0, total: 0, firstAt: Date.now() };
    p.count += 1; p.total += amount || 0;
    pending.set(trader.phone, p);
    if (p.count >= cfg.batchSize) await flush(trader.phone);
  }

  async function flush(phone) {
    const p = pending.get(phone);
    if (!p || !p.count) return null;
    pending.delete(phone);
    return send(phone, T(db().traders[phone]).recorded(p.count, p.total));
  }

  async function flushDue(now = Date.now()) {
    for (const [phone, p] of pending) if (now - p.firstAt >= cfg.batchWindowMs) await flush(phone);
  }

  async function transcribe(mediaId) {
    if (!cfg.sttUrl || !cfg.token) return null;
    const meta = await (await cfg.fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: { Authorization: `Bearer ${cfg.token}` } })).json();
    const audio = await (await cfg.fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.token}` } })).arrayBuffer();
    const form = new FormData();
    form.append('file', new Blob([audio], { type: meta.mime_type || 'audio/ogg' }), 'note.ogg');
    form.append('model', process.env.STT_MODEL || 'whisper-1');
    const r = await cfg.fetch(cfg.sttUrl, { method: 'POST', headers: cfg.sttKey ? { Authorization: `Bearer ${cfg.sttKey}` } : {}, body: form });
    if (!r.ok) return null;
    const j = await r.json();
    return j.text || null;
  }

  // Core: handle one inbound message (text already extracted). Returns what happened.
  async function handleText(phone, text, source = 'whatsapp') {
    const trader = db().traders[phone];
    if (!trader) {
      await send(phone, 'Welcome to Vendora 👋 Download the Vendora app and link this WhatsApp number to start recording sales by voice.');
      return { status: 'unlinked' };
    }
    const op = parse(text, { inventory: trader.inventory || [], customers: trader.customers || [] });
    if (op.type.startsWith('query_')) {
      await flush(phone);
      await send(phone, answer(trader, op));
      return { status: 'answered', op };
    }
    if (op.type === 'unknown') { await send(phone, T(trader).notUnderstood); return { status: 'not_understood', op }; }
    if (op.unknown && op.unknown.length && !(op.items && op.items.length)) {
      await send(phone, T(trader).unknownItem(op.unknown[0].name));
      return { status: 'unknown_item', op };
    }
    applyOp(trader, op);
    const entry = { seq: db().seq++, phone, source, text, op, at: Date.now() };
    db().inbox.push(entry);
    store.save();
    await queueConfirmation(trader, op.type === 'sale' ? op.total : 0);
    return { status: 'recorded', entry };
  }

  async function handleWebhook(body) {
    const results = [];
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      for (const m of (ch.value && ch.value.messages) || []) {
        const phone = normPhone(m.from);
        if (m.type === 'text') results.push(await handleText(phone, m.text.body));
        else if (m.type === 'audio') {
          const text = await transcribe(m.audio.id).catch(() => null);
          if (text) results.push(await handleText(phone, text, 'whatsapp_voice'));
          else {
            const trader = db().traders[phone];
            if (trader) {
              db().inbox.push({ seq: db().seq++, phone, source: 'whatsapp_voice', text: null, op: { type: 'voice_pending', mediaId: m.audio.id }, at: Date.now() });
              store.save();
              await send(phone, T(trader).voicePending);
            }
            results.push({ status: 'voice_pending' });
          }
        }
      }
    }
    return results;
  }

  const router = express.Router();
  router.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === cfg.verifyToken) return res.send(req.query['hub.challenge']);
    res.sendStatus(403);
  });
  router.post('/webhook', async (req, res) => {
    res.sendStatus(200); // acknowledge fast, as Meta requires
    try { await handleWebhook(req.body); } catch (e) { console.error('whatsapp webhook error', e); }
  });
  // Dev/demo: simulate an inbound WhatsApp message without Meta.
  router.post('/dev/inbound', async (req, res) => {
    try { res.json(await handleText(normPhone(req.body.phone), String(req.body.text || ''))); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/dev/outbox', (req, res) => res.json(db().outbox.filter(m => !req.query.phone || m.to === normPhone(req.query.phone)).slice(-50)));
  router.post('/dev/flush', async (req, res) => { await flushDue(Infinity); res.json({ ok: true }); });

  return { router, send, handleText, handleWebhook, flush, flushDue, normPhone };
}

module.exports = { createWhatsApp, normPhone };
