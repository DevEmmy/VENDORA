import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startTestServer } from '../support/http';
import { apiActor } from '../support/api';
import { VoiceService } from '../../src/voice/service';
import { MockSpeech, VoiceError } from '../../src/voice/providers';
import { MockLlm, VoiceParser } from '../../src/voice/parser';
import { seedVoiceProducts } from '../../scripts/voice-seed';
import { LiveSession, type SpeechEvent } from '../../src/voice/live';

interface Command { voice_log_id: string; status: string; transcript: string; candidates: { product_id: string }[][] }
interface Confirmed { status: string; products: { id: string; currentQty: string }[]; movements: { id: string }[]; low_stock: { product_id: string }[] }

test('Phase 2 voice commands use authenticated atomic ledger writes', { timeout: 240000 }, async t => {
  const h = await startTestServer();
  try {
    const owner = await apiActor(h, 'Voice owner');
    const other = await apiActor(h, 'Other voice owner');
    const add = async (actor: typeof owner, name: string, unit = 'bag', openingQty = '6', aliases = [name.toLowerCase()]) => {
      const response = await actor.request<{ product: { id: string } }>('/api/products', 'POST', {
        clientId: randomUUID(), name, unit, aliases, openingQty, lowStockAt: '5', unitPrice: '100000',
      }); assert.equal(response.status, 201); return response.data.product.id;
    };
    const rice = await add(owner, 'Rice');
    const brown = await add(owner, 'Brown beans', 'bag', '20', ['beans']);
    await add(owner, 'White beans', 'bag', '20', ['beans']);
    const foreign = await add(other, 'Foreign rice');
    const command = async (text: string) => {
      const response = await owner.request<Command>('/api/voice/commands', 'POST', { transcript: text });
      assert.equal(response.status, 201); return response.data;
    };
    await t.test('processing is read-only, readback is cached, concurrent confirms apply once and notify', async () => {
      const c = await command('I sold 2 bags of rice'); assert.equal(c.status, 'pending');
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: rice } })).stockQty.toString(), '6');
      const readback = await fetch(`${h.url}/api/voice/commands/${c.voice_log_id}/readback`, { headers: { cookie: owner.cookie, 'X-Business-ID': owner.businessId } });
      assert.equal(readback.status, 200); assert.equal(readback.headers.get('content-type'), 'audio/mpeg'); assert((await readback.arrayBuffer()).byteLength > 128);
      const results = await Promise.all([1, 2].map(() => owner.request<Confirmed>(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {})));
      assert(results.every(r => r.status === 200)); assert.deepEqual(results[0]!.data, results[1]!.data);
      assert.equal(results[0]!.data.products[0]!.currentQty, '4.000'); assert.equal(results[0]!.data.low_stock[0]!.product_id, rice);
      assert.equal(await h.db.stockMovement.count({ where: { referenceId: c.voice_log_id } }), 1);
      const sum = await h.db.stockMovement.aggregate({ where: { productId: rice }, _sum: { quantity: true } });
      assert.equal(sum._sum.quantity!.toString(), '4');
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/reject`, 'POST', {})).status, 409);
    });
    await t.test('reject, silence, gibberish and invalid overrides cannot change stock', async () => {
      const c = await command('add 2 bags rice');
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/reject`, 'POST', {})).status, 200);
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {})).status, 409);
      assert.equal((await command('')).status, 'failed'); assert.equal((await command('purple spaceship banana')).status, 'failed');
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: rice } })).stockQty.toString(), '4');
      assert.equal((await owner.request(`/api/voice/commands/${randomUUID()}/confirm`, 'POST', { quantity: 1.5 })).status, 400);
    });
    await t.test('beans clarify with chips and cross-business ids are rejected', async () => {
      const c = await command('I sold 2 bags of beans'); assert.equal(c.status, 'needs_clarification'); assert.equal(c.candidates[0]!.length, 2);
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {})).status, 400);
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', { product_id: foreign })).status, 404);
      assert.equal((await other.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {})).status, 404);
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', { product_id: brown })).status, 200);
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: brown } })).stockQty.toString(), '18');
    });
    await t.test('negative-stock guard requires explicit allow_negative and remains retryable', async () => {
      const c = await command('I sold 10 bags rice');
      const denied = await owner.request<{ code: string }>(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {});
      assert.equal(denied.status, 409); assert.equal(denied.data.code, 'INSUFFICIENT_STOCK');
      assert.equal((await h.db.voiceLog.findUniqueOrThrow({ where: { id: c.voice_log_id } })).status, 'pending');
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', { allow_negative: true })).status, 200);
    });
    await t.test('multi-item command rolls back every item on failure, then posts all once', async () => {
      const c = await command('I sold 1 bag beans and 2 bags rice');
      const overrides = { action: 'sale', items: [{ product_id: brown, quantity: 1 }, { product_id: rice, quantity: 2 }] };
      const before = (await h.db.product.findUniqueOrThrow({ where: { id: brown } })).stockQty.toString();
      assert.equal((await owner.request(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', overrides)).status, 409);
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: brown } })).stockQty.toString(), before);
      assert.equal(await h.db.stockMovement.count({ where: { referenceId: c.voice_log_id } }), 0);
      const success = await owner.request<Confirmed>(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', { ...overrides, allow_negative: true });
      assert.equal(success.status, 200); assert.equal(success.data.movements.length, 2);
      assert.equal((await owner.request<Confirmed>(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {})).data.movements.length, 2);
    });
    await t.test('manual fallback is review-first and history paginates within business', async () => {
      const manual = await owner.request<Command>('/api/voice/manual', 'POST', { action: 'restock', items: [{ product_id: rice, quantity: 20 }] });
      assert.equal(manual.status, 201); assert.equal(manual.data.status, 'pending');
      assert.equal((await owner.request(`/api/voice/commands/${manual.data.voice_log_id}/confirm`, 'POST', {})).status, 200);
      const history = await owner.request<{ commands: Command[]; next_cursor: string }>('/api/voice/commands?limit=2');
      assert.equal(history.status, 200); assert.equal(history.data.commands.length, 2); assert(history.data.next_cursor);
      const next = await owner.request<{ commands: Command[] }>(`/api/voice/commands?limit=2&cursor=${history.data.next_cursor}`);
      assert(next.data.commands.every(c => !history.data.commands.some(p => p.voice_log_id === c.voice_log_id)));
      assert.equal((await other.request<{ commands: Command[] }>('/api/voice/commands')).data.commands.length, 0);
    });
    await t.test('multipart preserves CSRF checks and mock header only controls transcription', async () => {
      const wav = Buffer.alloc(44 + 16000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
      const form = new FormData(); form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
      const response = await fetch(h.url + '/api/voice/commands', { method: 'POST', headers: { cookie: owner.cookie, origin: h.url, 'X-Business-ID': owner.businessId, 'X-Mock-Transcript': 'add 2 bags rice' }, body: form });
      assert.equal(response.status, 201); assert.equal((await response.json() as Command).status, 'pending');
      const denied = await fetch(h.url + '/api/voice/commands', { method: 'POST', headers: { cookie: owner.cookie, origin: 'https://evil.test', 'X-Business-ID': owner.businessId }, body: form });
      assert.equal(denied.status, 403);
    });
    await t.test('provider failures preserve history and manual path; TTS failure never blocks confirmation', async () => {
      const actor = { businessId: owner.businessId, userId: owner.userId };
      const before = await h.db.stockMovement.count({ where: { businessId: owner.businessId } });
      for (const code of ['QUOTA_EXCEEDED', 'RATE_LIMITED', 'TIMEOUT']) {
        const service = new VoiceService(h.db, h.config, { speech: { transcribe: async () => { throw new VoiceError(code, 'trace-test'); } }, tts: new MockSpeech(), parser: new VoiceParser(new MockLlm()) });
        const log = await service.create(actor, { audio: Buffer.alloc(10), mimeType: 'audio/webm' });
        assert.equal(log.status, 'failed'); assert.equal(log.errorCode, code);
      }
      const service = new VoiceService(h.db, h.config, { speech: new MockSpeech(), tts: { synthesize: async () => { throw new VoiceError('TTS_FAILED'); } }, parser: new VoiceParser({ complete: async () => { throw new VoiceError('LLM_TIMEOUT'); } }) });
      assert.equal((await service.create(actor, { transcript: 'rice' })).status, 'failed');
      assert.equal(await h.db.stockMovement.count({ where: { businessId: owner.businessId } }), before);
      const pending = await service.manual(actor, { action: 'restock', items: [{ product_id: rice, quantity: 1 }] });
      assert.equal(await service.readback(actor, pending.id), null);
      assert.equal((await owner.request(`/api/voice/commands/${pending.id}/confirm`, 'POST', {})).status, 200);
    });
    await t.test('multiple lines for one product return its final total and absolute counts cannot post', async () => {
      const before = Number((await h.db.product.findUniqueOrThrow({ where: { id: rice } })).stockQty.toString());
      const c = await command('add 2 bags rice and 3 bags rice');
      const result = await owner.request<Confirmed>(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', {});
      assert.equal(result.status, 200); assert.equal(result.data.products.length, 1);
      assert.equal(Number(result.data.products[0]!.currentQty), before + 5);
      const absolute = await command('correct rice to 8 bags'); assert.equal(absolute.status, 'failed');
      assert.equal((await owner.request(`/api/voice/commands/${absolute.voice_log_id}/confirm`, 'POST', {})).status, 409);
    });
    await t.test('concurrent readbacks share generation and seeds are idempotent', async () => {
      let generated = 0;
      const actor = { businessId: owner.businessId, userId: owner.userId };
      const service = new VoiceService(h.db, h.config, { speech: new MockSpeech(), parser: new VoiceParser(new MockLlm()),
        tts: { synthesize: async () => { generated++; await new Promise<void>(done => setTimeout(done, 10)); return { audio: Buffer.alloc(512), contentType: 'audio/mpeg' }; } } });
      const log = await service.manual(actor, { action: 'restock', items: [{ product_id: rice, quantity: 1 }] });
      await Promise.all([service.readback(actor, log.id), service.readback(actor, log.id)]);
      await service.readback(actor, log.id); assert.equal(generated, 1);
      await seedVoiceProducts(h.db, { businessId: other.businessId, userId: other.userId });
      const count = await h.db.stockMovement.count({ where: { businessId: other.businessId } });
      await seedVoiceProducts(h.db, { businessId: other.businessId, userId: other.userId });
      assert.equal(await h.db.stockMovement.count({ where: { businessId: other.businessId } }), count);
    });
    await t.test('Coastal/Coaster, explicit aliases, expiry, and read-only stock questions', async () => {
      const coaster = await add(owner, 'Coaster Biscuit', 'pack', '30', []);
      const c = await command('I don sell five packs of Coastal biscuit');
      assert.equal(c.status, 'pending');
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: coaster } })).stockQty.toString(), '30');
      const result = await owner.request<Confirmed>(`/api/voice/commands/${c.voice_log_id}/confirm`, 'POST', { learn_alias: true });
      assert.equal(result.status, 200); assert.equal(Number(result.data.products[0]!.currentQty), 25);
      assert.deepEqual((await h.db.product.findUniqueOrThrow({ where: { id: coaster } })).aliases, ['coastal biscuit']);
      const query = await command('How many packs of Coaster biscuit remain?'); assert.equal(query.status, 'completed');
      const ambiguousQuery = await command('How many bags of beans remain?'); assert.equal(ambiguousQuery.status, 'completed');
      assert.equal((await owner.request(`/api/voice/commands/${ambiguousQuery.voice_log_id}/confirm`, 'POST', { action: 'sale', product_id: brown, quantity: 1 })).status, 409);
      assert.equal((await owner.request(`/api/voice/commands/${query.voice_log_id}/confirm`, 'POST', { action: 'sale' })).status, 409);
      const expired = await command('I sold 1 pack of Coaster biscuit');
      await h.db.voiceLog.update({ where: { id: expired.voice_log_id }, data: { createdAt: new Date(Date.now() - 3600000) } });
      const response = await owner.request<{ code: string }>(`/api/voice/commands/${expired.voice_log_id}/confirm`, 'POST', {});
      assert.equal(response.status, 409); assert.equal(response.data.code, 'VOICE_EXPIRED');
      assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: coaster } })).stockQty.toString(), '25');
      const aliased = await add(owner, 'Premium wafers', 'pack', '10', ['  GOLD SNACK  ']);
      const alias = await command('I sold two packs of gold snack'); assert.equal(alias.status, 'pending');
      assert.equal(alias.candidates[0]![0]!.product_id, aliased);
    });
    await t.test('stream final to review to spoken yes commits once in PostgreSQL; cancellation writes nothing', async () => {
      const product = await add(owner, 'Live rice', 'bag', '10', ['live rice']);
      let emit!: (event: SpeechEvent) => void;
      const service = new VoiceService(h.db, h.config);
      const session = new LiveSession({ userId: owner.userId, businessId: owner.businessId },
        { connect(callback) { emit = callback; return { send() {}, close() {}, finalize() {} }; } }, service, () => {});
      const events: SpeechEvent[] = [];
      session.subscribe(event => events.push(event));
      const waitFor = async (type: string, count = 1) => {
        const until = Date.now() + 10000;
        while (events.filter(e => e.type === type).length < count && Date.now() < until) await new Promise<void>(done => setTimeout(done, 10));
        assert.equal(events.filter(e => e.type === type).length, count, JSON.stringify(events));
      };
      try {
        emit({ type: 'final', segment: 0, text: 'I sold two bags of live rice' });
        emit({ type: 'final', segment: 0, text: 'duplicate' }); await waitFor('command');
        assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: product } })).stockQty.toString(), '10');
        emit({ type: 'final', segment: 1, text: 'yes' }); emit({ type: 'final', segment: 2, text: 'confirm' });
        await waitFor('receipt');
        assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: product } })).stockQty.toString(), '8');
        assert.equal(await h.db.stockMovement.count({ where: { productId: product, source: 'voice' } }), 1);
        emit({ type: 'final', segment: 3, text: 'add five bags of live rice' }); await waitFor('command', 2);
        emit({ type: 'final', segment: 4, text: 'cancel' }); await waitFor('cancelled');
        assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: product } })).stockQty.toString(), '8');
      } finally { session.close(); }
    });
    await t.test('authenticated SSE relay serves partial/final events and bounds PCM input', async () => {
      const created = await owner.request<{ stream_id: string }>('/api/voice/streams', 'POST', {}); assert.equal(created.status, 201);
      const id = created.data.stream_id;
      assert.equal((await other.request(`/api/voice/streams/${id}/audio`, 'POST', { sequence: 0, pcm: Buffer.alloc(8000).toString('base64') })).status, 404);
      const ctl = new AbortController();
      const response = await fetch(`${h.url}/api/voice/streams/${id}/events`, { headers: { cookie: owner.cookie, 'X-Business-ID': owner.businessId }, signal: ctl.signal });
      assert.equal(response.status, 200);
      const reader = response.body!.getReader(); let text = '';
      const decoder = new TextDecoder();
      try {
        text += decoder.decode((await reader.read()).value);
        assert.match(text, /started/);
        assert.equal((await owner.request(`/api/voice/streams/${id}/audio`, 'POST', { sequence: 0, pcm: Buffer.alloc(8000).toString('base64') })).status, 200);
        assert.equal((await owner.request(`/api/voice/streams/${id}/finalize`, 'POST', {})).status, 200);
        while (!text.includes('"type":"done"')) text += decoder.decode((await reader.read()).value);
        assert.match(text, /"type":"partial"/); assert.match(text, /"type":"final"/); assert.match(text, /"type":"command"/);
      } finally { ctl.abort(); await reader.cancel().catch(() => {}); }
    });
  } finally { await h.stop(); }
});
