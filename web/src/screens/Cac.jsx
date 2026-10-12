import React, { useEffect, useState } from 'react';
import { BadgeCheck, ShieldCheck, Landmark, Store, Building2, HandCoins, PiggyBank, FileCheck2, CheckCircle2, Circle, ChevronDown, ChevronUp, Hourglass } from 'lucide-react';
import { useStore, Top, Field } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { startCacPlan, cacTopUp, stopCacPlan, resumeCacPlan, submitCac, refreshCac, CAC_TARGET, toast, setState } from '../lib/store.js';
import { naira } from '../lib/format.js';
import { fmtCoord } from '../lib/device.js';

const WHY = [
  [ShieldCheck, 'Your shop name becomes yours by law', 'Nobody else can register or use it.'],
  [BadgeCheck, 'Buyers and big suppliers trust you', 'You get the CAC badge on the Vendors Hub, your adverts and invoices.'],
  [Landmark, 'Bigger Wema loans', 'Banks lend more, and for longer, to registered businesses.'],
  [Building2, 'Sell to companies and supermarkets', 'They, and the government, only buy from registered businesses.'],
  [HandCoins, 'Grants and support programmes', 'Most of them ask for a CAC number before they help.'],
];
const HOW = [
  'Pick a small amount you can keep aside each day.',
  'Wema puts it aside from your Wema account every day, like ajo. You can add more any time.',
  'When the money is complete, you fill one short form here.',
  'Wema files the registration with CAC for you. No office, no agent, no going up and down.',
];
const DAILY = [200, 500, 1000, 2000];

function Why({ open: initial = true }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <button className="row between" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <b style={{ fontSize: 16 }}>Why register your business?</b>{open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {open && <div className="gap" style={{ marginTop: 14 }}>{WHY.map(([Icon, t, d]) => (
        <div key={t} className="row" style={{ alignItems: 'flex-start' }}>
          <span className="avatar-sm ic leaf" style={{ width: 38, height: 38 }}><Icon size={18} /></span>
          <span className="grow"><b style={{ fontSize: 14.5 }}>{t}</b><div className="small" style={{ lineHeight: 1.4, marginTop: 2 }}>{d}</div></span>
        </div>
      ))}</div>}
    </div>
  );
}

function Steps({ status }) {
  const done = { saving: 0, paused: 0, ready: 1, submitted: 2, approved: 3, registered: 4 }[status] ?? 0;
  const steps = ['Money saved', 'Details sent to CAC', 'Business name approved', 'Registered'];
  return (
    <div className="list" style={{ marginTop: 12 }}>{steps.map((l, i) => (
      <div key={l} className="item">
        {i < done ? <CheckCircle2 size={22} className="leaf" /> : i === done ? <Hourglass size={22} className="amber" /> : <Circle size={22} className="muted" />}
        <span className="grow t" style={{ fontWeight: 600 }}>{l}</span>
      </div>
    ))}</div>
  );
}

export default function Cac() {
  const s = useStore();
  const { back, go } = useNav();
  const c = s.cac;
  const p = s.profile;
  const [daily, setDaily] = useState(c.plan?.daily || 500);
  const [have, setHave] = useState(false);
  const [num, setNum] = useState('');
  const [top, setTop] = useState('');
  const [form, setForm] = useState({ names: [p.businessName || '', ''], type: p.businessType || 'General merchandise / provisions', address: p.city || '', consent: false });
  useEffect(() => { refreshCac(); const t = setInterval(() => refreshCac(), 3000); return () => clearInterval(t); }, []);

  const plan = c.plan;
  const left = plan ? plan.target - plan.saved : CAC_TARGET;
  const days = Math.ceil(left / (plan?.daily || daily));

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="CAC registration" sub="Register your business through Wema, from your phone" onBack={back} tall />
      <div className="wrap over">
        {(c.status === 'none') && <>
          <div className="card" style={{ background: 'linear-gradient(160deg, #0a1a47, #1f3b9a)', color: '#fff' }}>
            <b style={{ fontSize: 18, lineHeight: 1.3, display: 'block' }}>Save small every day. Wema registers your business for you.</b>
            <div style={{ color: '#b9c8f5', fontSize: 14, marginTop: 8, lineHeight: 1.45 }}>Every seller on the Vendors Hub must be registered with CAC (Corporate Affairs Commission). It protects you and the people who buy from you.</div>
          </div>
          <Why />
          <div className="h2">How it works</div>
          <div className="card gap" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
            {HOW.map((t, i) => <div key={i} className="row" style={{ alignItems: 'flex-start' }}><span className="pill royal" style={{ minWidth: 26, justifyContent: 'center' }}>{i + 1}</span><span className="grow muted">{t}</span></div>)}
          </div>
          <div className="h2">How much a day?</div>
          <div className="card">
            <div className="chips">{DAILY.map(v => <button key={v} className="chip" aria-pressed={daily === v} onClick={() => setDaily(v)}>{naira(v)}</button>)}</div>
            <div className="row between" style={{ marginTop: 14 }}>
              <span className="muted">Ready in about</span><b style={{ fontSize: 20 }}>{Math.ceil(CAC_TARGET / daily)} days</b>
            </div>
            <div className="hint">Estimated total {naira(CAC_TARGET)}: the CAC fee and filing. Wema confirms the exact amount before filing, and anything left over goes back to your account. You can pause or take your money back any time.</div>
            <button className="btn kola full" style={{ marginTop: 14, minHeight: 56 }} disabled={!p.accountNumber} onClick={() => { startCacPlan(daily); toast(`Saving ${naira(daily)} a day for your CAC.`, 'good'); }}><PiggyBank size={20} />Start saving {naira(daily)} a day</button>
            {!p.accountNumber && <div className="hint center">Open your Wema account in Wallet first.</div>}
          </div>
          <button className="link" style={{ display: 'block', margin: '14px auto 0' }} onClick={() => setHave(!have)}>Already registered? Add your number</button>
          {have && <div className="card" style={{ marginTop: 6 }}>
            <Field label="Your CAC number" hint="Starts with BN (business name) or RC (company)"><input value={num} onChange={e => setNum(e.target.value.toUpperCase())} placeholder="e.g. BN 3456789" /></Field>
            <button className="btn primary full" style={{ marginTop: 12 }} disabled={!/^(BN|RC)\s?\d{5,8}$/.test(num.trim())} onClick={() => { setState(d => { d.cac.status = 'registered'; d.cac.number = num.trim().replace(/^(BN|RC)\s?/, '$1 '); d.cac.selfReported = true; }); toast('CAC number saved. Wema will confirm it.', 'good'); }}>Save number</button>
          </div>}
        </>}

        {(c.status === 'saving' || c.status === 'paused') && plan && <>
          <div className="card center">
            <div className="ring" style={{ background: `conic-gradient(var(--leaf) ${plan.saved / plan.target * 360}deg, #e9edf5 0)` }}>
              <div className="in"><div><div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -.5 }}>{naira(plan.saved)}</div><div className="small">of {naira(plan.target)}</div></div></div>
            </div>
            <b style={{ fontSize: 17 }}>{c.status === 'paused' ? 'Saving is paused' : `${naira(plan.daily)} a day, about ${days} day${days === 1 ? '' : 's'} to go`}</b>
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>Kept aside by Wema from your account every night.</div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <b>Finish faster</b>
            <div className="chips" style={{ marginTop: 10 }}>{[1000, 2000, 5000, left].filter((v, i, a) => v > 0 && v <= left && a.indexOf(v) === i).map(v => <button key={v} className="chip" onClick={() => cacTopUp(v)}>{v === left ? `All ${naira(v)}` : `+${naira(v)}`}</button>)}</div>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field grow"><span className="pre">₦</span><input value={top} onChange={e => setTop(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Other amount" aria-label="Other amount" /></div>
              <button className="btn soft" disabled={!(Number(top) > 0)} onClick={() => { cacTopUp(top); setTop(''); }}>Add</button>
            </div>
            <span className="label">Daily amount</span>
            <div className="chips">{DAILY.map(v => <button key={v} className="chip" aria-pressed={plan.daily === v} onClick={() => startCacPlan(v)}>{naira(v)}</button>)}</div>
            <button className="btn plain full" style={{ marginTop: 14 }} onClick={() => c.status === 'paused' ? resumeCacPlan() : stopCacPlan()}>{c.status === 'paused' ? 'Resume saving' : 'Pause saving'}</button>
          </div>
          <Steps status={c.status} />
          <Why open={false} />
        </>}

        {c.status === 'ready' && <>
          <div className="banner leaf"><CheckCircle2 size={22} /><span className="grow"><b>Your {naira(plan?.target || CAC_TARGET)} is complete.</b> Fill this short form and Wema files your registration.</span></div>
          <div className="card" style={{ marginTop: 12 }}>
            <Field label="Business name (first choice)"><input value={form.names[0]} onChange={e => setForm({ ...form, names: [e.target.value, form.names[1]] })} /></Field>
            <Field label="Second choice (if the first is taken)"><input value={form.names[1]} onChange={e => setForm({ ...form, names: [form.names[0], e.target.value] })} placeholder="e.g. Ngozi Foods and Provisions" /></Field>
            <Field label="What the business does"><input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} /></Field>
            <Field label="Shop address" hint={p.location ? `GPS: ${fmtCoord(p.location)}` : 'Tip: save your shop location in Permissions'}><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Shop number, line, market, city" /></Field>
            <div className="kv" style={{ marginTop: 10 }}><span>Owner</span><b>{p.name}</b></div>
            <div className="kv"><span>Phone</span><b>{p.phone}</b></div>
            <div className="kv"><span>ID</span><b>From your Wema account</b></div>
            <label className="row" style={{ marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} style={{ width: 22, height: 22, accentColor: 'var(--royal)', flex: 'none', marginTop: 1 }} />
              <span style={{ fontSize: 14, lineHeight: 1.45 }}>I allow Wema to file this business name registration with CAC for me, using my saved money and my Wema account details.</span>
            </label>
            <button className="btn kola full" style={{ marginTop: 14, minHeight: 56 }} disabled={!form.consent || form.names[0].trim().length < 3 || form.address.trim().length < 4} onClick={() => { submitCac({ ...form, names: form.names.map(n => n.trim()).filter(Boolean) }); toast('Sent. Wema is filing your registration.', 'good'); }}><FileCheck2 size={20} />Send to Wema for registration</button>
          </div>
          <Steps status={c.status} />
        </>}

        {['submitted', 'approved', 'registered'].includes(c.status) && <>
          <div className="card center">
            {c.status === 'registered' ? <BadgeCheck size={56} className="leaf" /> : <Hourglass size={52} className="amber" />}
            <h2 style={{ margin: '8px 0 4px' }}>{c.status === 'registered' ? 'Your business is registered' : c.status === 'approved' ? 'Name approved' : 'Wema is filing your registration'}</h2>
            {c.number && <div className="money md" style={{ marginTop: 6 }}>{c.number}</div>}
            <div className="muted" style={{ fontSize: 14.5, marginTop: 6, lineHeight: 1.45 }}>{c.status === 'registered'
              ? `${c.application?.approvedName || p.businessName}. The CAC badge now shows on your Vendors Hub advert and on your invoices.`
              : c.status === 'approved' ? `"${c.application?.approvedName}" is approved. Final registration is next. We will tell you here.` : 'CAC is checking your business name. This page updates by itself.'}</div>
          </div>
          <Steps status={c.status} />
          {c.status === 'registered' && <div className="row" style={{ marginTop: 12 }}>
            <button className="btn plain grow" onClick={() => go('invoices')}>My invoices</button>
            <button className="btn kola grow" onClick={() => go('advert')}><Store size={18} />My Hub advert</button>
          </div>}
        </>}
      </div>
    </div>
  );
}
