import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type VoiceLog } from '../generated/prisma/client';
import { z } from 'zod';
import type { Config } from '../config/env';
import { voicePolicy } from '../config/voice';
import { HttpError } from '../middleware/error-handler';
import type { InventoryActor } from '../types/inventory';
import { applyStockMovement, type MovementResult } from '../services/inventory.service';
import { inventoryJson, requireRelational } from '../services/inventory-transaction';
import { productJson } from '../services/inventory-serialization';
import { HttpLlm, manualMessage, MockSpeech, VoiceError, voiceLog, YarnGpt, type SpeechToTextProvider, type TextToSpeechProvider } from './providers';
import { MockLlm, normalize, parsedSchema, readback, resolveCommand, VoiceParser, type CatalogProduct } from './parser';
import { observe } from './metrics';

export const overrideItem = z.object({ product_id: z.uuid(), quantity: z.number().int().min(-999999999).max(999999999).refine(n => n !== 0) }).strict();
export const confirmSchema = z.object({ product_id: z.uuid().optional(), quantity: z.number().int().min(-999999999).max(999999999).refine(n => n !== 0).optional(),
  action: z.enum(['sale', 'restock', 'adjustment']).optional(), allow_negative: z.boolean().default(false),
  learn_alias: z.boolean().optional(),
  items: z.array(overrideItem).min(1).max(20).optional() }).strict();
export const manualSchema = z.object({ action: z.enum(['sale', 'restock', 'adjustment']), items: z.array(overrideItem).min(1).max(20) }).strict();
export type ConfirmInput = z.infer<typeof confirmSchema>;
export const voiceJson = (log: VoiceLog, ttlMs = 300000) => ({ voice_log_id: log.id, status: log.status, transcript: log.transcript,
  expires_at: new Date(log.createdAt.getTime() + ttlMs).toISOString(),
  parsed: log.parsed, candidates: log.candidates, confidence: log.confidence, readback_text: log.readbackText,
  error_code: log.errorCode, ...(log.status === 'failed' ? { message: log.errorCode ? manualMessage : (log.readbackText || "I couldn't identify that product or command. Try speaking again or enter manually below.") } : {}),
  created_at: log.createdAt.toISOString(), resulting_movement: log.result });

export class VoiceService {
  private cache = new Map<string, { audio: Buffer; contentType: string }>();
  private inflight = new Map<string, Promise<{ audio: Buffer; contentType: string }>>();
  readonly speech: SpeechToTextProvider;
  readonly tts: TextToSpeechProvider;
  readonly parser: VoiceParser;
  constructor(private db: PrismaClient, readonly config: Config,
    providers?: { speech: SpeechToTextProvider; tts: TextToSpeechProvider; parser: VoiceParser }) {
    const speech = config.VOICE_MOCK_MODE === 'true' ? new MockSpeech() : new YarnGpt(config);
    this.speech = providers?.speech ?? speech;
    this.tts = providers?.tts ?? speech;
    this.parser = providers?.parser ?? new VoiceParser(config.VOICE_MOCK_MODE === 'true' ? new MockLlm() : new HttpLlm(config));
  }
  async initialize() { if (this.tts instanceof YarnGpt) await this.tts.initialize(); }
  async products(businessId: string): Promise<CatalogProduct[]> {
    return (await this.db.product.findMany({ where: { businessId, deletedAt: null }, orderBy: { id: 'asc' } }))
      .map(product => ({ id: product.id, name: product.name, aliases: product.aliases, unit: product.unit, currentQty: product.stockQty.toString() }));
  }
  async owned(actor: InventoryActor, id: string) {
    const log = await this.db.voiceLog.findFirst({ where: { id, businessId: actor.businessId, createdById: actor.userId } });
    if (!log) throw new HttpError(404, 'Voice command not found');
    return log;
  }
  async candidates(businessId: string, phrases: string[]): Promise<CatalogProduct[]> {
    const groups = await Promise.all(phrases.map(async phrase => {
      const term = normalize(phrase).slice(0, 200);
      if (!term) return [];
      return this.db.$queryRaw<CatalogProduct[]>`SELECT id, name, aliases, unit, stock_qty::text AS "currentQty"
        FROM vendora.products WHERE business_id=${businessId}::uuid AND deleted_at IS NULL
        AND (lower(name) OPERATOR(public.%) ${term} OR vendora.voice_alias_keys(aliases) && ARRAY[${term}]::text[])
        ORDER BY CASE WHEN lower(name)=${term} OR ${term}=ANY(vendora.voice_alias_keys(aliases)) THEN 1 ELSE 0 END DESC,
          public.similarity(lower(name), ${term}) DESC, id LIMIT 30`;
    }));
    return [...new Map(groups.flat().map(product => [product.id, product])).values()];
  }
  async create(actor: InventoryActor, input: { transcript?: string; audio?: Buffer; mimeType?: string; mockTranscript?: string }) {
    await requireRelational(this.db, actor.businessId);
    const started = Date.now();
    const log = await this.db.voiceLog.create({ data: { id: randomUUID(), businessId: actor.businessId, createdById: actor.userId } });
    try {
      let transcript = input.transcript;
      if (transcript === undefined) {
        const stage = Date.now();
        const provider: SpeechToTextProvider = this.config.VOICE_MOCK_MODE === 'true' && input.mockTranscript !== undefined ? new MockSpeech(input.mockTranscript) : this.speech;
        const result = await provider.transcribe(input.audio!, input.mimeType!, log.id);
        voiceLog('asr', log.id, stage);
        await this.db.voiceLog.update({ where: { id: log.id }, data: { asrJobId: result.jobId ?? null,
          audioSeconds: result.audioSeconds ?? null, transcript: result.transcript.slice(0, 8000) } });
        if (result.audioSeconds !== undefined && result.audioSeconds > voicePolicy.maxSeconds) throw new VoiceError('AUDIO_TOO_LONG');
        transcript = result.transcript;
      }
      if (transcript.length > 8000) throw new VoiceError('TRANSCRIPT_TOO_LONG');
      await this.db.voiceLog.update({ where: { id: log.id }, data: { transcript } });
      const llmStart = Date.now();
      const parsed = await this.parser.parse(transcript, []);
      // Product IDs supplied during extraction have no trusted catalog provenance.
      if (parsed.items.some(item => item.product_id !== null)) throw new VoiceError('UNTRUSTED_PRODUCT_ID');
      voiceLog('llm', log.id, llmStart);
      observe('intent_extraction', Date.now() - llmStart);
      const matchStart = Date.now();
      const products = await this.candidates(actor.businessId, parsed.items.map(item => item.spoken_name));
      const result = resolveCommand(parsed, products);
      if (this.config.VOICE_MOCK_MODE !== 'true' && parsed.items.length === 1 && result.status === 'needs_clarification') {
        const group = result.candidates[0]!.filter(p => p.score >= .5);
        if (group.length > 1) {
          const suggestion = await this.parser.suggest(transcript, products.filter(p => group.some(c => c.product_id === p.id)));
          if (suggestion.product_id) {
            const selected = products.find(p => p.id === suggestion.product_id)!;
            result.parsed.clarification_question = `Did you mean ${selected.name}? Please choose the product on the card.`;
          }
        }
      }
      // Even ambiguous stock questions are read-only replies, never mutation cards.
      if (parsed.action === 'check_stock') {
        if (result.status !== 'pending') {
          result.parsed.needs_clarification = true;
          result.parsed.clarification_question = 'Which product do you want to check? Please say its full name.';
        }
        result.status = 'completed';
      }
      voiceLog('match', log.id, matchStart);
      observe('product_matching', Date.now() - matchStart);
      observe('confirmation_readiness', Date.now() - started);
      return await this.db.voiceLog.update({ where: { id: log.id }, data: { status: result.status,
        parsed: inventoryJson(result.parsed), candidates: JSON.parse(JSON.stringify(result.candidates)) as Prisma.InputJsonValue,
        confidence: result.confidence, readbackText: readback(result.parsed, products), latencyMs: Date.now() - started } });
    } catch (error: unknown) {
      const code = error instanceof VoiceError ? error.code : error instanceof Error && error.message === 'CROSS_BUSINESS_PRODUCT' ? 'CROSS_BUSINESS_PRODUCT' : 'VOICE_FAILED';
      voiceLog('failed', log.id, started, code, error instanceof VoiceError ? error.traceId : undefined);
      return this.db.voiceLog.update({ where: { id: log.id }, data: { status: 'failed', errorCode: code, readbackText: manualMessage, latencyMs: Date.now() - started } });
    }
  }
  async manual(actor: InventoryActor, input: z.infer<typeof manualSchema>) {
    await requireRelational(this.db, actor.businessId);
    const products = await this.products(actor.businessId);
    const items = input.items.map(item => {
      const product = products.find(p => p.id === item.product_id);
      if (!product) throw new HttpError(404, 'Product not found');
      if (input.action !== 'adjustment' && item.quantity < 1) throw new HttpError(400, 'Enter a positive whole quantity');
      return { ...item, spoken_name: product.name, unit: product.unit };
    });
    const parsed = { action: input.action, items, needs_clarification: false, clarification_question: null };
    return this.db.voiceLog.create({ data: { businessId: actor.businessId, createdById: actor.userId,
      status: 'pending', transcript: 'Manual entry', parsed: inventoryJson(parsed), confidence: 1,
      readbackText: readback(parsed, products), candidates: items.map(item => [products.find(p => p.id === item.product_id)!]).map(group => group.map(p => ({ product_id: p.id, name: p.name, unit: p.unit, current_qty: p.currentQty!, score: 1 }))) } });
  }
  async confirm(actor: InventoryActor, id: string, input: ConfirmInput) {
    const started = Date.now();
    const receipt = await this.db.$transaction(async tx => {
      // Match the lock order used by all existing inventory writers.
      await tx.$queryRaw`SELECT id FROM vendora.businesses WHERE id=${actor.businessId}::uuid FOR UPDATE`;
      await requireRelational(tx, actor.businessId);
      const member = await tx.membership.findUnique({ where: { userId_businessId: { userId: actor.userId, businessId: actor.businessId } }, include: { user: true } });
      if (!member || member.status !== 'active' || member.user.status !== 'active' || !member.permissions.includes('sales:write')) throw new HttpError(403, 'Permission required');
      await tx.$queryRaw`SELECT id FROM vendora.voice_logs WHERE id=${id}::uuid AND business_id=${actor.businessId}::uuid FOR UPDATE`;
      const log = await tx.voiceLog.findFirst({ where: { id, businessId: actor.businessId, createdById: actor.userId } });
      if (!log) throw new HttpError(404, 'Voice command not found');
      if (log.status === 'confirmed') return log.result;
      if (!['pending', 'needs_clarification'].includes(log.status)) throw new HttpError(409, 'This command cannot be confirmed', 'VOICE_STATUS');
      if (Date.now() - log.createdAt.getTime() > this.config.VOICE_PENDING_TTL_MS) throw new HttpError(409, 'This command expired. Please say it again.', 'VOICE_EXPIRED');
      const parsed = parsedSchema.parse(log.parsed);
      if (parsed.action === 'check_stock') throw new HttpError(409, 'Stock queries cannot change inventory', 'VOICE_STATUS');
      const action = input.action ?? parsed.action;
      if (action === 'unknown') throw new HttpError(400, 'Choose an action');
      if (parsed.items.length > 1 && (input.product_id || input.quantity !== undefined)) throw new HttpError(400, 'Edit each item individually');
      if (input.items && input.items.length !== parsed.items.length) throw new HttpError(400, 'Review every item in the command');
      if (log.status === 'needs_clarification' && !input.items && !input.product_id) throw new HttpError(400, 'Choose and review the product first');
      const items = input.items ?? parsed.items.map(item => ({ product_id: input.product_id ?? item.product_id, quantity: input.quantity ?? item.quantity }));
      const results: MovementResult[] = [];
      for (const [index, item] of items.entries()) {
        if (!item.product_id || !Number.isInteger(item.quantity) || item.quantity === 0 || (action !== 'adjustment' && item.quantity < 1)) throw new HttpError(400, 'Choose a product and a valid whole quantity');
        const product = await tx.product.findFirst({ where: { id: item.product_id, businessId: actor.businessId, deletedAt: null } });
        if (!product) throw new HttpError(404, 'Product not found');
        // Unedited incompatible units must never be applied as catalog units.
        const original = parsed.items[index]!;
        if (!input.items && !input.product_id && original.unit.toLowerCase().replace(/s$/, '') !== product.unit.toLowerCase().replace(/s$/, '')) throw new HttpError(400, 'Review the product unit');
        if (input.learn_alias) {
          const alias = normalize(original.spoken_name);
          if (alias && alias !== normalize(product.name) && !product.aliases.includes(alias)) {
            await tx.product.update({ where: { id: product.id }, data: { aliases: { push: alias } } });
          }
        }
        const delta = action === 'sale' ? -item.quantity : item.quantity;
        const moved = await applyStockMovement(this.db, actor, { productId: product.id, clientId: randomUUID(),
          type: action === 'sale' ? 'SALE' : action === 'restock' ? 'RESTOCK' : 'LEGACY_ADJUSTMENT',
          quantity: new Prisma.Decimal(delta), source: 'voice', referenceId: index === 0 ? log.id : `${log.id}:${index}`,
          allowNegative: input.allow_negative, metadata: { voice_log_id: log.id, item_index: index, action } }, tx);
        if (new Prisma.Decimal(moved.result.product.currentQty).lte(product.lowStockAt)) {
          const existing = await tx.notification.findFirst({ where: { businessId: actor.businessId, productId: product.id, readAt: null } });
          if (!existing) await tx.notification.create({ data: { businessId: actor.businessId, productId: product.id, type: 'LOW_STOCK', message: `Low stock: ${product.name}` } });
        }
        results.push(moved.result);
      }
      const notifications = await tx.notification.findMany({ where: { businessId: actor.businessId, productId: { in: results.map(r => r.product.id) }, readAt: null } });
      const finalProducts = [...new Map(results.map(r => [r.product.id, r.product])).values()];
      const receiptText = `Done. ${finalProducts.map(p => {
        const qty = Number(p.currentQty ?? '0');
        const formatted = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
        const u = (p.unit || '').trim().toLowerCase().replace(/s$/, '');
        const plural = qty === 1 ? u : (u ? `${u}s` : '');
        return `${p.name}: ${formatted} ${plural} remaining`.trim();
      }).join('. ')}.`;
      const result = { voice_log_id: log.id, status: 'confirmed', movements: results.map(r => r.movement), products: finalProducts, receipt_text: receiptText, low_stock: notifications.map(n => ({ id: n.id, product_id: n.productId, message: n.message })) };
      await tx.voiceLog.update({ where: { id }, data: { status: 'confirmed', movementId: results[0]!.movement.id,
        readbackText: receiptText,
        parsed: inventoryJson({ ...parsed, action, items: items.map((item, i) => ({ ...parsed.items[i]!, ...item, unit: results[i]!.product.unit })), needs_clarification: false, clarification_question: null }), result: inventoryJson(result) } });
      return result;
    }, { maxWait: 15000, timeout: 20000 });
    observe('database_execution', Date.now() - started);
    return receipt;
  }
  async reject(actor: InventoryActor, id: string) {
    // Compare-and-set competes safely with confirm's row lock; a confirmed log cannot be rejected.
    await this.db.voiceLog.updateMany({ where: { id, businessId: actor.businessId, createdById: actor.userId, status: { in: ['pending', 'needs_clarification', 'failed'] } }, data: { status: 'rejected' } });
    const log = await this.owned(actor, id);
    if (log.status !== 'rejected') throw new HttpError(409, 'This command cannot be rejected', 'VOICE_STATUS');
    return log;
  }
  async readback(actor: InventoryActor, id: string) {
    const log = await this.owned(actor, id);
    if (!log.readbackText || !['pending', 'needs_clarification', 'confirmed', 'completed'].includes(log.status)) return null;
    const key = createHash('sha256').update(log.readbackText).digest('hex');
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    let pending = this.inflight.get(key);
    if (!pending) {
      const started = Date.now();
      pending = this.tts.synthesize(log.readbackText, randomUUID()).then(value => {
        voiceLog('tts', id, started);
        observe('speech_synthesis', Date.now() - started);
        this.cache.set(key, value);
        while (this.cache.size > voicePolicy.readbackCacheEntries || [...this.cache.values()].reduce((sum, v) => sum + v.audio.length, 0) > voicePolicy.readbackCacheBytes) this.cache.delete(this.cache.keys().next().value!);
        return value;
      }).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    try { return await pending; } catch (error: unknown) {
      voiceLog('tts_failed', id, Date.now(), error instanceof VoiceError ? error.code : 'TTS_FAILED', error instanceof VoiceError ? error.traceId : undefined);
      return null;
    }
  }
}
