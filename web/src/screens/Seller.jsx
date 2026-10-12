import React, { useState } from 'react';
import { BadgeCheck, Star, Truck, MapPin, Phone, MessageCircle, Minus, Plus, Landmark, ShieldCheck, FileCheck2, CheckCircle2, Wallet, Clock, Navigation } from 'lucide-react';
import { useStore, Top, Sheet } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { placeOrder, isOwner } from '../lib/store.js';
import { seller as getSeller, keyFor } from '../lib/hub.js';
import { naira } from '../lib/format.js';
import { haptic } from '../lib/voice.js';
import { mapsUrl } from '../lib/device.js';
import ShopArt from '../components/ShopArt.jsx';
import ProductArt from '../components/ProductArt.jsx';
import { kmFrom, fmtKm } from './Hub.jsx';

export default function SellerPage({ id, productId }) {
  const s = useStore();
  const { back, go } = useNav();
  const v = getSeller(id);
  const focusKey = productId && keyFor(s.products.find(p => p.id === productId) || {});
  const [qty, setQty] = useState(() => Object.fromEntries((v?.catalog || []).map(c => [c.key + c.unit, c.key === focusKey ? c.moq : 0])));
  const [pay, setPay] = useState(false);
  const [done, setDone] = useState(null);
  if (!v) return <div className="page"><Top title="Seller" onBack={back} /><div className="wrap" style={{ marginTop: 16 }}>This seller is no longer listed.</div></div>;

  const match = c => s.products.find(p => keyFor(p) === c.key && p.unit === c.unit);
  const lines = v.catalog.filter(c => qty[c.key + c.unit] > 0).map(c => ({ key: c.key, name: match(c)?.name || c.name, unit: c.unit, qty: qty[c.key + c.unit], price: c.price, productId: match(c)?.id || null }));
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const step = (c, dir) => {
    haptic(8);
    setQty(q => { const k = c.key + c.unit; const n = q[k] || 0; return { ...q, [k]: dir > 0 ? (n < c.moq ? c.moq : n + 1) : (n - 1 < c.moq ? 0 : n - 1) }; });
  };
  const owner = isOwner(s);

  return (
    <div className="page" style={{ paddingBottom: lines.length ? 120 : 24 }}>
      <Top title={v.name} sub={`${v.market}, ${v.city}`} onBack={back} tall />
      <div className="wrap over">
        <div className="hero-media" style={{ boxShadow: 'var(--lift)', marginBottom: 12 }}><ShopArt color={v.color} keys={v.catalog.map(c => c.key)} label={v.name} /></div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 15, lineHeight: 1.45 }}>{v.about}</div>
          <div className="small" style={{ marginTop: 6 }}><Clock size={12} style={{ verticalAlign: -1 }} /> {v.hours}</div>
          <a className="btn soft sm" style={{ marginTop: 10, textDecoration: 'none' }} href={mapsUrl(v)} target="_blank" rel="noreferrer"><Navigation size={16} />Directions to {v.market}</a>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="pill kola"><Star size={12} fill="currentColor" />{v.rating} from {v.reviews} traders</span>
            <span className="pill grey"><MapPin size={12} />{fmtKm(kmFrom(s.profile.location, v)).replace(/^(\d.*)$/, "$1 away")}</span>
            <span className="pill grey"><Truck size={12} />Delivers in {v.deliveryHours < 24 ? `${v.deliveryHours} hours` : `${Math.round(v.deliveryHours / 24)} day${v.deliveryHours >= 48 ? 's' : ''}`}</span>
          </div>
          <div className="hr" />
          <div className="gap" style={{ fontSize: 14 }}>
            <div className="row"><Landmark size={18} className="leaf" /><span className="grow">Wema-verified business account</span><BadgeCheck size={18} className="leaf" /></div>
            <div className="row"><FileCheck2 size={18} className="leaf" /><span className="grow">CAC registered, {v.cac}</span><BadgeCheck size={18} className="leaf" /></div>
            <div className="row"><ShieldCheck size={18} className="leaf" /><span className="grow">{v.trades.toLocaleString()} deliveries confirmed by traders since {v.since}</span><BadgeCheck size={18} className="leaf" /></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <a className="btn plain grow" style={{ textDecoration: 'none' }} href={`tel:${v.phone}`}><Phone size={18} />Call</a>
            <a className="btn wa grow" style={{ textDecoration: 'none' }} href={`https://wa.me/234${v.phone.slice(1)}?text=${encodeURIComponent(`Hello ${v.name}, I found you on Vendora.`)}`} target="_blank" rel="noreferrer"><MessageCircle size={18} />WhatsApp</a>
          </div>
        </div>

        <div className="h2">Price list</div>
        <div className="list">
          {v.catalog.map(c => {
            const n = qty[c.key + c.unit] || 0;
            const mine = match(c);
            const saving = mine?.cost ? mine.cost - c.price : 0;
            return (
              <div key={c.key + c.unit} className="stock-row" style={{ borderLeftColor: n ? 'var(--royal)' : 'transparent' }}>
                <span className="thumb-art"><ProductArt k={c.key} rounded={0} /></span>
                <div className="grow">
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{c.name}</div>
                  <div style={{ fontWeight: 700, marginTop: 3 }}>{naira(c.price)} <span className="small">per {c.unit}, min {c.moq}</span></div>
                  {saving > 0 && <div className="added" style={{ marginTop: 2 }}>{naira(saving)} cheaper than you pay now</div>}
                </div>
                <div className="stepper">
                  <button onClick={() => step(c, -1)} disabled={!n} style={{ opacity: n ? 1 : .35 }} aria-label={`Less ${c.name}`}><Minus size={18} /></button>
                  <span className="v">{n}</span>
                  <button onClick={() => step(c, 1)} aria-label={`More ${c.name}`}><Plus size={18} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="small center" style={{ marginTop: 10 }}>Tap + once to add the minimum order</div>
      </div>

      {lines.length > 0 && (
        <div className="cartbar" style={{ bottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <div className="grow">
            <div style={{ fontSize: 13, color: '#b9c8f5' }}>{lines.reduce((a, l) => a + l.qty, 0)} {lines.length === 1 ? lines[0].unit + 's' : 'items'}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{naira(total)}</div>
          </div>
          <button className="btn kola" onClick={() => setPay(true)}>Order</button>
        </div>
      )}

      {pay && !done && (
        <Sheet title={`Order ${naira(total)}`} sub={lines.map(l => `${l.qty} ${l.unit} ${l.name}`).join(', ')} onClose={() => setPay(false)}>
          {owner && (
            <button className="card row" style={{ width: '100%', textAlign: 'left', border: '2px solid var(--kola)' }} onClick={() => { setPay(false); go('loan', { sellerId: v.id, lines }); }}>
              <span className="ic kola" style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center' }}><Landmark size={22} /></span>
              <span className="grow"><b>Pay with Wema Restock Loan</b><div className="small">Wema pays {v.name}. You repay daily from sales.</div></span>
            </button>
          )}
          <button className="card row" style={{ width: '100%', textAlign: 'left', marginTop: 10 }} onClick={() => { const oid = placeOrder({ sellerId: v.id, lines, pay: 'wallet' }); haptic([20, 40, 20]); setDone(oid); }} disabled={!s.profile.accountNumber}>
            <span className="ic royal" style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center' }}><Wallet size={22} /></span>
            <span className="grow"><b>Pay from my Wema account</b><div className="small">{s.profile.accountNumber ? 'Money is held until you confirm delivery' : 'Open your Wema account in Wallet first'}</div></span>
          </button>
        </Sheet>
      )}
      {done && (
        <Sheet onClose={() => back()}>
          <div className="center" style={{ padding: '6px 0' }}>
            <CheckCircle2 size={56} className="leaf" />
            <h2 style={{ marginTop: 8 }}>Order placed</h2>
            <div className="muted" style={{ marginTop: 6, lineHeight: 1.45 }}>{v.name} delivers in about {v.deliveryHours} hours. When it arrives, tap "I have received it" in the Vendors Hub and your stock updates by itself.</div>
          </div>
          <button className="btn primary full" style={{ marginTop: 16 }} onClick={() => go('hub')}>Done</button>
        </Sheet>
      )}
    </div>
  );
}
