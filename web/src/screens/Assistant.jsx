import React, { useEffect, useRef, useState } from 'react';
import { Mic, SendHorizontal, Square, Languages, Undo2, Plus, Volume2, VolumeX, CircleAlert } from 'lucide-react';
import { useStore, Top, Sheet } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { sendChat, reverseTxn, updateProfile, getState, recordPerm, permOf } from '../lib/store.js';
import { listen, voiceSupport, VOICE_HELP, speak, haptic, primeSpeech } from '../lib/voice.js';
import { LANGUAGES, langLabel } from '../lib/i18n.js';
import { clock } from '../lib/format.js';
import { permissionState, requestMic } from '../lib/device.js';
import { useAuthStore } from '../features/auth/authStore.js';
import VoiceWorkspace from '../features/voice/VoiceWorkspace.jsx';

const SUGGEST = {
  en: ['I sold 2 bags of rice', 'Emeka paid 5000', 'How much did I sell today?', 'Which items are running low?', 'Who is owing me?', 'I bought 10 cartons of Indomie'],
  pcm: ['I sell 2 bag rice', 'Emeka pay 5000', 'How much I sell today?', 'Wetin dey finish?', 'Who dey owe me?'],
  yo: ['Mo ta iresi meji', 'Elo ni mo ta loni?', 'Tani je mi lowo?'],
  ig: ['Erere m osikapa abuo', 'Ego ole ka m retara taa?'],
  ha: ['Na sayar da shinkafa biyu', 'Nawa na sayar yau?'],
};

export default function Assistant(props) {
  const status = useAuthStore(state => state.status);
  const businessId = useAuthStore(state => state.selectedBusinessId);
  const userId = useAuthStore(state => state.user?.id);
  return status === 'authenticated' ? <VoiceWorkspace key={`${userId}:${businessId}`} businessId={businessId} /> : <LegacyAssistant {...props} />;
}

function LegacyAssistant({ autoListen }) {
  const s = useStore();
  const { back, go } = useNav();
  const lang = s.profile.language;
  const [text, setText] = useState('');
  const [state, setVState] = useState('idle'); // idle | starting | listening
  const [partial, setPartial] = useState('');
  const [help, setHelp] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  const ctl = useRef(null);
  const end = useRef(null);
  const input = useRef(null);
  const support = voiceSupport();
  // What the phone already allowed is remembered, so Vendora never asks twice.
  const [mic, setMic] = useState(permOf('mic') || 'unknown');
  async function allowMic() {
    primeSpeech();
    const r = await requestMic();
    setMic(r);
    recordPerm('mic', r === 'granted' ? 'granted' : 'denied');
    if (r === 'granted') { setHelp(''); start(); } else setHelp(VOICE_HELP[r] || VOICE_HELP.failed);
  }
  const live = state !== 'idle';

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [s.chat.length, partial]);
  useEffect(() => {
    let on = true;
    (async () => {
      let known = permOf('mic');
      const api = await permissionState('microphone');
      if (api === 'granted') { known = 'granted'; recordPerm('mic', 'granted'); }
      if (api === 'denied') { known = 'denied'; recordPerm('mic', 'denied'); }
      if (!on) return;
      setMic(known || 'unknown');
      // Only start listening by itself when the microphone is already allowed: no surprise permission pop-ups.
      if (autoListen && support === 'ok' && known === 'granted') start();
      else if (autoListen && support !== 'ok') setHelp(VOICE_HELP[support]);
    })();
    return () => { on = false; ctl.current?.stop(); };
  }, []); // Run the initial listening request once.

  async function submit(t, viaVoice = false) {
    const msg = (t ?? text).trim();
    if (!msg) return;
    primeSpeech();
    haptic(10);
    try {
    const { reply } = await sendChat(msg, viaVoice);
    setText(''); setPartial('');
    const pr = getState().profile;
    if (pr.speakReplies) speak(reply, pr.language);
    } catch (error) { setHelp(error.message); }
  }

  function start() {
    setHelp(''); setPartial('');
    primeSpeech();
    if (support !== 'ok') { setHelp(VOICE_HELP[support]); input.current?.focus(); return; }
    haptic(15);
    ctl.current = listen(getState().profile.language, {
      onState: st => { setVState(st); if (st === 'listening') { recordPerm('mic', 'granted'); setMic('granted'); } },
      onPartial: p => setPartial(p),
      onFinal: f => submit(f, true),
      onError: code => { if (code === 'denied') { setMic('denied'); recordPerm('mic', 'denied'); } setVState('idle'); setPartial(''); setHelp(VOICE_HELP[code] || VOICE_HELP.failed); },
    }, { micKnown: permOf('mic') === 'granted' });
  }
  function stop() { ctl.current?.stop(); }

  const chips = SUGGEST[lang] || SUGGEST.en;
  return (
    <div className="chat">
      <Top title="Talk to Vendora" sub={live ? 'Listening… speak now' : `Speaking ${langLabel(lang)}`} onBack={back} round={false}
        right={<>
          <button className="icon-btn" onClick={() => updateProfile({ speakReplies: !s.profile.speakReplies })} aria-label={s.profile.speakReplies ? 'Turn off spoken replies' : 'Turn on spoken replies'}>{s.profile.speakReplies ? <Volume2 size={21} /> : <VolumeX size={21} />}</button>
          <button className="icon-btn" onClick={() => setLangOpen(true)} aria-label="Change language"><Languages size={21} /></button>
        </>} />

      <div className="msgs" aria-live="polite">
        {s.chat.length === 0 && (
          <div className="card" style={{ marginTop: 6 }}>
            <b style={{ fontSize: 17 }}>Say it the way you'd tell a friend.</b>
            <div className="muted" style={{ fontSize: 14.5, marginTop: 6, lineHeight: 1.45 }}>Vendora records sales, stock and debts, and answers questions about your shop. Tap a line to try it.</div>
            <div className="chips" style={{ marginTop: 12 }}>{chips.map(c => <button key={c} className="chip" onClick={() => submit(c)}>{c}</button>)}</div>
          </div>
        )}
        {s.chat.map(m => {
          const reversed = m.txnIds?.length && m.txnIds.every(id => s.txns.find(t => t.id === id)?.reversed);
          const recorded = m.txnIds?.length > 0;
          return (
            <div key={m.id} className={'bubble ' + (m.fromUser ? 'me' : 'bot' + (recorded ? ' done' : m.kind === 'unknown' || m.needsProduct ? ' warn' : ''))}>
              {m.fromUser && m.voice && <Mic size={13} style={{ verticalAlign: -1, marginRight: 4, opacity: .8 }} />}
              {m.text}
              {!m.fromUser && recorded && (
                <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
                  {reversed ? <span className="small">Undone, kept in records</span>
                    : <button className="link" style={{ padding: 0, fontSize: 13.5 }} onClick={async () => { try {
                      for (const id of m.txnIds) await reverseTxn(id, 'Undone in chat');
                    } catch (error) { setHelp(error.message); } }}><Undo2 size={14} style={{ verticalAlign: -2 }} /> Undo</button>}
                  <span className="small" style={{ marginLeft: 'auto' }}>{clock(m.at)}</span>
                </div>
              )}
              {!m.fromUser && m.needsProduct && (
                <button className="btn soft sm" style={{ marginTop: 10 }} onClick={() => go('stock', { add: true })}><Plus size={16} />Add "{m.needsProduct.name}" to my items</button>
              )}
            </div>
          );
        })}
        {live && partial && <div className="bubble me" style={{ opacity: .7 }}>{partial}…</div>}
        <div ref={end} />
      </div>

      <div className="dock">
        {!live && support === 'ok' && mic !== 'granted' && !help && (
          <div className="banner royal" style={{ marginBottom: 10 }}>
            <Mic size={20} /><span className="grow"><b>Allow the microphone</b> so you can talk to Vendora.</span>
            <button className="btn primary sm" onClick={allowMic}>Allow</button>
          </div>
        )}
        {help && (
          <div className="banner amber" style={{ marginBottom: 10 }} role="alert">
            <CircleAlert size={20} /><span className="grow">{help}</span>
            {help === VOICE_HELP.denied ? <button className="btn primary sm" onClick={allowMic}>Try again</button> : <button className="link" style={{ padding: 0 }} onClick={() => setHelp('')}>OK</button>}
          </div>
        )}
        {live ? (
          <div className="center" style={{ padding: '4px 0 6px' }}>
            <div className="wave" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ height: 10 + ((i * 7) % 26), animationDelay: `${(i % 5) * 0.1}s` }} />)}</div>
            <div className="muted" style={{ fontSize: 14, margin: '6px 0 12px', minHeight: 20 }}>{state === 'starting' ? 'Getting the microphone ready…' : partial || 'Listening…'}</div>
            <button className="mic-big live" onClick={stop} aria-label="Stop listening" style={{ margin: '0 auto' }}><Square size={26} fill="currentColor" /></button>
            <div className="small" style={{ marginTop: 8 }}>Tap to finish</div>
          </div>
        ) : <>
          {s.chat.length > 0 && <div className="chips scroll" style={{ marginBottom: 10 }}>{chips.slice(0, 5).map(c => <button key={c} className="chip" onClick={() => submit(c)}>{c}</button>)}</div>}
          <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }}>
            <button type="button" className="send" style={{ background: 'var(--kola)', color: 'var(--ink)' }} onClick={start} aria-label="Speak"><Mic size={22} /></button>
            <input ref={input} value={text} onChange={e => setText(e.target.value)} placeholder="Type or tap the mic" aria-label="Message" enterKeyHint="send" autoComplete="off" />
            <button type="submit" className="send" disabled={!text.trim()} aria-label="Send"><SendHorizontal size={21} /></button>
          </form>
        </>}
      </div>

      {langOpen && (
        <Sheet title="Language" sub="Vendora listens and replies in this language" onClose={() => setLangOpen(false)}>
          <div className="list">{LANGUAGES.map(l => (
            <button key={l.code} className="item" onClick={() => { updateProfile({ language: l.code }); setLangOpen(false); }} aria-pressed={lang === l.code}>
              <span className="grow t">{l.label}</span>{lang === l.code && <span className="pill royal">Selected</span>}
            </button>
          ))}</div>
        </Sheet>
      )}
    </div>
  );
}
