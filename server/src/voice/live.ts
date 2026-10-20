import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { VoiceConfig } from '../config/voice';
import type { InventoryActor } from '../types/inventory';
import { HttpError } from '../middleware/error-handler';
import { VoiceService, voiceJson } from './service';
import { observe } from './metrics';

export interface SpeechEvent { type: string; segment?: number | undefined; text?: string; [key: string]: unknown }
export interface SpeechStream { send(audio: Buffer): void; finalize(): void; close(): void }
export interface StreamingSpeechProvider { connect(event: (message: SpeechEvent) => void): SpeechStream }

// Protocol verified against https://yarngpt.ai/api-docs#live-asr (18 Oct 2026).
// A finalized segment, not a partial caption, is an utterance boundary.
export class YarnLive implements StreamingSpeechProvider {
  constructor(private config: VoiceConfig) {}
  connect(event: (message: SpeechEvent) => void): SpeechStream {
    const url = new URL('/api/v1/asr/stream', this.config.YARNGPT_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.config.YARNGPT_API_KEY}` }, maxPayload: 65536, handshakeTimeout: 10000 });
    let finished = false;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start', audio: { encoding: 'pcm_s16le', sample_rate: 16000, channels: 1 }, options: { endpoint_silence_ms: 800, partials: true } })));
    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString()) as SpeechEvent;
        if (!message || typeof message.type !== 'string') throw new Error();
        if (message.type === 'error') { finished = true; event({ type: 'error', code: 'ASR_REJECTED' }); }
        else { if (message.type === 'done') finished = true; event(message); }
      } catch { event({ type: 'error', code: 'ASR_PROTOCOL' }); ws.close(); }
    });
    ws.on('error', () => { finished = true; event({ type: 'error', code: 'ASR_CONNECTION' }); });
    ws.on('close', () => { if (!finished) event({ type: 'error', code: 'ASR_DISCONNECTED' }); });
    return {
      send(audio) {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 160000) throw new HttpError(503, 'Speech connection is behind. Reconnect and repeat the current utterance.');
        ws.send(audio);
      },
      finalize() { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'finalize' })); },
      close() { finished = true; ws.terminate(); },
    };
  }
}
export class MockLive implements StreamingSpeechProvider {
  connect(event: (message: SpeechEvent) => void): SpeechStream {
    queueMicrotask(() => event({ type: 'started', limits: {} }));
    return { send() {}, close() {}, finalize() {
      event({ type: 'partial', segment: 0, text: 'I sold two' });
      event({ type: 'final', segment: 0, text: 'I sold two bags of rice' });
      event({ type: 'done', reason: 'finalized' });
    } };
  }
}
export function confirmation(text: string) {
  const value = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  if (['yes', 'confirm', 'yes confirm', 'yes please'].includes(value)) return 'confirm';
  if (['no', 'cancel', 'no cancel', 'cancel pending action'].includes(value)) return 'cancel';
  return null;
}

export class LiveSession {
  readonly id = randomUUID();
  readonly events: SpeechEvent[] = [];
  private listeners = new Set<(event: SpeechEvent) => void>();
  private stream: SpeechStream;
  private seen = new Set<number>();
  private queue: Promise<void> = Promise.resolve();
  private ready = false;
  private ended = false;
  private chunks = new Set<number>();
  private bytes = 0;
  private opened = Date.now();
  private captureOrigin: number | null = null;
  pending: string | null = null;
  readonly timer: ReturnType<typeof setTimeout>;
  constructor(readonly actor: InventoryActor, provider: StreamingSpeechProvider, private service: VoiceService, private dispose: () => void) {
    this.stream = provider.connect(message => this.receive(message));
    this.timer = setTimeout(() => { this.emit({ type: 'error', code: 'SESSION_EXPIRED' }); this.close(); }, 300000);
    this.timer.unref();
  }
  emit(message: SpeechEvent) {
    this.events.push(message);
    if (this.events.length > 128) this.events.shift();
    for (const listener of this.listeners) listener(message);
  }
  subscribe(listener: (event: SpeechEvent) => void) {
    if (this.listeners.size) throw new HttpError(409, 'This speech session already has a listener');
    for (const message of this.events) listener(message);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  audio(sequence: number, audio: Buffer) {
    if (this.chunks.has(sequence)) return;
    if (!this.ready || this.ended) throw new HttpError(409, 'Speech connection is not ready');
    if (sequence !== this.chunks.size) throw new HttpError(409, 'Audio arrived out of order. Reconnect and repeat.');
    if (!audio.length || audio.length % 2 || audio.length > 32000) throw new HttpError(400, 'Use mono 16kHz PCM16 audio chunks');
    if (this.bytes + audio.length > 32000 * ((Date.now() - this.opened) / 1000 * 2 + 5)) throw new HttpError(429, 'Audio must be sent at capture speed');
    this.stream.send(audio); this.chunks.add(sequence); this.bytes += audio.length;
    this.captureOrigin ??= Date.now() - audio.length / 32;
  }
  finish() { if (!this.ended) { this.ended = true; this.stream.finalize(); } }
  close() { clearTimeout(this.timer); this.stream.close(); this.listeners.clear(); this.dispose(); }
  private receive(message: SpeechEvent) {
    if (message.type === 'started') { this.ready = true; this.emit({ type: 'started' }); return; }
    if (message.type === 'partial') {
      if (typeof message.text === 'string' && message.text.length <= 8000) this.emit({ type: 'partial', text: message.text, segment: message.segment });
      return;
    }
    if (message.type === 'final') {
      if (!Number.isSafeInteger(message.segment) || message.segment! < 0 || typeof message.text !== 'string' || message.text.length > 8000 || this.seen.has(message.segment!)) return;
      this.seen.add(message.segment!);
      if (!message.text.trim()) return;
      if (this.captureOrigin !== null && typeof message.end_seconds === 'number') {
        observe('final_detection', Date.now() - this.captureOrigin - message.end_seconds * 1000);
      }
      this.emit({ type: 'final', segment: message.segment, text: message.text });
      const pendingAtSpeech = this.pending;
      this.queue = this.queue.then(async () => {
        this.emit({ type: 'state', state: 'PROCESSING' });
        const answer = confirmation(message.text!);
        if (answer) {
          if (!pendingAtSpeech || this.pending !== pendingAtSpeech) { this.emit({ type: 'feedback', text: 'There is no active action to confirm. Wait for the review card.' }); return; }
          const log = await this.service.owned(this.actor, pendingAtSpeech);
          if (!['pending', 'needs_clarification'].includes(log.status)) { this.pending = null; this.emit({ type: 'feedback', text: 'That action has already been handled.' }); return; }
          if (answer === 'cancel') { await this.service.reject(this.actor, pendingAtSpeech); this.pending = null; this.emit({ type: 'cancelled' }); }
          else {
            // Clarification and edited cards must be reviewed with their buttons.
            if (log.status !== 'pending') { this.emit({ type: 'feedback', text: 'Choose and review the product on the card first.' }); return; }
            this.emit({ type: 'state', state: 'EXECUTING' });
            const result = await this.service.confirm(this.actor, pendingAtSpeech, { allow_negative: false });
            this.pending = null; this.emit({ type: 'receipt', result });
          }
          return;
        }
        if (this.pending) {
          const log = await this.service.owned(this.actor, this.pending);
          if (['pending', 'needs_clarification'].includes(log.status) && Date.now() - log.createdAt.getTime() <= this.service.config.VOICE_PENDING_TTL_MS) {
            this.emit({ type: 'feedback', text: 'Confirm or cancel the current action before starting another command.' }); return;
          }
          this.pending = null;
        }
        const log = await this.service.create(this.actor, { transcript: message.text! });
        if (['pending', 'needs_clarification'].includes(log.status)) this.pending = log.id;
        this.emit({ type: 'command', command: voiceJson(log, this.service.config.VOICE_PENDING_TTL_MS) });
      }).catch(() => this.emit({ type: 'error', code: 'COMMAND_FAILED', text: 'The command could not be completed. Check the card or history before retrying.' }));
      return;
    }
    if (message.type === 'done') {
      this.ended = true;
      // Keep the downstream response open until its final database work finishes.
      void this.queue.then(() => this.emit({ type: 'done', reason: message.reason }));
    } else if (message.type === 'error') { this.ended = true; this.emit({ type: 'error', code: message.code ?? 'ASR_FAILED' }); }
  }
}

export class LiveSessions {
  private sessions = new Map<string, LiveSession>();
  constructor(private service: VoiceService, private provider: StreamingSpeechProvider) {}
  create(actor: InventoryActor) {
    if (this.sessions.size >= 64 || [...this.sessions.values()].filter(s => s.actor.userId === actor.userId).length >= 2) throw new HttpError(429, 'Too many speech sessions. Stop the other microphone first.');
    const session = new LiveSession(actor, this.provider, this.service, () => this.sessions.delete(session.id));
    this.sessions.set(session.id, session); return session;
  }
  owned(actor: InventoryActor, id: string) {
    const session = this.sessions.get(id);
    if (!session || session.actor.userId !== actor.userId || session.actor.businessId !== actor.businessId) throw new HttpError(404, 'Speech session not found. Reconnect and repeat the current utterance.');
    return session;
  }
  authorized(userId: string, id: string, businessId?: string) {
    const session = this.sessions.get(id);
    if (!session || session.actor.userId !== userId || (businessId && session.actor.businessId !== businessId)) {
      throw new HttpError(404, 'Speech session not found. Reconnect and repeat the current utterance.');
    }
    return session;
  }
}
