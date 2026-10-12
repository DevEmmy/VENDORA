import React, { useEffect, useMemo, useState } from 'react';
import { Landmark, Minus, Plus, BadgeCheck, CheckCircle2, ShieldCheck, Truck, CircleAlert } from 'lucide-react';
import { useStore, Top } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { getLoanOffer, takeLoan, businessScoreNow, updateProfile } from '../lib/store.js';
import { offersFor, seller as getSeller } from '../lib/hub.js';
import { restockForecast } from '../lib/insights.js';
import { repaymentPlan } from '../lib/finance.js';
import { naira } from '../lib/format.js';
import { haptic } from '../lib/voice.js';

export default function LoanApply({ productId, sellerId, lines: presetLines }) {
  const s = useStore();
  const { back, go } = useNav();
  const [offer, setOffer] = useState(null);
  const withOffers = useMemo(() => s.products.filter(p => offersFor(p).length), [s.products]);
  const forecast = useMemo(() => restockForecast(s.products, s.txns.filter(t => !t.reversed)), [s.products, s.txns]);
  const [pid, setPid] = useState(productId || (presetLines ? null : forecast.find(f => offersFor(f.product).length)?.product.id || withOffers[0]?.id || null));
  const product = s.products.find(p => p.id === pid);
  const offers = product ? offersFor(product) : [];
  const [vid, setVid] = useState(sellerId || null);
  const chosen = offers.find(o => o.seller.id === vid) || offers[0];
  const suggested = product ? Math.max(chosen?.item.moq || 1, forecast.find(f => f.product.id === pid)?.suggestQty || 1) : 0;
  const [qty, setQty] = useState(null);
  const q = qty ?? suggested;
  const [consent, setConsent] = useState(s.profile.consentShareData);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const score = businessScoreNow();

  useEffect(() => { getLoanOffer().then(setOffer).catch(e => setOffer({ eligible: false, reason: e.message })); }, []);
  useEffect(() => { setQty(null); }, [pid, vid]);

  const lines = presetLines || (chosen ? [{ key: chosen.item.key, name: product.name, unit: chosen.item.unit, qty: q, price: chosen.item.price, productId: product.id }] : []);
  const v = presetLines ? getSeller(sellerId) : chosen?.seller;
  const amount = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const plan = offer?.eligible ? repaymentPlan(amount, offer.rate, offer.tenorDays) : null;
  const over = offer?.eligible && amount > offer.limit;

  async function submit() {
    setErr(''); setBusy(true);
    try {
      updateProfile({ consentShareData: true });
      await takeLoan({ amount, supplier: { name: v.name, accountNumber: v.accountNumber }, order: { sellerId: v.id, lines } });
      haptic([20, 40, 20]);
      setDone({ amount, seller: v });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="page">
        <Top title="Wema Restock Loan" onBack={back} />
        <div className="wrap" style={{ marginTop: 20 }}>
          <div className="card center">
            <CheckCircle2 size={64} className="leaf" />
            <h2 style={{ margin: '10px 0 4px' }}>Loan approved</h2>
            <div className="muted" style={{ lineHeight: 1.5 }}>Wema has paid <b>{naira(done.amount)}</b> to {done.seller.name}. Your goods are on the way.</div>
            <div className="banner royal" style={{ marginTop: 16, textAlign: 'left' }}><Truck size={20} /><span>When the goods arrive, tap "I have received it" in the Vendors Hub. Your stock updates and the delivery is added to your verified records.</span></div>
            <button className="btn primary full" style={{ marginTop: 16 }} onClick={() => go('hub')}>Track my order</button>
            <button className="btn plain full" style={{ marginTop: 10 }} onClick={() => go('wallet', { seg: 'loans' })}>See my loan</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Wema Restock Loan" sub="Wema pays your seller directly" onBack={back} tall />
      <div className="wrap over">
        <div className="card" style={{ background: 'linear-gradient(160deg, #0a1a47, #1f3b9a)', color: '#fff' }}>
          {!offer ? <div className="skel" style={{ height: 56, opacity: .25 }} /> : offer.eligible ? (
            <div className="row between">
              <div><div style={{ color: '#b9c8f5', fontSize: 13 }}>Your limit</div><div className="money md" style={{ color: 'var(--kola-2)' }}>{naira(offer.limit)}</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ color: '#b9c8f5', fontSize: 13 }}>Business Score</div><b style={{ fontSize: 20 }}>{score.score}</b></div>
            </div>
          ) : (
            <>
              <div className="row"><CircleAlert size={22} /><b>Not available yet</b></div>
              <div style={{ marginTop: 8, lineHeight: 1.45, color: '#d7e0fb' }}>{offer.reason}</div>
              <button className="btn kola full" style={{ marginTop: 14 }} onClick={() => go('score')}>See how to qualify</button>
            </>
          )}
        </div>

        {offer?.eligible && <>
          {!presetLines && <>
            <div className="h2">What do you want to restock?</div>
            {withOffers.length ? (
              <div className="chips scroll">{withOffers.map(p => <button key={p.id} className="chip" aria-pressed={pid === p.id} onClick={() => { setPid(p.id); setVid(null); }}>{p.name}</button>)}</div>
            ) : <div className="card muted">Add your items in Stock first, then pick a verified seller here.</div>}
            {offers.length > 0 && <>
              <div className="h2">Choose a verified seller</div>
              <div className="list">{offers.map(o => (
                <button key={o.seller.id} className="item" onClick={() => setVid(o.seller.id)} aria-pressed={chosen?.seller.id === o.seller.id} style={chosen?.seller.id === o.seller.id ? { background: 'var(--royal-tint)' } : undefined}>
                  <span className={'avatar-sm ic ' + (chosen?.seller.id === o.seller.id ? 'royal' : 'ink')}><BadgeCheck size={19} /></span>
                  <span className="grow"><div className="t clip">{o.seller.name}</div><div className="s">{o.seller.market}, {o.seller.deliveryHours}h delivery, min {o.item.moq}</div></span>
                  <span className="amt">{naira(o.item.price)}</span>
                </button>
              ))}</div>
              <div className="card row between" style={{ marginTop: 12 }}>
                <span><b>How many {chosen.item.unit}s?</b><div className="small">Suggested to last a week</div></span>
                <div className="stepper">
                  <button onClick={() => setQty(Math.max(chosen.item.moq, q - 1))} aria-label="Fewer"><Minus size={18} /></button>
                  <span className="v">{q}</span>
                  <button onClick={() => setQty(q + 1)} aria-label="More"><Plus size={18} /></button>
                </div>
              </div>
            </>}
          </>}

          {v && amount > 0 && <>
            <div className="h2">Summary</div>
            <div className="card">
              {lines.map((l, i) => <div key={i} className="kv"><span>{l.qty} {l.unit} {l.name}</span><b>{naira(l.qty * l.price)}</b></div>)}
              <div className="kv"><span>Wema pays</span><b>{v.name}</b></div>
              <div className="kv"><span>Loan amount</span><b>{naira(amount)}</b></div>
              {plan && <>
                <div className="kv"><span>Interest ({(offer.rate * 100).toFixed(1)}% flat)</span><b>{naira(plan.totalRepayable - amount)}</b></div>
                <div className="kv"><span>You repay in total</span><b>{naira(plan.totalRepayable)}</b></div>
                <div className="kv"><span>Each day for {plan.tenorDays} days</span><b className="royal">{naira(plan.dailyRepayment)}</b></div>
              </>}
            </div>
            {over && <div className="banner amber" style={{ marginTop: 12 }}><CircleAlert size={20} /><span>This is above your limit of {naira(offer.limit)}. Reduce the quantity.</span></div>}
            <label className="card row" style={{ marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2, accentColor: 'var(--royal)', flex: 'none' }} />
              <span style={{ fontSize: 14, lineHeight: 1.45 }}><ShieldCheck size={15} className="leaf" style={{ verticalAlign: -2 }} /> I allow Wema Bank to see my Vendora sales records and Business Score for this loan, and to collect the daily repayment from my Wema account.</span>
            </label>
            {err && <div className="error">{err}</div>}
            <button className="btn kola full" style={{ marginTop: 16, minHeight: 58, fontSize: 17 }} disabled={busy || !consent || over || !s.profile.accountNumber} onClick={submit}>
              <Landmark size={20} />{busy ? 'Wema is approving…' : `Get ${naira(amount)} from Wema`}
            </button>
            {!s.profile.accountNumber && <div className="hint center">Open your Wema account in Wallet first.</div>}
          </>}
        </>}
      </div>
    </div>
  );
}
