import { observeVoice } from './metrics.js';

let stopOutput = () => {}, playbackEpoch = 0;
export function stopReadback() { playbackEpoch++; stopOutput(); stopOutput = () => {}; }

export function recorderMime(Media = globalThis.MediaRecorder) {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => Media?.isTypeSupported?.(type)) || null;
}
export async function recordAudio({ onLevel, onSeconds, onAudio, onError, onState }, browser = globalThis) {
  const mimeType = recorderMime(browser.MediaRecorder);
  if (!mimeType || !browser.navigator?.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio. Use manual entry below.');
  const stream = await browser.navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder, context, timer, levelTimer, stopped = false;
  const close = () => {
    clearInterval(timer); clearInterval(levelTimer);
    stream.getTracks().forEach(track => track.stop());
    void context?.close().catch(() => {});
  };
  try {
    recorder = new browser.MediaRecorder(stream, { mimeType });
    const chunks = []; const started = Date.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { stopped = true; close(); onError(new Error('Recording failed. Use manual entry below.')); };
    recorder.onstop = () => {
      close();
      if (!stopped) onAudio(new Blob(chunks, { type: recorder.mimeType || mimeType }));
    };
    const AudioContext = browser.AudioContext || browser.webkitAudioContext;
    if (AudioContext) {
      try {
        context = new AudioContext();
        const analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        levelTimer = setInterval(() => { analyser.getByteFrequencyData(data); onLevel(Math.max(...data) / 255); }, 100);
      } catch { /* Recording works even if audio metering is unavailable. */ }
    }
    recorder.start(250); onState('recording');
    timer = setInterval(() => {
      const seconds = (Date.now() - started) / 1000; onSeconds(Math.floor(seconds));
      if (seconds >= 15 && recorder.state === 'recording') recorder.stop();
    }, 100);
    return { stop() { if (recorder.state === 'recording') recorder.stop(); },
      cancel() { stopped = true; if (recorder.state === 'recording') recorder.stop(); close(); } };
  } catch (error) { close(); throw error; }
}

export function pcmWav(decoded) {
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 20 || decoded.length <= 0)
    throw new Error('Please record between a moment and 20 seconds, or use manual entry.');
  const bytes = new ArrayBuffer(44 + decoded.length * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, decoded.sampleRate, true);
  view.setUint32(28, decoded.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, decoded.length * 2, true);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  for (let i = 0; i < decoded.length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function prepareAudio(blob, browser = globalThis) {
  if (blob.type.split(';')[0] === 'audio/wav') return blob;
  const AudioContext = browser.AudioContext || browser.webkitAudioContext;
  if (!AudioContext) return blob; // Backend still validates the original container.
  let context;
  try {
    try { context = new AudioContext({ sampleRate: 16000 }); } catch { context = new AudioContext(); }
    let decoded;
    try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
    catch { throw new Error('This recording could not be read. Please record again or use manual entry.'); }
    return pcmWav(decoded);
  } finally { await context?.close().catch(() => {}); }
}

/**
 * Play a silent 1-sample buffer through the given (or a fresh) AudioContext to
 * satisfy the browser's user-gesture requirement.  Must be called synchronously
 * inside a click/touchend handler so that subsequent async audio.play() calls
 * are allowed on iOS Safari / Android Chrome.
 */
export async function primeAudioContext(ctx, browser = globalThis) {
  const AC = browser.AudioContext || browser.webkitAudioContext;
  if (!AC) return;
  try {
    const context = ctx || new AC();
    if (context.state === 'suspended') await context.resume();
    const buf = context.createBuffer(1, 1, context.sampleRate);
    const src = context.createBufferSource();
    src.buffer = buf;
    src.connect(context.destination);
    src.start(0);
    if (!ctx) await context.close();
  } catch { /* Best-effort; playback will fall back gracefully. */ }
}

/**
 * Play TTS audio, preferring the AudioContext path (mobile-safe) when an
 * already-unlocked context is supplied.
 *
 * @param {Blob|null}         blob             - MP3 from YarnGPT readback endpoint.
 * @param {string}            text             - Fallback text for SpeechSynthesis.
 * @param {AudioContext|null} unlockedContext  - Already-resumed AudioContext from
 *   the mic-tap gesture (avoids iOS/Android autoplay block). Pass null to fall
 *   back to the <Audio> element.
 * @param {object}            browser          - DI shim (for testing).
 */
export async function playReadback(blob, text, unlockedContext = null, browser = globalThis) {
  stopReadback(); const epoch = playbackEpoch;
  const started = performance.now();
  if (blob?.size) {
    // Preferred: decode through the already-unlocked AudioContext — works on mobile.
    if (unlockedContext && unlockedContext.state !== 'closed') {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        if (epoch !== playbackEpoch) return () => {};
        const audioBuffer = await unlockedContext.decodeAudioData(arrayBuffer);
        if (epoch !== playbackEpoch) return () => {};
        const src = unlockedContext.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(unlockedContext.destination);
        src.start(0);
        observeVoice('speech_response_start', performance.now() - started);
        stopOutput = () => { try { src.stop(); } catch { /* already ended */ } };
        return stopOutput;
      } catch { /* Fall through to <Audio> element. */ }
    }
    // Fallback: <Audio> element (fine on desktop, may be blocked on mobile).
    const url = browser.URL.createObjectURL(blob);
    try {
      const audio = new browser.Audio(url);
      const cleanup = () => browser.URL.revokeObjectURL(url);
      audio.onended = cleanup; audio.onerror = cleanup;
      await audio.play();
      if (epoch !== playbackEpoch) { audio.pause(); cleanup(); return () => {}; }
      observeVoice('speech_response_start', performance.now() - started);
      stopOutput = () => { audio.pause(); cleanup(); }; return stopOutput;
    } catch { browser.URL.revokeObjectURL(url); }
  }
  if (browser.speechSynthesis && browser.SpeechSynthesisUtterance) {
    try {
      const utterance = new browser.SpeechSynthesisUtterance(text);
      utterance.onstart = () => observeVoice('speech_response_start', performance.now() - started);
      browser.speechSynthesis.speak(utterance);
      stopOutput = () => browser.speechSynthesis.cancel(); return stopOutput;
    } catch { /* Text card remains the final fallback. */ }
  }
  return () => {};
}
