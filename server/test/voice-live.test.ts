import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { LiveSession, LiveSessions, YarnLive, confirmation, type SpeechEvent, type StreamingSpeechProvider } from '../src/voice/live';
import { VoiceService } from '../src/voice/service';
import type { VoiceLog } from '../src/generated/prisma/client';
import { config } from './helpers';
import { latencySummary, observe } from '../src/voice/metrics';

const tick = () => new Promise<void>(done => setImmediate(done));
function fixture() {
  let event!: (message: SpeechEvent) => void;
  const provider: StreamingSpeechProvider = { connect(callback) { event = callback; return { send() {}, close() {}, finalize() { event({ type: 'done' }); } }; } };
  const actor = { userId: randomUUID(), businessId: randomUUID() };
  const service = new VoiceService({} as never, config);
  let creates = 0, confirms = 0, cancels = 0;
  const log: VoiceLog = { id: randomUUID(), businessId: actor.businessId, createdById: actor.userId, transcript: 'sale',
    parsed: {}, confidence: 1, status: 'pending', asrJobId: null, audioSeconds: null, latencyMs: null,
    errorCode: null, candidates: [], readbackText: 'Confirm?', movementId: null, result: null, createdAt: new Date(), updatedAt: new Date() };
  service.create = async () => { creates++; return log; };
  service.owned = async () => log;
  service.confirm = async () => { confirms++; log.status = 'confirmed'; return { status: 'confirmed' }; };
  service.reject = async () => { cancels++; log.status = 'rejected'; return log; };
  const session = new LiveSession(actor, provider, service, () => {});
  return { session, actor, provider, service, event: (value: SpeechEvent) => event(value), log, counts: () => ({ creates, confirms, cancels }) };
}
test('only final segments run commands; duplicate finals and repeated yes execute once', async () => {
  const f = fixture();
  try {
    f.event({ type: 'partial', segment: 0, text: 'I sold' }); await tick(); assert.equal(f.counts().creates, 0);
    f.event({ type: 'final', segment: 0, text: 'I don sell five packs of Coastal biscuit' });
    f.event({ type: 'final', segment: 0, text: 'duplicate' }); await tick();
    assert.equal(f.counts().creates, 1);
    f.event({ type: 'final', segment: 1, text: 'yes' });
    f.event({ type: 'final', segment: 2, text: 'confirm' }); await tick();
    assert.equal(f.counts().confirms, 1); assert.equal(f.session.pending, null);
  } finally { f.session.close(); }
});
test('premature yes, a new command during review, and clarification never imply confirmation', async () => {
  const f = fixture();
  try {
    f.event({ type: 'final', segment: 0, text: 'sale' });
    f.event({ type: 'final', segment: 1, text: 'yes' }); await tick();
    assert.equal(f.counts().confirms, 0);
    f.event({ type: 'final', segment: 2, text: 'add ten cartons of milk' }); await tick();
    assert.equal(f.counts().creates, 1);
    f.log.status = 'needs_clarification'; f.event({ type: 'final', segment: 3, text: 'yes' }); await tick();
    assert.equal(f.counts().confirms, 0);
    f.event({ type: 'final', segment: 4, text: 'cancel' }); await tick();
    assert.equal(f.counts().cancels, 1);
  } finally { f.session.close(); }
});
test('audio chunks require readiness, correct order and even PCM; retries deduplicate', () => {
  const f = fixture();
  try {
    assert.throws(() => f.session.audio(0, Buffer.alloc(8000)), /not ready/);
    f.event({ type: 'started' });
    assert.throws(() => f.session.audio(0, Buffer.alloc(1)), /PCM16/);
    assert.throws(() => f.session.audio(1, Buffer.alloc(8000)), /out of order/);
    f.session.audio(0, Buffer.alloc(8000)); f.session.audio(0, Buffer.alloc(8000));
    f.session.audio(1, Buffer.alloc(8000));
    f.session.finish(); assert.throws(() => f.session.audio(2, Buffer.alloc(8000)), /not ready/);
  } finally { f.session.close(); }
});
test('stream handles are scoped to both business and user and removed on cleanup', () => {
  const f = fixture(), manager = new LiveSessions(f.service, f.provider);
  const session = manager.create(f.actor);
  try {
    assert.equal(manager.owned(f.actor, session.id), session);
    assert.throws(() => manager.owned({ ...f.actor, userId: randomUUID() }, session.id), /not found/);
    assert.throws(() => manager.owned({ ...f.actor, businessId: randomUUID() }, session.id), /not found/);
  } finally { session.close(); f.session.close(); }
  assert.throws(() => manager.owned(f.actor, session.id), /not found/);
});
test('spoken responses are explicit, and telemetry is bounded and reports median/p95', () => {
  assert.equal(confirmation('Yes!'), 'confirm'); assert.equal(confirmation('No.'), 'cancel');
  assert.equal(confirmation('yes sell another five'), null);
  for (let i = 0; i < 600; i++) observe('test', i);
  const summary = latencySummary().test!;
  assert.equal(summary.count, 512); assert.equal(summary.median_ms, 343); assert.equal(summary.p95_ms, 574);
});
test('YarnGPT adapter authenticates only upstream and follows documented start, PCM and finalize messages', { timeout: 10000 }, async () => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const address = upstream.address(); assert(address && typeof address !== 'string');
  let chunks = 0;
  upstream.on('connection', (peer, request) => {
    assert.equal(request.url, '/api/v1/asr/stream');
    assert.equal(request.headers.authorization, 'Bearer server-secret');
    peer.on('message', (raw, binary) => {
      if (binary) { assert(Buffer.isBuffer(raw)); assert.equal(raw.length, 8000); chunks++; return; }
      const message = JSON.parse(raw.toString()) as { type: string; audio: unknown };
      if (message.type === 'start') {
        assert.deepEqual(message.audio, { encoding: 'pcm_s16le', sample_rate: 16000, channels: 1 });
        peer.send(JSON.stringify({ type: 'started' }));
      } else {
        assert.equal(message.type, 'finalize');
        peer.send(JSON.stringify({ type: 'final', segment: 0, text: 'I sold rice', start_seconds: 0, end_seconds: .25 }));
        peer.send(JSON.stringify({ type: 'done', reason: 'finalized' })); peer.close();
      }
    });
  });
  const provider = new YarnLive({ ...config, YARNGPT_API_KEY: 'server-secret', YARNGPT_BASE_URL: `http://127.0.0.1:${address.port}` });
  const events: SpeechEvent[] = [];
  let stream!: ReturnType<YarnLive['connect']>;
  try {
    await new Promise<void>((resolve, reject) => {
      stream = provider.connect(event => {
        events.push(event);
        if (event.type === 'started') { stream.send(Buffer.alloc(8000)); stream.finalize(); }
        if (event.type === 'done') resolve();
        if (event.type === 'error') reject(new Error('Unexpected upstream error'));
      });
    });
    assert.equal(chunks, 1); assert.deepEqual(events.map(e => e.type), ['started', 'final', 'done']);
  } finally { stream?.close(); for (const peer of upstream.clients) peer.terminate(); await new Promise<void>(done => upstream.close(() => done())); }
});
