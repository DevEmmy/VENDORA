/* AudioWorklet runs off the main thread. Average channels, resample, emit PCM16LE.
 * Fractional sample positions are retained across render blocks. */
class VoicePcm extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = []; this.position = 0; this.frame = [];
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.emitFrame(); this.stopped = true; this.port.postMessage({ flushed: true });
      }
    };
  }
  emitFrame() {
    if (!this.frame.length) return;
    const buffer = new ArrayBuffer(this.frame.length * 2), view = new DataView(buffer);
    this.frame.forEach((sample, index) => view.setInt16(index * 2, sample, true));
    this.port.postMessage(buffer, [buffer]); this.frame = [];
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.samples.push(value);
    }
    const step = sampleRate / 16000;
    while (this.position + 1 < this.samples.length) {
      const i = Math.floor(this.position), weight = this.position - i;
      const value = Math.max(-1, Math.min(1, this.samples[i] * (1 - weight) + this.samples[i + 1] * weight));
      this.frame.push(value < 0 ? value * 32768 : value * 32767);
      this.position += step;
      if (this.frame.length === 4000) {
        this.emitFrame();
      }
    }
    // Preserve overshoot when the next resampling position lies beyond this block.
    const consumed = Math.min(Math.floor(this.position), this.samples.length);
    this.samples.splice(0, consumed); this.position -= consumed;
    return true;
  }
}
registerProcessor('voice-pcm', VoicePcm);
