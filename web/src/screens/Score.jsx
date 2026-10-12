import React from 'react';
import { TrendingUp, ShieldCheck, Landmark, CircleAlert, ChevronRight } from 'lucide-react';
import { useStore, Top } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { businessScoreNow, integrity } from '../lib/store.js';
import { naira } from '../lib/format.js';

const TIPS = {
  consistency: 'Record sales every day the shop is open, even small ones.',
  volume: 'Record every sale, so Wema sees your real size.',
  verified: 'Collect transfers with Vendora, or check receipts. Confirmed money counts most.',
  stability: 'Steady sales across the week raise this.',
  collection: 'Remind customers who owe you. Collected debts count.',
  repayment: 'Repay loans on time. Turn on automatic daily repayment.',
};

export default function Score() {
  const s = useStore();
  const { back, go } = useNav();
  const sc = businessScoreNow();
  const integ = integrity(s);
  const color = sc.score >= 80 ? 'var(--leaf)' : sc.score >= 60 ? 'var(--royal)' : sc.score >= 40 ? 'var(--kola)' : 'var(--pepper)';
  const weakest = [...sc.factors].sort((a, b) => a.points / a.max - b.points / b.max)[0];
  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Business Score" sub="What Wema sees when you ask for a loan" onBack={back} tall />
      <div className="wrap over">
        <div className="card center">
          <div className="ring" style={{ background: `conic-gradient(${color} ${sc.score * 3.6}deg, #e9edf5 0)` }}>
            <div className="in"><div><div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1 }}>{sc.score}</div><div className="small">out of 100</div></div></div>
          </div>
          <b style={{ fontSize: 19 }}>{sc.band}</b>
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{sc.activeDays} days with sales in the last 30, about {naira(sc.avgDailySales)} a day</div>
        </div>
        {!integ.ok && <button className="banner pepper" style={{ marginTop: 12 }} onClick={() => go('records')}><CircleAlert size={22} /><span className="grow"><b>Score capped at 25</b><br />Some records changed after they were saved. Tap to see.</span><ChevronRight size={18} /></button>}
        {integ.ok && weakest && weakest.points < weakest.max && (
          <div className="banner kola" style={{ marginTop: 12 }}><TrendingUp size={22} /><span className="grow"><b>Quickest way up</b><br />{TIPS[weakest.key]}</span></div>
        )}
        <div className="h2">What makes your score</div>
        <div className="card gap">
          {sc.factors.map(f => (
            <div key={f.key}>
              <div className="row between" style={{ fontSize: 14.5 }}><span style={{ fontWeight: 600 }}>{f.label}</span><b>{f.points}/{f.max}</b></div>
              <div className={'meter' + (f.points / f.max >= .7 ? ' leaf' : '')} style={{ marginTop: 6 }}><div style={{ width: `${Math.round(f.points / f.max * 100)}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="h2">Why Wema can trust it</div>
        <div className="card gap" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={20} className="leaf" style={{ flex: 'none' }} /><span className="muted">{Math.round(integ.trust.verifiedShare * 100)}% of your sales in the last 30 days were confirmed by Wema, a checked receipt or a verified seller.</span></div>
          <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={20} className="leaf" style={{ flex: 'none' }} /><span className="muted">Records are sealed on this phone the moment they are made. Editing old records breaks the seal and Wema sees it.</span></div>
        </div>
        <button className="btn plain full" style={{ marginTop: 12 }} onClick={() => go('records')}>See my secured records</button>
        <button className="btn kola full" style={{ marginTop: 10 }} onClick={() => go('wallet', { seg: 'loans' })}><Landmark size={20} />See my Wema loan offer</button>
      </div>
    </div>
  );
}
