import React from 'react';
import { Crown, Check, MessageCircle, FileText, Users, BellRing, Sparkles } from 'lucide-react';
import { useStore, Top } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { updateProfile, toast } from '../lib/store.js';

const FEATURES = [
  [MessageCircle, 'Instant WhatsApp replies', 'Every entry confirmed on WhatsApp straight away, not in batches.'],
  [FileText, 'Monthly statement for Wema', 'A signed sales statement you can send with any loan or account request.'],
  [Users, 'Up to 5 shop assistants', 'Everyone sells with their own PIN.'],
  [BellRing, 'Smart restock alerts', 'Know what will finish before the weekend rush.'],
  [Sparkles, 'Business advice in your language', 'Weekly tips on prices, slow items and best days.'],
];

export default function Premium() {
  const p = useStore(s => s.profile);
  const { back } = useNav();
  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Vendora Premium" sub="For shops that are growing" onBack={back} tall />
      <div className="wrap over">
        <div className="card center" style={{ background: 'linear-gradient(160deg, #0a1a47, #1f3b9a)', color: '#fff' }}>
          <Crown size={40} style={{ color: 'var(--kola-2)' }} />
          <div className="money" style={{ marginTop: 8 }}>₦1,500<span style={{ fontSize: 16, fontWeight: 600, color: '#b9c8f5' }}> / month</span></div>
          <div style={{ color: '#b9c8f5', marginTop: 6, fontSize: 14 }}>Paid from your Wema account. Cancel any time.</div>
        </div>
        <div className="list" style={{ marginTop: 14 }}>
          {FEATURES.map(([Icon, t, d]) => (
            <div key={t} className="item" style={{ alignItems: 'flex-start' }}>
              <span className="avatar-sm ic kola"><Icon size={19} /></span>
              <span className="grow"><div className="t">{t}</div><div className="s" style={{ lineHeight: 1.4 }}>{d}</div></span>
              {p.premium && <Check size={20} className="leaf" />}
            </div>
          ))}
        </div>
        {p.premium ? (
          <button className="btn plain full" style={{ marginTop: 16 }} onClick={() => { updateProfile({ premium: false }); toast('Premium cancelled.'); }}>Cancel Premium</button>
        ) : (
          <button className="btn kola full" style={{ marginTop: 16, minHeight: 58, fontSize: 17 }} onClick={() => { updateProfile({ premium: true }); toast('Premium is on. First month free.', 'good'); }}>Start free month</button>
        )}
        <div className="small center" style={{ marginTop: 10 }}>Everything else in Vendora stays free.</div>
      </div>
    </div>
  );
}
