import assert from 'node:assert/strict';
import test from 'node:test';
import { playReadback, recordAudio, recorderMime, pcmWav, prepareAudio } from '../src/features/voice/recorder.js';

test('recorder selects Opus first with MP4 Safari fallback', () => {
  assert.equal(recorderMime({ isTypeSupported: value => value.includes('webm') }), 'audio/webm;codecs=opus');
  assert.equal(recorderMime({ isTypeSupported: value => value === 'audio/mp4' }), 'audio/mp4');
  assert.equal(recorderMime(null), null);
});
test('missing microphone and permission denial are actionable errors', async () => {
  await assert.rejects(recordAudio({}, {}), /manual entry/);
  await assert.rejects(recordAudio({}, { MediaRecorder: { isTypeSupported: () => true }, navigator: { mediaDevices: {
    getUserMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); },
  } } }), { name: 'NotAllowedError' });
});
test('stopping produces one audio blob and releases microphone tracks', async () => {
  let releases = 0, result;
  class Media {
    static isTypeSupported() { return true; }
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }
  }
  const ctl = await recordAudio({ onState() {}, onLevel() {}, onSeconds() {}, onError() {}, onAudio: blob => { result = blob; } },
    { MediaRecorder: Media, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => releases++ }] }) } } });
  ctl.stop(); assert.equal(result.size, 5); assert.equal(releases, 1);
});
test('cancel releases microphone without submitting audio', async () => {
  let submitted = false;
  class Media { static isTypeSupported() { return true; } state = 'inactive'; start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop(); } }
  const ctl = await recordAudio({ onState() {}, onAudio() { submitted = true; } }, { MediaRecorder: Media,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  ctl.cancel(); assert.equal(submitted, false);
});
test('blocked autoplay falls back to device speech, then text only', async () => {
  let spoken = '', revoked = 0;
  const stop = await playReadback(new Blob(['audio']), 'Sold 2 bags', null, {
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => revoked++ },
    Audio: class { async play() { throw new Error('autoplay'); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { speak: value => { spoken = value.text; }, cancel() {} },
  });
  assert.equal(spoken, 'Sold 2 bags'); assert.equal(revoked, 1); stop();
  assert.equal(typeof await playReadback(null, 'text', null, {}), 'function');
});
test('recorder stops itself at fifteen seconds', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  let submitted = 0;
  class Media { static isTypeSupported() { return true; } state = 'inactive'; start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop(); } }
  await recordAudio({ onState() {}, onSeconds() {}, onAudio() { submitted++; } }, { MediaRecorder: Media,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  t.mock.timers.tick(14900); assert.equal(submitted, 0);
  t.mock.timers.tick(100); assert.equal(submitted, 1);
});
test('decoded Chrome recordings become mono PCM WAV with explicit duration', async () => {
  const decoded = { duration: 1, length: 16000, sampleRate: 16000, numberOfChannels: 2,
    getChannelData: index => Float32Array.from({ length: 16000 }, () => index === 0 ? 1 : -1) };
  const wav = pcmWav(decoded); const bytes = new DataView(await wav.arrayBuffer());
  assert.equal(wav.type, 'audio/wav'); assert.equal(wav.size, 32044);
  assert.equal(bytes.getUint16(22, true), 1); assert.equal(bytes.getUint32(24, true), 16000);
  assert.equal(bytes.getUint32(40, true), 32000); assert.equal(bytes.getInt16(44, true), 0);
  assert.throws(() => pcmWav({ ...decoded, duration: 21 }), /20 seconds/);
  let closed = false;
  const normalized = await prepareAudio(new Blob(['webm'], { type: 'audio/webm' }), { AudioContext: class {
    async decodeAudioData() { return decoded; }
    async close() { closed = true; }
  } });
  assert.equal(normalized.type, 'audio/wav'); assert.equal(closed, true);
});
test('unreadable recordings release their decoder and offer another recording', async () => {
  let closed = false;
  await assert.rejects(prepareAudio(new Blob(['broken']), { AudioContext: class {
    async decodeAudioData() { throw new Error('format'); }
    async close() { closed = true; }
  } }), /record again/);
  assert.equal(closed, true);
});
