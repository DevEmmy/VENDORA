import React, { useState } from 'react';
import { ShoppingBag, HandCoins, Landmark, Minus, Plus, Sparkles } from 'lucide-react';
import { useStore, Sheet, initials } from '../components/ui.jsx';
import { resolveCredit, guessForAmount, dismissAlert, toast } from '../lib/store.js';
import { naira, qtyUnit, timeAgo } from '../lib/format.js';
import { haptic } from '../lib/voice.js';

/** Money landed in the Wema account without a sale attached: one tap to say what it was for. */
export default function CreditAlert({ alert }) {
  const s = useStore();
  const c = s.credits.find(x => x.id === alert.creditId);
  const [pick, setPick] = useState(false);
  const [cart, setCart] = useState({});
  if (!c) return null;
  const close = () => dismissAlert(alert.id);
  const guess = guessForAmount(c.amount);
  const first = c.senderName.toLowerCase().split(' ')[0];
  const owing = s.customers.filter(x => x.balance > 0).sort((a, b) => (b.name.toLowerCase().includes(first) - a.name.toLowerCase().includes(first)) || b.balance - a.balance).slice(0, 4);
  const done = async (choice, msg) => { try { await resolveCredit(c.id, choice); haptic([20, 40, 20]); toast(msg, 'good'); }
    catch (error) { toast(error.message, 'bad'); } };
  const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, qty]) => { const p = s.products.find(x => x.id === id); return { productId: id, qty, price: p.price, name: p.name, unit: p.unit }; });
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);

  return (
    <Sheet title={`${naira(c.amount)} received`} sub={`From ${c.senderName}, ${timeAgo(c.at)}. Confirmed by Wema.`} onClose={close}>
      {!pick ? <>
        <span className="label" style={{ marginTop: 4 }}>What was it for?</span>
        <div className="list">
          {guess && (
            <button className="item" onClick={() => done({ type: 'sale', items: [{ productId: guess.product.id, qty: guess.qty, price: guess.product.price }] }, 'Sale recorded and confirmed.')}>
              <span className="avatar-sm ic royal"><Sparkles size={19} /></span>
              <span className="grow"><div className="t">Sale: {qtyUnit(guess.qty, guess.product.unit)} {guess.product.name}</div><div className="s">Matches the amount exactly</div></span>
            </button>
          )}
          {owing.map(x => (
            <button key={x.id} className="item" onClick={() => done({ type: 'debt', customerId: x.id }, `${x.name}'s payment recorded.`)}>
              <span className="avatar-sm ic kola">{initials(x.name)}</span>
              <span className="grow"><div className="t">{x.name} paying debt</div><div className="s">Owes {naira(x.balance)}</div></span>
            </button>
          ))}
          <button className="item" onClick={() => setPick(true)}>
            <span className="avatar-sm ic ink"><ShoppingBag size={19} /></span>
            <span className="grow"><div className="t">A sale, let me pick the items</div></span>
          </button>
          <button className="item" onClick={() => done({ type: 'other' }, 'Saved as money received.')}>
            <span className="avatar-sm ic leaf"><Landmark size={19} /></span>
            <span className="grow"><div className="t">Something else</div><div className="s">Saved as money received</div></span>
          </button>
        </div>
        <button className="btn plain full" style={{ marginTop: 12 }} onClick={close}>Decide later</button>
      </> : <>
        <span className="label" style={{ marginTop: 4 }}>Tap what was sold</span>
        <div className="list">{s.products.map(p => {
          const n = cart[p.id] || 0;
          return (
            <div key={p.id} className="stock-row" style={{ borderLeftColor: n ? 'var(--royal)' : 'transparent', minHeight: 64 }}>
              <span className="grow"><div style={{ fontWeight: 700 }} className="clip">{p.name}</div><div className="small">{naira(p.price)}</div></span>
              <div className="stepper">
                <button onClick={() => setCart({ ...cart, [p.id]: Math.max(0, n - 1) })} aria-label={`Less ${p.name}`} style={{ opacity: n ? 1 : .35 }}><Minus size={18} /></button>
                <span className="v">{n}</span>
                <button onClick={() => setCart({ ...cart, [p.id]: n + 1 })} aria-label={`More ${p.name}`}><Plus size={18} /></button>
              </div>
            </div>
          );
        })}</div>
        {lines.length > 0 && total !== c.amount && <div className="hint">Items add up to {naira(total)}. The sale is saved at the {naira(c.amount)} actually received.</div>}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn plain grow" onClick={() => setPick(false)}>Back</button>
          <button className="btn primary grow" disabled={!lines.length} onClick={() => done({ type: 'sale', items: lines.map(({ productId, qty, price }) => ({ productId, qty, price })) }, 'Sale recorded and confirmed.')}><HandCoins size={18} />Save sale</button>
        </div>
      </>}
    </Sheet>
  );
}
