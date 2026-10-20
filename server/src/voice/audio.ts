// MediaRecorder WebM often omits Duration. Walk its EBML timestamps instead of
// trusting a client-supplied duration or uploading arbitrarily long recordings.
export function webmDuration(audio: Buffer): number | undefined {
  if (audio.length < 4 || audio.readUInt32BE(0) !== 0x1a45dfa3) return undefined;
  let scale = 1_000_000, last = -Infinity, first = Infinity, found = false;
  function vint(at: number, id = false) {
    const first = audio[at]; if (!first) throw new Error('Invalid EBML');
    let length = 1; while (length <= 8 && !(first & (1 << (8 - length)))) length++;
    if (length > (id ? 4 : 8) || at + length > audio.length) throw new Error('Invalid EBML');
    let value = id ? first : first & ((1 << (8 - length)) - 1);
    let unknown = !id && value === (1 << (8 - length)) - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + audio[at + i]!; unknown = unknown && audio[at + i] === 255; }
    return { length, value, unknown };
  }
  function walk(start: number, end: number, depth: number, clusterTime = 0) {
    if (depth > 8) throw new Error('Invalid EBML depth');
    for (let at = start; at < end;) {
      const id = vint(at, true), size = vint(at + id.length);
      const data = at + id.length + size.length;
      const next = size.unknown ? end : data + size.value;
      if (next > end || next <= at || !Number.isSafeInteger(next)) throw new Error('Truncated EBML');
      if (id.value === 0x2ad7b1 || id.value === 0xe7) {
        if (next - data > 6) throw new Error('Invalid EBML time');
        const value = audio.readUIntBE(data, next - data);
        if (id.value === 0x2ad7b1) scale = value; else clusterTime = value;
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = vint(data);
        if (next < data + track.length + 4) throw new Error('Truncated audio block');
        const relative = audio.readInt16BE(data + track.length);
        const flags = audio[data + track.length + 2]!;
        const packet = data + track.length + 3;
        let seconds = .12; // conservative upper packet bound for laced/Vorbis blocks
        if (!(flags & 6)) {
          const toc = audio[packet]!, config = toc >> 3;
          const frameMs = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : [10, 20, 40, 60][config & 3]!;
          const count = (toc & 3) === 0 ? 1 : (toc & 3) < 3 ? 2 : (audio[packet + 1] ?? 0) & 63;
          seconds = Math.min(.12, frameMs * count / 1000);
        }
        const timestamp = (clusterTime + relative) * scale / 1e9;
        first = Math.min(first, timestamp);
        last = Math.max(last, timestamp + seconds); found = true;
      } else if ([0x18538067, 0x1549a966, 0x1f43b675, 0xa0].includes(id.value)) walk(data, next, depth + 1, clusterTime);
      at = next;
    }
  }
  walk(0, audio.length, 0);
  // Presentation timestamps may start at a nonzero microphone clock offset.
  // The recording length is its timeline span, not its final absolute timestamp.
  return found && last > first ? last - first : undefined;
}

export async function validateAudio(audio: Buffer, mimeType: string, maxSeconds: number) {
  const { parseBuffer } = await import('music-metadata');
  const metadata = await parseBuffer(audio, { mimeType }, { duration: true });
  if (!metadata.format.container || metadata.format.hasVideo || metadata.format.trackInfo?.some(track => track.type === 1)) throw new Error('Not audio-only');
  const timeline = webmDuration(audio);
  const duration = timeline ?? metadata.format.duration;
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0 || duration > maxSeconds) throw new Error('Invalid recording duration');
  return duration;
}
