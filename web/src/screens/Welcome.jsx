import React from 'react';
import { Mic, ShieldCheck, Landmark } from 'lucide-react';
import { useStore } from '../components/ui.jsx';
import { LANGUAGES } from '../lib/i18n.js';
import { updateProfile, loadDemo } from '../lib/store.js';

export default function Welcome({ next }) {
  const lang = useStore(s => s.profile.language);
  return (
    <div className="page">
      <div className="welcome">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 40 }}>
          <div className="mic-big" style={{ width: 84, height: 84 }} aria-hidden="true"><Mic size={36} /></div>
          <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1.5, margin: '26px 0 6px' }}>Vendora</h1>
          <p style={{ fontSize: 21, lineHeight: 1.35, margin: 0, color: '#dfe7ff', fontWeight: 600, maxWidth: 320 }}>Talk to your shop. It keeps the records, checks every transfer and gets you restock money.</p>
          <div className="gap" style={{ marginTop: 26, color: '#b9c8f5', fontSize: 14.5 }}>
            <div className="row"><Mic size={18} style={{ color: 'var(--kola)' }} />Record sales by voice, tap or WhatsApp</div>
            <div className="row"><ShieldCheck size={18} style={{ color: 'var(--kola)' }} />No more fake transfer alerts</div>
            <div className="row"><Landmark size={18} style={{ color: 'var(--kola)' }} />Restock loans from Wema, paid to your seller</div>
          </div>
          <div style={{ marginTop: 30, fontWeight: 700, fontSize: 14, color: '#dfe7ff' }}>Choose your language</div>
          <div className="chips" style={{ marginTop: 10 }}>
            {LANGUAGES.map(l => <button key={l.code} className="lang" aria-pressed={lang === l.code} onClick={() => updateProfile({ language: l.code })}>{l.label}</button>)}
          </div>
        </div>
        <div style={{ padding: '26px 0 calc(26px + env(safe-area-inset-bottom))' }}>
          <button className="btn kola full" style={{ minHeight: 58, fontSize: 17 }} onClick={next}>Set up my shop</button>
          <button className="btn full" style={{ marginTop: 10, background: 'rgba(255,255,255,.1)', color: '#fff' }} onClick={loadDemo}>Explore a sample shop</button>
        </div>
      </div>
    </div>
  );
}
