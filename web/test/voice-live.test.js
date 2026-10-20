import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readEvents } from '../src/features/voice/live.js';

test('AudioWorklet resamples stereo 48kHz to mono PCM16LE and flushes short utterances', () => {
  let Processor;
  const messages = [];
  const sandbox = { sampleRate: 48000, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } },
    registerProcessor: (_name, value) => { Processor = value; } };
  vm.runInNewContext(readFileSync(new URL('../public/voice-pcm-worklet.js', import.meta.url), 'utf8'), sandbox);
  const worklet = new Processor();
  for (let i = 0; i < 96; i++) worklet.process([[new Float32Array(128).fill(.5), new Float32Array(128).fill(.5)]]);
  assert.equal(messages[0].byteLength, 8000);
  const sample = new DataView(messages[0]).getInt16(0, true);
  assert.equal(sample, 16383);
  worklet.port.onmessage({ data: 'flush' });
  const buffers = messages.filter(message => message.byteLength);
  assert.equal(buffers.reduce((sum, buffer) => sum + buffer.byteLength / 2, 0), 4096);
  assert.equal(messages.at(-1).flushed, true);
  assert.equal(worklet.process([]), false);
});
test('SSE parser handles split UTF-8 and several events per packet, ignores heartbeat, and cancels reader', async () => {
  const encoder = new TextEncoder(), ctl = new AbortController();
  const bytes = encoder.encode(': heartbeat\n\ndata: {"type":"partial","text":"ọṣẹ"}\n\ndata: {"type":"done"}\n\n');
  const events = [];
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
  } });
  await readEvents(stream, event => { events.push(event); if (event.type === 'done') ctl.abort(); }, ctl.signal);
  assert.deepEqual(events, [{ type: 'partial', text: 'ọṣẹ' }, { type: 'done' }]);
  assert.equal(stream.locked, false);
});
