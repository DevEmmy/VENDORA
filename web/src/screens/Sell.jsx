import React, { useMemo, useState } from 'react';
import { Search, Minus, Banknote, Landmark, BookUser, Coins, CheckCircle2, Mic, Share2, Plus, ScanLine, FileText, Package } from 'lucide-react';
import { useStore, Top, Sheet, Field, Empty, SearchBar } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { completeSale, requestPayment, reverseTxn } from '../lib/store.js';
import { naira, qtyUnit } from '../lib/format.js';
import { haptic } from '../lib/voice.js';
import { qtySold } from '../lib/insights.js';
import { startOfDay, DAY } from '../lib/format.js';
import { PaymentRequestView } from './GetPaid.jsx';

export default function Sell() {
  const s = useStore();
  const { go } = useNav();
  const [cart, setCart] = useState({});
  const [q, setQ] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [done, setDone] = useState(null);

  // Best sellers first, so the trader's usual items are always at the top
  const sold = useMemo(() => qtySold(s.txns.filter(t => !t.reversed), startOfDay() - 13 * DAY, Date.now() + 1), [s.txns]);
  const products = [...s.products]
    .filter(p => q.toLowerCase().split(/\s+/).filter(Boolean).every(w => (p.name + ' ' + p.unit + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(w)))
    .sort((a, b) => (sold[b.id]?.qty || 0) - (sold[a.id]?.qty || 0));
  const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, qty]) => { const p = s.products.find(x => x.id === id); return p && { productId: id, name: p.name, unit: p.unit, qty, price: p.price }; }).filter(Boolean);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);

  const add = p => { if ((cart[p.id] || 0) >= p.qty) { haptic(40); return; } haptic(10); setCart(c => ({ ...c, [p.id]: (c[p.id] || 0) + 1 })); };
  const remove = p => { haptic(8); setCart(c => ({ ...c, [p.id]: Math.max(0, (c[p.id] || 0) - 1) })); };

  return (
    <div className="page with-nav" style={{ paddingBottom: count ? 190 : 104 }}>
      <Top title="Sell" sub="Tap what the customer is buying" right={<><button className="icon-btn" onClick={() => go('stock')} aria-label="My stock"><Package size={21} /></button><button className="icon-btn" onClick={() => go('talk', { autoListen: true })} aria-label="Sell by voice"><Mic size={22} /></button></>}>
        <div style={{ marginTop: 16 }}><SearchBar value={q} onChange={setQ} placeholder="Find an item" label="Find an item to sell" /></div>
      </Top>
      <div className="wrap" style={{ marginTop: 16 }}>
        {s.products.length === 0 ? (
          <Empty icon={Plus} title="Add your items first" body="Once your stock is in Vendora, selling is just tapping." action={<button className="btn primary" onClick={() => go('stock', { add: true })}>Add items</button>} />
        ) : (
          products.length === 0 ? <Empty icon={Search} title={`No item called "${q}"`} body="Check the spelling, or add it to your stock." action={<button className="btn plain" onClick={() => setQ('')}>Show all items</button>} /> :
          <div className="tiles">
            {products.map(p => {
              const n = cart[p.id] || 0;
              const left = p.qty - n;
              return (
                <div key={p.id} style={{ position: 'relative' }}>
                  <button className={'tile' + (n ? ' in-cart' : '')} style={{ width: '100%' }} onClick={() => add(p)} disabled={p.qty <= 0} aria-label={`Add ${p.name}`}>
                    <span className="name">{p.name}</span>
                    <span>
                      <div className="price">{naira(p.price)}</div>
                      <div className={'stock ' + (p.qty <= 0 ? 'pepper' : left <= p.lowAt ? 'amber' : 'muted')}>{p.qty <= 0 ? 'Out of stock' : `${qtyUnit(left, p.unit)} left`}</div>
                    </span>
                  </button>
                  {n > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -8, right: -6, minWidth: 30, height: 30, borderRadius: 999, background: 'var(--royal)', color: '#fff', fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 8px', boxShadow: '0 4px 10px rgba(31,85,224,.35)', pointerEvents: 'none' }}>{n}</span>}
                  {n > 0 && <button onClick={() => remove(p)} aria-label={`Remove one ${p.name}`} style={{ position: 'absolute', bottom: 10, right: 10, width: 38, height: 38, borderRadius: 12, background: '#eef1f7', display: 'grid', placeItems: 'center' }}><Minus size={18} /></button>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {count > 0 && (
        <div className="cartbar">
          <div className="grow">
            <div style={{ fontSize: 13, color: '#b9c8f5' }}>{count} item{count === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{naira(total)}</div>
          </div>
          <button className="btn plain sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => setCart({})}>Clear</button>
          <button className="btn kola" onClick={() => setCheckout(true)}>Charge</button>
        </div>
      )}

      {checkout && <Checkout lines={lines} total={total} onClose={() => setCheckout(false)} onDone={r => { setCheckout(false); setCart({}); setDone(r); }} />}
      {done && <SaleDone r={done} onClose={() => setDone(null)} />}
    </div>
  );
}

function Checkout({ lines, total, onClose, onDone }) {
  const s = useStore();
  const { go } = useNav();
  const [method, setMethod] = useState('cash');
  const [cust, setCust] = useState('');
  const [part, setPart] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const recent = [...s.customers].sort((a, b) => b.balance - a.balance).slice(0, 6);
  const needsName = method === 'credit' || method === 'part';
  const methods = [
    ['cash', 'Cash', Banknote], ['transfer', 'Transfer', Landmark], ['credit', 'Owe me', BookUser], ['part', 'Part pay', Coins],
  ];

  async function finish() {
    setErr('');
    if (needsName && !cust.trim()) { setErr('Who is owing? Pick or type the customer\'s name.'); return; }
    const items = lines.map(l => ({ productId: l.productId, qty: l.qty, price: l.price }));
    const customer = cust.trim() ? { name: cust.trim() } : null;
    if (method === 'transfer') {
      setBusy(true);
      try { const pr = await requestPayment({ amount: total, items, customerName: customer?.name || null }); onDone({ pr, total }); }
      catch (e) { setErr(e.message); } finally { setBusy(false); }
      return;
    }
    const r = completeSale({ items, customer, method, paidNow: part });
    haptic([20, 40, 20]);
    onDone({ ...r, method, customer: customer?.name, lines });
  }

  return (
    <Sheet title={`Charge ${naira(total)}`} sub={lines.map(l => `${l.qty} ${l.name}`).join(', ')} onClose={onClose}>
      <span className="label">How is the customer paying?</span>
      <div className="actions" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {methods.map(([k, l, Icon]) => (
          <button key={k} className="action" onClick={() => setMethod(k)} aria-pressed={method === k}
            style={{ minHeight: 84, border: method === k ? '2px solid var(--royal)' : '2px solid transparent' }}>
            <span className={'ic ' + (method === k ? 'royal' : 'ink')}><Icon size={20} /></span>{l}
          </button>
        ))}
      </div>
      {method === 'transfer' && !s.profile.accountNumber && <div className="banner amber" style={{ marginTop: 12 }}>Open your Wema account in Wallet to collect transfers.</div>}
      {method === 'transfer' && s.profile.accountNumber && (
        <div className="banner royal" style={{ marginTop: 12 }}>
          <Landmark size={20} /><span className="grow">Vendora shows a one-time Wema account for exactly {naira(total)}. The sale confirms itself when the money lands.</span>
        </div>
      )}
      {method === 'transfer' && s.profile.accountNumber && (
        <button className="link" onClick={() => go('confirm', { amount: total })}><ScanLine size={14} style={{ verticalAlign: -2 }} /> Customer already sent it? Check their receipt</button>
      )}
      {method === 'part' && (
        <Field label="How much did they pay now?" pre="₦"><input value={part} onChange={e => setPart(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="0" /></Field>
      )}
      <span className="label">{needsName ? 'Who is owing?' : 'Customer (optional)'}</span>
      <div className="chips scroll">
        {recent.map(c => <button key={c.id} className="chip" aria-pressed={cust === c.name} onClick={() => setCust(cust === c.name ? '' : c.name)}>{c.name}</button>)}
      </div>
      <div className="field" style={{ marginTop: 10 }}><input value={cust} onChange={e => setCust(e.target.value)} placeholder="Or type a name" aria-label="Customer name" /></div>
      {err && <div className="error">{err}</div>}
      <button className="btn primary full" style={{ marginTop: 18 }} disabled={busy || (method === 'transfer' && !s.profile.accountNumber) || (method === 'part' && !(Number(part) > 0 && Number(part) < total))} onClick={finish}>
        {busy ? 'Creating account…' : method === 'transfer' ? 'Show account to customer' : method === 'credit' ? `Record ${naira(total)} owed` : method === 'part' ? 'Record part payment' : `Cash received, ${naira(total)}`}
      </button>
    </Sheet>
  );
}

function SaleDone({ r, onClose }) {
  const s = useStore();
  const { go } = useNav();
  if (r.pr) return <Sheet title="Show this to the customer" onClose={onClose}><PaymentRequestView pr={r.pr} onDone={onClose} /></Sheet>;
  const owed = r.total - r.paid;
  const inv = s.txns.find(t => t.id === r.txnIds[0]);
  const text = encodeURIComponent(`${s.profile.businessName}\n${r.lines.map(l => `${l.qty} x ${l.name}  ${naira(l.qty * l.price)}`).join('\n')}\nTotal: ${naira(r.total)}${owed > 0 ? `\nPaid: ${naira(r.paid)}\nBalance: ${naira(owed)}` : ''}\nThank you!`);
  return (
    <Sheet onClose={onClose}>
      <div className="center" style={{ padding: '6px 0 4px' }}>
        <CheckCircle2 size={56} className="leaf" />
        <h2 style={{ marginTop: 8 }}>Sale recorded</h2>
        <div className="money md" style={{ marginTop: 4 }}>{naira(r.total)}</div>
        <div className="muted" style={{ marginTop: 6 }}>{owed > 0 ? `${r.customer} owes ${naira(owed)}` : 'Stock updated'}{inv ? `. Invoice ${inv.invoiceNo}` : ''}</div>
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <a className="btn wa grow" style={{ textDecoration: 'none' }} href={`https://wa.me/?text=${text}`} target="_blank" rel="noreferrer"><Share2 size={18} />Send receipt</a>
        <button className="btn primary grow" onClick={onClose}>Next sale</button>
      </div>
      {inv && <button className="btn plain full" style={{ marginTop: 10 }} onClick={() => { onClose(); go('invoices', { open: inv.id }); }}><FileText size={18} />View invoice {inv.invoiceNo}</button>}
      <button className="link" style={{ display: 'block', margin: '10px auto 0' }} onClick={() => { r.txnIds.forEach(id => reverseTxn(id, 'Cancelled at the till')); onClose(); }}>Cancel this sale</button>
    </Sheet>
  );
}
