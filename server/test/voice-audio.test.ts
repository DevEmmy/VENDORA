import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAudio, webmDuration } from '../src/voice/audio';
test('streaming WebM duration uses block timestamps even when Duration is absent', () => {
  // Empty EBML header, unknown-length segment and cluster, 21-second block.
  const clip = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xff,
    0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x81, 0,
    0xa3, 0x85, 0x81, 0, 0, 0x80, 0xf8,
    0xa3, 0x85, 0x81, 0x52, 0x08, 0x80, 0xf8]);
  assert.equal(webmDuration(clip), 21.02);
  assert.equal(webmDuration(Buffer.from('not webm')), undefined);
  assert.throws(() => webmDuration(clip.subarray(0, clip.length - 1)), /Truncated/);
});
test('short WebM clips with a nonzero microphone clock are not treated as long recordings', () => {
  const clip = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xff,
    0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x83, 0x01, 0x86, 0xa0,
    0xa3, 0x85, 0x81, 0, 0, 0x80, 0xf8,
    0xa3, 0x85, 0x81, 0x03, 0xe8, 0x80, 0xf8]);
  assert(Math.abs(webmDuration(clip)! - 1.02) < .000001);
});
test('unknown audio content cannot bypass duration enforcement', async () => {
  await assert.rejects(validateAudio(Buffer.from('not audio'), 'audio/webm', 20));
});
