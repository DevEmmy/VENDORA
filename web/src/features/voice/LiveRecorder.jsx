import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, Radio, Sparkles } from 'lucide-react';
import { startLive } from './live.js';
import { stopReadback, primeAudioContext } from './recorder.js';

export default function LiveRecorder(props) {
  const latest = useRef(props), session = useRef(null), mounted = useRef(true), starting = useRef(false);
  const lifecycle = useRef(null);
  // Keep the AudioContext from the last startLive call so playReadback can use it on mobile.
  const audioCtx = useRef(null);
  latest.current = props;
  const [state, setState] = useState('IDLE'), [level, setLevel] = useState(0);
  const [partial, setPartial] = useState(''), [final, setFinal] = useState('');

  const start = async () => {
    if (starting.current || session.current) return;
    starting.current = true; setState('CONNECTING'); setPartial(''); setFinal('');
    try {
      const current = await startLive({
        request: latest.current.request,
        pendingActionId: latest.current.pendingActionId,
        signal: lifecycle.current?.signal,
        onLevel: lvl => { if (mounted.current) setLevel(lvl); },
        onError: error => {
          if (mounted.current) {
            session.current = null;
            setLevel(0);
            setState('ERROR');
            latest.current.onError(error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message);
          }
        },
        onEvent: event => {
          if (!mounted.current) return;
          if (event.type === 'started') setState('LISTENING');
          if (event.type === 'partial') { if (event.text?.trim()) stopReadback(); setPartial(event.text); }
          if (event.type === 'final') { setPartial(''); setFinal(event.text); }
          if (event.type === 'state') setState(event.state);
          if (event.type === 'command') {
            setState(['pending', 'needs_clarification'].includes(event.command.status) ? 'AWAITING_CONFIRMATION' : event.command.status === 'completed' ? 'COMPLETED' : 'ERROR');
            latest.current.onCommand(event.command, audioCtx.current);
          }
          if (event.type === 'receipt') { setState('COMPLETED'); latest.current.onReceipt(event.result, audioCtx.current); }
          if (event.type === 'cancelled') { setState('CANCELLED'); latest.current.onCancel(); }
          if (event.type === 'feedback') { setState('AWAITING_CONFIRMATION'); latest.current.onFeedback(event.text); }
          if (event.type === 'error') {
            setState('ERROR');
            setLevel(0);
            latest.current.onError(event.text || 'Speech connection lost. Reconnect and repeat the current utterance.');
            session.current = null;
          }
          if (event.type === 'done') { session.current = null; setLevel(0); setState('IDLE'); }
        },
      });
      if (!mounted.current) {
        current.cancel();
      } else {
        session.current = current;
        // Store the unlocked AudioContext for mobile-safe TTS playback.
        if (current.audioContext) audioCtx.current = current.audioContext;
      }
    } catch (error) {
      if (mounted.current) {
        setState('ERROR');
        setLevel(0);
        latest.current.onError(error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message);
      }
    } finally {
      starting.current = false;
    }
  };

  const handleMicClick = () => {
    if (session.current) {
      session.current.stop();
    } else {
      // Prime the AudioContext inside the gesture handler so iOS/Android allow
      // subsequent async audio.play() calls after the session is established.
      void primeAudioContext(audioCtx.current).then(() => start());
    }
  };

  useEffect(() => {
    mounted.current = true;
    lifecycle.current = new AbortController();
    return () => {
      mounted.current = false;
      lifecycle.current.abort();
      session.current?.cancel();
      session.current = null;
    };
  }, []);

  const isListening = state === 'LISTENING';
  const isConnecting = state === 'CONNECTING';
  const isProcessing = ['PROCESSING', 'AWAITING_CONFIRMATION'].includes(state);
  const isError = state === 'ERROR';

  return <section className="card voice-live-card" aria-label="Live voice inventory">
    <div className="voice-live-header">
      <h2 className="voice-live-title">Talk to your inventory</h2>
      <p className="voice-live-sub">
        {isListening ? 'Speak naturally in English, Pidgin, or Yoruba' : 'Manage sales and stock with real-time voice'}
      </p>
    </div>

    <div className="voice-mic-wrap">
      <button
        type="button"
        className={`voice-mic-btn ${isListening ? 'listening' : isConnecting ? 'connecting' : isProcessing ? 'processing' : 'idle'}`}
        disabled={starting.current || props.busy}
        onClick={handleMicClick}
        aria-label={isListening ? 'Stop listening' : isError ? 'Reconnect microphone' : 'Start live microphone'}
      >
        {isListening ? (
          <Square size={30} fill="currentColor" />
        ) : isConnecting ? (
          <Radio size={36} className="voice-spinner" />
        ) : isProcessing ? (
          <Sparkles size={34} />
        ) : isError ? (
          <RotateCcw size={36} />
        ) : (
          <Mic size={38} strokeWidth={2.3} />
        )}
      </button>

      {isListening && (
        <div className="voice-wave-bars" aria-hidden="true">
          {[0.6, 1, 0.8, 1.2, 0.7].map((factor, i) => (
            <span
              key={i}
              className="voice-wave-bar"
              style={{
                height: `${Math.max(6, Math.min(32, 8 + level * 26 * factor))}px`,
                opacity: 0.6 + level * 0.4,
              }}
            />
          ))}
        </div>
      )}

      <div className={`voice-live-status-pill ${isListening ? 'listening' : isConnecting ? 'connecting' : isProcessing ? 'processing' : 'idle'}`}>
        {isListening ? (
          <><span className="badge-live">● LIVE</span> Listening… tap to finish</>
        ) : isConnecting ? (
          <><span className="voice-spinner" /> Opening live audio…</>
        ) : isProcessing ? (
          <><span className="voice-spinner" /> Understanding your voice…</>
        ) : isError ? (
          <>Microphone disconnected · Tap to retry</>
        ) : (
          <>Tap to speak</>
        )}
      </div>
    </div>

    {partial && (
      <div className="voice-transcript-bubble" aria-label="Live provisional transcript">
        <span className="badge-live">HEARING</span>
        <span>"{partial}"</span>
      </div>
    )}

    {final && !partial && (
      <div className="voice-transcript-bubble" aria-label="Final transcript">
        <strong>Spoken:</strong> "{final}"
      </div>
    )}

    {state === 'IDLE' && !final && (
      <div className="voice-suggestions">
        <div className="voice-suggestions-title">Try saying</div>
        <div className="voice-suggestion-chips">
          <button type="button" className="voice-suggestion-chip" onClick={() => { void primeAudioContext(audioCtx.current).then(() => start()); }}>"I sold 2 bags of brown beans"</button>
          <button type="button" className="voice-suggestion-chip" onClick={() => { void primeAudioContext(audioCtx.current).then(() => start()); }}>"Add 5 cartons of Indomie"</button>
          <button type="button" className="voice-suggestion-chip" onClick={() => { void primeAudioContext(audioCtx.current).then(() => start()); }}>"Remove 3 crates of eggs"</button>
          <button type="button" className="voice-suggestion-chip" onClick={() => { void primeAudioContext(audioCtx.current).then(() => start()); }}>"How many Peak milk remain?"</button>
        </div>
      </div>
    )}
  </section>;
}
