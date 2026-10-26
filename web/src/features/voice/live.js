import { observeVoice } from './metrics.js';

export async function readEvents(stream, onEvent, signal) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Speech connection closed. Reconnect and repeat the current utterance.');
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 131072) throw new Error('Invalid speech event');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)));
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function startLive({ request, pendingActionId, onLevel, onEvent, onError, signal }) {
  const ctl = new AbortController();
  let media, context, source, node, timer, sequence = 0, closed = false, queued = 0;
  let chain = Promise.resolve(), finishRequested = false;
  let captureStarted, firstTranscript = true;
  const close = () => {
    closed = true; clearTimeout(timer); ctl.abort();
    onLevel?.(0);
    signal?.removeEventListener('abort', close);
    node?.disconnect(); source?.disconnect(); media?.getTracks().forEach(track => track.stop());
    if (context) void context.close().catch(() => {});
  };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) close();
  try {
    // Ask for permission before opening a paid provider connection.
    media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (closed) { media.getTracks().forEach(track => track.stop()); throw new DOMException('Cancelled', 'AbortError'); }
    context = new AudioContext(); await context.resume();
    await context.audioWorklet.addModule('/voice-pcm-worklet.js');
    const { stream_id: id } = await request('/api/voice/streams', { method: 'POST', body: { pending_action_id: pendingActionId || null }, signal: ctl.signal });
    const path = `/api/voice/streams/${id}`;
    const events = await request(`${path}/events`, { responseType: 'stream', signal: ctl.signal });
    const finalize = () => {
      node?.disconnect();
      void chain.then(() => request(`${path}/finalize`, { method: 'POST', body: {}, signal: ctl.signal })).catch(error => { if (!closed && error?.status !== 409) { close(); onError(error); } });
    };
    const finish = () => {
      if (finishRequested || closed) return;
      finishRequested = true;
      try { source?.disconnect(); } catch {}
      media.getTracks().forEach(track => track.stop());
      // Drain already-captured chunks before finalizing; no audio replay on reconnect.
      if (node) node.port.postMessage('flush'); else finalize();
    };
    timer = setTimeout(() => { close(); onError(new Error('Speech connection timed out. Reconnect and repeat.')); }, 130000);
    void readEvents(events, event => {
      if (closed) return;
      if ((event.type === 'partial' || event.type === 'final') && firstTranscript && captureStarted !== undefined) {
        observeVoice('audio_capture_to_transcription', performance.now() - captureStarted); firstTranscript = false;
      }
      if (event.type === 'started') {
        clearTimeout(timer);
        if (!finishRequested) {
          source = context.createMediaStreamSource(media);
          captureStarted = performance.now();
          node = new AudioWorkletNode(context, 'voice-pcm');
          node.port.onmessage = ({ data }) => {
            if (closed) return;
            if (data.flushed) { finalize(); return; }
            if (finishRequested) return;
            if (++queued > 32) { close(); onError(new Error('Audio connection is too slow. Reconnect and repeat the current utterance.')); return; }
            if (onLevel && data.byteLength) {
              const samples = new Int16Array(data);
              let sum = 0, count = 0;
              for (let i = 0; i < samples.length; i += 8) {
                sum += Math.abs(samples[i]);
                count++;
              }
              onLevel(Math.min(1, (sum / (count || 1)) / 4500));
            }
            const bytes = new Uint8Array(data);
            const pcm = btoa(String.fromCharCode(...bytes));
            const chunk = { sequence: sequence++, pcm };
            chain = chain.then(() => request(`${path}/audio`, { method: 'POST', body: chunk, signal: ctl.signal }))
              .then(() => { queued--; }).catch(error => { if (!closed && error?.status !== 409) { close(); onError(error); } });
          };
          source.connect(node); node.connect(context.destination);
        }
        timer = setTimeout(finish, 240000);
      }
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') close();
    }, ctl.signal).catch(error => { if (!closed) { close(); onError(error); } });
    return { stop: finish, cancel: close, audioContext: context };
  } catch (error) { close(); throw error; }
}

