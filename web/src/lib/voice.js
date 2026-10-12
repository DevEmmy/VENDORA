// Voice in and out.
// IN: Web Speech API (Chrome on Android/desktop, Edge, Safari 14.1+). We ask for the microphone first with
//     getUserMedia so the browser shows its permission prompt at the right moment, then start recognition.
// OUT: speechSynthesis. Phones only allow sound after a tap, so primeSpeech() is called on the first tap.
import { LANGUAGES } from './i18n.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/** 'ok' | 'unsupported' | 'insecure' */
export function voiceSupport() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!SR) return 'unsupported';
  return 'ok';
}

export const VOICE_HELP = {
  unsupported: 'Voice needs Google Chrome. Open Vendora in Chrome to talk, or type below.',
  insecure: 'Voice only works when Vendora is opened from its web link (https). Type below for now.',
  denied: 'Microphone is blocked. Tap the lock icon next to the web address, allow Microphone, then try again.',
  nomic: 'No microphone found on this device.',
  network: 'Voice needs internet on this phone. Type below, it works offline.',
  nospeech: "I didn't hear anything. Tap the mic and speak close to the phone.",
  failed: 'Voice stopped unexpectedly. Tap the mic to try again, or type below.',
};

async function askMic() {
  if (!navigator.mediaDevices?.getUserMedia) return 'ok'; // older browsers: recognition will ask itself
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    return 'ok';
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'denied';
    if (e && e.name === 'NotFoundError') return 'nomic';
    return 'ok';
  }
}

/**
 * Start listening. Callbacks: onState('starting'|'listening'|'idle'), onPartial(text), onFinal(text), onError(code).
 * Returns { stop() }.
 */
export function listen(lang, { onState, onPartial, onFinal, onError }) {
  const support = voiceSupport();
  let stopped = false, rec = null, finalText = '';
  const ctl = { stop() { stopped = true; try { rec && rec.stop(); } catch { /* ignore */ } } };
  if (support !== 'ok') { onError?.(support); return ctl; }
  onState?.('starting');
  const code = (LANGUAGES.find(l => l.code === lang) || LANGUAGES[0]).speech;
  (async () => {
    const mic = await askMic();
    if (mic !== 'ok') { onError?.(mic); onState?.('idle'); return; }
    if (stopped) { onState?.('idle'); return; }
    let triedFallback = false;
    const start = langCode => {
      const r = new SR();
      rec = r;
      rec.lang = langCode; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onstart = () => onState?.('listening');
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t.trim(); else interim += t;
        }
        onPartial?.((finalText + ' ' + interim).trim());
      };
      rec.onerror = e => {
        if (e.error === 'language-not-supported' && !triedFallback) { triedFallback = true; finalText = ''; start('en-NG'); return; }
        if (e.error === 'aborted') return;
        onError?.({ 'not-allowed': 'denied', 'service-not-allowed': 'denied', 'audio-capture': 'nomic', network: 'network', 'no-speech': 'nospeech' }[e.error] || 'failed');
      };
      rec.onend = () => {
        if (r !== rec) return; // replaced by the English fallback recognizer
        onState?.('idle');
        if (finalText) onFinal?.(finalText.trim());
      };
      try { rec.start(); } catch { onError?.('failed'); onState?.('idle'); }
    };
    start(code);
  })();
  return ctl;
}

// ---------- speaking ----------
let voices = [];
function loadVoices() { try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; } }
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
let primed = false;
/** Call inside a tap handler once: unlocks audio on phones. */
export function primeSpeech() {
  if (primed || typeof window === 'undefined' || !window.speechSynthesis) return;
  primed = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* ignore */ }
}
export const canSpeak = () => typeof window !== 'undefined' && !!window.speechSynthesis;

function pickVoice(lang) {
  if (!voices.length) loadVoices();
  const want = (LANGUAGES.find(l => l.code === lang) || LANGUAGES[0]).tts;
  const by = p => voices.find(p);
  return by(v => v.lang === want) || by(v => v.lang?.replace('_', '-') === want) || by(v => v.lang === 'en-NG') ||
    by(v => /en[-_]GB/.test(v.lang)) || by(v => /en[-_]US/.test(v.lang)) || by(v => v.lang?.startsWith('en')) || voices[0] || null;
}

export function speak(text, lang = 'en') {
  if (!canSpeak() || !text) return;
  try {
    const clean = text.replace(/₦\s?([\d,]+)/g, (_, n) => `${n} naira`).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ');
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(lang);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1; u.pitch = 1; u.volume = 1;
    // Chrome sometimes needs a tick after cancel()
    setTimeout(() => window.speechSynthesis.speak(u), 60);
  } catch { /* speech not available */ }
}

export function haptic(ms = 12) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }
