import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceSchema, validateVoice } from '../src/config/voice';
import { YarnGpt, MockSpeech, VoiceError, HttpLlm } from '../src/voice/providers';

const config = voiceSchema.parse({ VOICE_MOCK_MODE: 'true', YARNGPT_API_KEY: 'fake-secret', YARNGPT_TTS_VOICE: 'test' });
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
test('voice config fails clearly without live credentials and allows keyless mocks', () => {
  validateVoice(config);
  assert.throws(() => validateVoice(voiceSchema.parse({})), /YARNGPT_API_KEY, LLM_API_KEY, LLM_MODEL/);
});
test('ASR uploads only file, retains idempotency, backs off and accepts completed silence', async () => {
  const delays: number[] = []; const calls: RequestInit[] = [];
  const replies = [json({ error: { code: 'PROVIDER_TIMEOUT', trace_id: 'test' } }, 504), json({ job_id: 'job' }, 202),
    json({ status: 'queued' }), json({ status: 'processing' }), json({ status: 'completed', transcript: '' })];
  const provider = new YarnGpt(config, async (_url, init) => { calls.push(init!); return replies.shift()!; }, async ms => { delays.push(ms); });
  assert.equal((await provider.transcribe(Buffer.from('fake'), 'audio/webm', 'voice-uuid')).transcript, '');
  assert.equal((calls[0]!.headers as Record<string, string>)['Idempotency-Key'], 'voice-uuid');
  assert.equal(calls[0]!.body, calls[1]!.body);
  assert.deepEqual([...(calls[0]!.body as FormData).keys()], ['file']);
  assert.deepEqual(delays, [1000, 1500, 2250]);
});
test('ASR retries only one eligible failed job with fresh key', async () => {
  let uploads = 0;
  const provider = new YarnGpt(config, async (url) => {
    if (String(url).endsWith('/asr')) { uploads++; return json({ job_id: String(uploads) }, 202); }
    return json({ status: 'failed', error_code: 'PROVIDER_TIMEOUT', audio_available: true });
  }, async () => {});
  await assert.rejects(provider.transcribe(Buffer.alloc(1), 'audio/webm', 'key'), VoiceError);
  assert.equal(uploads, 2);
});
test('quota errors are friendly and never expose provider message or secret', async () => {
  const provider = new YarnGpt(config, async () => json({ error: { code: 'QUOTA_EXCEEDED', message: 'fake-secret', trace_id: 'trace' } }, 402));
  await assert.rejects(provider.transcribe(Buffer.alloc(1), 'audio/webm', 'key'), (error: unknown) =>
    error instanceof VoiceError && error.code === 'QUOTA_EXCEEDED' && !error.message.includes('fake-secret'));
});
test('rate limit honors Retry-After once and timeout terminates polling', async () => {
  let calls = 0; const delays: number[] = [];
  const provider = new YarnGpt(config, async () => { calls++; return json({ error: { code: 'RATE_LIMITED' } }, 429, { 'Retry-After': '2' }); }, async ms => { delays.push(ms); });
  await assert.rejects(provider.transcribe(Buffer.alloc(1), 'audio/webm', 'key'));
  assert.equal(calls, 2); assert.deepEqual(delays, [2000]);
  const short = new YarnGpt({ ...config, VOICE_ASR_TIMEOUT_MS: 10 }, async () => json({ job_id: 'job' }, 202));
  await assert.rejects(short.transcribe(Buffer.alloc(1), 'audio/webm', 'key'));
});
test('TTS validates response and mock MP3 is bundled', async () => {
  const provider = new YarnGpt(config, async () => json({ error: 'no audio' }));
  await assert.rejects(provider.synthesize('Confirm rice', 'key'));
  const mock = await new MockSpeech().synthesize();
  assert(mock.audio.length > 128); assert.equal(mock.contentType, 'audio/mpeg');
});
test('TTS discovers the default voice once and sends a fresh readback key', async () => {
  let lookups = 0; const keys: string[] = [];
  const provider = new YarnGpt({ ...config, YARNGPT_TTS_VOICE: undefined }, async (url, init) => {
    if (String(url).endsWith('/voices')) { lookups++; return json({ data: { voices: [{ name: 'chosen-from-catalog', default: true }] } }); }
    const body = JSON.parse(String(init!.body)) as { voice: string; output_format: string };
    assert.equal(body.voice, 'chosen-from-catalog'); assert.equal(body.output_format, 'mp3');
    keys.push((init!.headers as Record<string, string>)['Idempotency-Key']!);
    return new Response(Buffer.alloc(512), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  await provider.initialize(); await provider.synthesize('Rice?', 'first'); await provider.synthesize('Rice?', 'second');
  assert.equal(lookups, 1); assert.deepEqual(keys, ['first', 'second']);
});
test('unexpected voice shape omits voice, and invalid API keys are not retried', async () => {
  const provider = new YarnGpt({ ...config, YARNGPT_TTS_VOICE: undefined }, async (url, init) => {
    if (String(url).endsWith('/voices')) return json({ unexpected: 'provider value is not logged' });
    const body = JSON.parse(String(init!.body)) as object;
    assert(!('voice' in body));
    return new Response(Buffer.alloc(512), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  await provider.synthesize('Rice?', 'key');
  let calls = 0;
  const bad = new YarnGpt(config, async () => { calls++; return json({ error: { code: 'INVALID_API_KEY' } }, 401); });
  await assert.rejects(bad.transcribe(Buffer.alloc(1), 'audio/webm', 'key')); assert.equal(calls, 1);
});
test('LLM adapters keep credentials server-side and use configured model and JSON', async () => {
  for (const kind of ['anthropic', 'openai'] as const) {
    const llm = new HttpLlm({ ...config, LLM_PROVIDER: kind, LLM_MODEL: 'configured-model', LLM_API_KEY: 'server-secret', LLM_BASE_URL: 'https://llm.test/v1' }, async (url, init) => {
      assert.equal(String(url), `https://llm.test/v1/${kind === 'anthropic' ? 'messages' : 'chat/completions'}`);
      const body = JSON.parse(String(init!.body)) as { model: string; temperature: number; response_format?: { type: string } };
      assert.equal(body.model, 'configured-model');
      if (kind === 'anthropic') assert.equal(body.temperature, 0);
      else assert.equal(body.temperature, undefined); // Existing reasoning-model integration omits unsupported temperature.
      if (kind === 'openai') assert.equal(body.response_format!.type, 'json_object');
      const headers = init!.headers as Record<string, string>;
      assert.equal(headers[kind === 'anthropic' ? 'x-api-key' : 'Authorization'], kind === 'anthropic' ? 'server-secret' : 'Bearer server-secret');
      return json(kind === 'anthropic' ? { content: [{ type: 'text', text: '{}' }] } : { choices: [{ message: { content: '{}' } }] });
    });
    assert.equal(await llm.complete('system', 'input'), '{}');
  }
});
