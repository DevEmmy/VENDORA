import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Config } from '../config/env';
import { voicePolicy } from '../config/voice';
import { HttpError, asyncRoute } from '../middleware/error-handler';
import type { Limiter } from '../middleware/rate-limit';
import type { AuthRepository } from '../repositories/auth.repository';
import { Authorization } from '../services/authorization.service';
import { confirmSchema, manualSchema, VoiceService, voiceJson } from '../voice/service';
import { validateAudio } from '../voice/audio';
import { LiveSessions, MockLive, YarnLive, type StreamingSpeechProvider } from '../voice/live';
import { latencySummary } from '../voice/metrics';

export function voiceRoutes(repo: AuthRepository, config: Config, limiter: Limiter, service = new VoiceService(repo.db, config), streamProvider?: StreamingSpeechProvider) {
  const router = Router();
  const json = (log: Parameters<typeof voiceJson>[0]) => voiceJson(log, config.VOICE_PENDING_TTL_MS);
  const authorization = new Authorization(repo);
  const live = new LiveSessions(service, streamProvider ?? (config.VOICE_MOCK_MODE === 'true' ? new MockLive() : new YarnLive(config)));
  const scope = async (req: Parameters<Parameters<typeof asyncRoute>[0]>[0]) => {
    const member = await authorization.business(req.auth!, 'sales:write', req.get('x-business-id'));
    return { businessId: member.businessId, userId: req.auth!.user.id };
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: voicePolicy.uploadBytes, files: 1, fields: 0, parts: 1 } }).single('audio');
  const typedEnabled = config.NODE_ENV !== 'production' || config.VOICE_MOCK_MODE === 'true';
  router.get('/api/voice/config', asyncRoute(async (req, res) => { await scope(req); res.json({ typed_transcript: typedEnabled, mock: config.VOICE_MOCK_MODE === 'true', live: config.VOICE_STREAM_PROVIDER !== 'disabled', pending_ttl_ms: config.VOICE_PENDING_TTL_MS }); }));
  router.get('/api/voice/latency', asyncRoute(async (req, res) => {
    await scope(req); res.json({ scope: 'process', stages: latencySummary() });
  }));
  router.post('/api/voice/streams', asyncRoute(async (req, res) => {
    const actor = await scope(req);
    await limiter.take(`voice-stream:${actor.userId}`, 10, 60);
    if (config.VOICE_STREAM_PROVIDER === 'disabled') throw new HttpError(503, 'Live speech is disabled; use recording or manual entry');
    const body = z.object({ pending_action_id: z.uuid().nullable().optional() }).strict().parse(req.body);
    if (body.pending_action_id) await service.owned(actor, body.pending_action_id);
    const session = live.create(actor);
    session.pending = body.pending_action_id ?? null;
    res.status(201).json({ stream_id: session.id });
  }));
  router.get('/api/voice/streams/:id/events', asyncRoute(async (req, res) => {
    const session = live.owned(await scope(req), z.uuid().parse(req.params.id));
    res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    const unsubscribe = session.subscribe(event => {
      if (!res.write(`data: ${JSON.stringify(event)}\n\n`)) { res.end(); session.close(); }
      if (event.type === 'done' || event.type === 'error') res.end();
    });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    res.on('close', () => { clearInterval(heartbeat); unsubscribe(); session.close(); });
  }));
  router.post('/api/voice/streams/:id/audio', asyncRoute(async (req, res) => {
    const userId = req.auth!.user.id;
    await limiter.take(`voice-audio:${userId}`, 600, 60);
    const body = z.object({ sequence: z.number().int().min(0).max(2000), pcm: z.string().max(44000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().parse(req.body);
    const businessId = req.get('x-business-id');
    try {
      live.authorized(userId, z.uuid().parse(req.params.id), businessId).audio(body.sequence, Buffer.from(body.pcm, 'base64'));
      res.json({ accepted: true });
    } catch (err: unknown) {
      if (err instanceof HttpError && err.status === 409 && err.message.includes('not ready')) {
        res.json({ accepted: false });
        return;
      }
      throw err;
    }
  }));
  router.post('/api/voice/streams/:id/finalize', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body);
    live.owned(await scope(req), z.uuid().parse(req.params.id)).finish(); res.json({ accepted: true });
  }));
  router.post('/api/voice/commands', asyncRoute(async (req, res, next) => {
    const actor = await scope(req);
    await limiter.take(`voice:${actor.businessId}`, 30, 60);
    if (req.is('application/json')) {
      if (!typedEnabled) throw new HttpError(415, 'Record audio or use manual entry');
      const body = z.object({ transcript: z.string().max(8000) }).strict().parse(req.body);
      res.status(201).json(json(await service.create(actor, body))); return;
    }
    if (!req.is('multipart/form-data')) throw new HttpError(415, 'Upload an audio recording');
    upload(req, res, error => {
      if (error) { next(new HttpError(413, 'Use one recording under 5 MB and 20 seconds, or manual entry.', 'INVALID_AUDIO')); return; }
      void (async () => {
        const file = req.file;
        if (!file?.size || !/^audio\/(webm|mp4|x-m4a|m4a|wav|x-wav|mpeg|mp3|ogg)(;.*)?$/i.test(file.mimetype)) throw new HttpError(400, 'Use a supported audio recording or manual entry', 'INVALID_AUDIO');
        try {
          try {
            await validateAudio(file.buffer, file.mimetype, voicePolicy.maxSeconds);
          } catch {
            // Only container facts: never raw audio, transcript or arbitrary parser messages.
            console.warn(JSON.stringify({ event: 'voice_audio_rejected', requestId: res.locals.requestId,
              mime_type: file.mimetype, byte_count: file.size }));
            throw new HttpError(400, 'This recording could not be read. Please record again for under 20 seconds, or use manual entry.', 'INVALID_AUDIO');
          }
          const mockTranscript = config.VOICE_MOCK_MODE === 'true' ? req.get('x-mock-transcript') : undefined;
          res.status(201).json(json(await service.create(actor, { audio: file.buffer, mimeType: file.mimetype,
            ...(mockTranscript !== undefined ? { mockTranscript: z.string().max(8000).parse(mockTranscript) } : {}) })));
        } finally { file.buffer.fill(0); }
      })().catch(next);
    });
  }));
  router.post('/api/voice/manual', asyncRoute(async (req, res) => {
    const actor = await scope(req); await limiter.take(`voice:${actor.businessId}`, 30, 60);
    res.status(201).json(json(await service.manual(actor, manualSchema.parse(req.body))));
  }));
  router.get('/api/voice/commands/:id/readback', asyncRoute(async (req, res) => {
    const actor = await scope(req); const id = z.uuid().parse(req.params.id);
    const result = await service.readback(actor, id);
    if (!result) { res.status(204).end(); return; }
    res.type(result.contentType).send(result.audio);
  }));
  router.post('/api/voice/commands/:id/confirm', asyncRoute(async (req, res) => {
    res.json(await service.confirm(await scope(req), z.uuid().parse(req.params.id), confirmSchema.parse(req.body ?? {})));
  }));
  router.post('/api/voice/commands/:id/reject', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json(json(await service.reject(await scope(req), z.uuid().parse(req.params.id))));
  }));
  router.get('/api/voice/commands', asyncRoute(async (req, res) => {
    const actor = await scope(req);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.uuid().optional() }).strict().parse(req.query);
    const cursor = query.cursor ? await service.owned(actor, query.cursor) : null;
    const rows = await repo.db.voiceLog.findMany({ where: { businessId: actor.businessId, ...(cursor ? {
      OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
    } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    res.json({ commands: page.map(json), next_cursor: rows.length > query.limit ? page.at(-1)!.id : null });
  }));
  return router;
}
