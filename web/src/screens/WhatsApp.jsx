import React, { useEffect, useRef, useState } from 'react';
import { SendHorizontal, CheckCheck, MessageCircle } from 'lucide-react';
import { useStore, Top, Toggle } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { whatsappSimSend, updateProfile, toast } from '../lib/store.js';
import { clock } from '../lib/format.js';

const TRY = ['sold 3 indomie', 'Chidi paid 2000', 'how much I sell today', 'wetin dey finish'];

/** Vendora's WhatsApp line: traders message it like a friend; entries flow into the app. */
export default function WhatsApp() {
  const s = useStore();
  const { back } = useNav();
  const [text, setText] = useState('');
  const end = useRef(null);
  const msgs = s.waSim.filter(m => !m.hidden);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const send = async t => { const v = (t ?? text).trim(); if (!v) return;
    try { await whatsappSimSend(v); setText(''); } catch (error) { toast(error.message, 'bad'); } };

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Vendora on WhatsApp" sub="Record sales by sending a message" onBack={back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="row">
            <span className="avatar-sm" style={{ background: '#939393', color: '#222222' }}><MessageCircle size={20} /></span>
            <span className="grow"><b>Link your WhatsApp</b><div className="small">{s.profile.phone ? `Messages from ${s.profile.phone} go into your shop` : 'Add your phone number in Profile'}</div></span>
            <Toggle on={s.profile.whatsappLinked} onChange={v => { updateProfile({ whatsappLinked: v }); toast(v ? 'WhatsApp linked.' : 'WhatsApp unlinked.'); }} label="Link WhatsApp" />
          </div>
          {!s.profile.premium && <div className="hint" style={{ marginTop: 10 }}>Free plan: Vendora confirms entries in groups of 5. Premium confirms each one instantly.</div>}
        </div>

        <div className="h2">Try it here</div>
        <div className="wa-chat">
          <div className="wa-top"><span className="avatar-sm" style={{ background: '#fff', color: '#434343', width: 36, height: 36 }}>V</span><span className="grow"><b>Vendora</b><div style={{ fontSize: 12, opacity: .8 }}>Business account</div></span></div>
          <div className="wa-msgs">
            {msgs.length === 0 && <div className="wa-b them">Hi! Tell me what you sold, bought or who paid you. Example: "sold 2 rice to Emeka"</div>}
            {msgs.map((m, i) => (
              <div key={i} className={'wa-b ' + (m.fromUser ? 'me' : 'them')}>
                {m.text}
                <div style={{ fontSize: 11, color: '#737373', textAlign: 'right', marginTop: 2 }}>{clock(m.at)}{m.fromUser && <CheckCheck size={13} style={{ verticalAlign: -2, marginLeft: 3, color: '#a3a3a3' }} />}</div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="row" style={{ padding: 8, gap: 8 }} onSubmit={e => { e.preventDefault(); send(); }}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Message" aria-label="WhatsApp message" style={{ flex: 1, minWidth: 0, minHeight: 46, borderRadius: 23, border: 0, padding: '0 16px', fontSize: 15.5 }} />
            <button type="submit" className="send" style={{ background: '#727272', width: 46, height: 46 }} disabled={!text.trim()} aria-label="Send"><SendHorizontal size={19} /></button>
          </form>
        </div>
        <div className="chips" style={{ marginTop: 12 }}>{TRY.map(t => <button key={t} className="chip" onClick={() => send(t)}>{t}</button>)}</div>
      </div>
    </div>
  );
}
