import React, { useMemo, useState } from 'react';
import { Store, BadgeCheck, Star, Truck, MapPin, ChevronRight, PackageCheck, Megaphone, ShieldCheck, Clock } from 'lucide-react';
import { useStore, Top, Empty, StockPill, SearchBar } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { confirmDelivery, isOwner, toast } from '../lib/store.js';
import { naira, timeAgo } from '../lib/format.js';
import { sellers, search, searchItems, offersFor, keyFor } from '../lib/hub.js';
import { restockForecast } from '../lib/insights.js';
import { distanceKm } from '../lib/device.js';
import ShopArt from '../components/ShopArt.jsx';
import Media from '../components/Media.jsx';
import ProductArt from '../components/ProductArt.jsx';

const CATS = [['rice', 'Rice'], ['beans', 'Beans'], ['garri', 'Garri'], ['indomie', 'Noodles'], ['milk', 'Milk'], ['tomato', 'Tomato'], ['oil', 'Oil'], ['sugar', 'Sugar'], ['flour', 'Flour']];

export const kmFrom = (loc, v) => { const d = distanceKm(loc, v); return d == null ? v.distanceKm : d; };
export const fmtKm = km => km < 0.3 ? 'in your market' : km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
export const deliveryLabel = h => h < 24 ? `${h} hrs` : `${Math.round(h / 24)} day${h >= 48 ? 's' : ''}`;

export function SellerCard({ v, item, loc }) {
  const { go } = useNav();
  return (
    <button className="card" style={{ width: '100%', textAlign: 'left', padding: 16 }} onClick={() => go('seller', { id: v.id })}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="avatar-sm" style={{ width: 46, height: 46, borderRadius: 14, background: v.color, color: '#fff' }}><Store size={22} /></span>
        <div className="grow">
          <div className="row" style={{ gap: 6 }}><b className="clip" style={{ fontSize: 15.5 }}>{v.name}</b><BadgeCheck size={18} className="royal" style={{ flex: 'none' }} aria-label="Verified" /></div>
          <div className="small" style={{ marginTop: 2 }}><MapPin size={12} style={{ verticalAlign: -1 }} /> {v.market}, {v.city}, {fmtKm(kmFrom(loc, v))}</div>
          <div className="badge-row" style={{ marginTop: 8 }}>
            <span className="pill kola"><Star size={12} fill="currentColor" />{v.rating}</span>
            <span className="pill grey"><Truck size={12} />{deliveryLabel(v.deliveryHours)}</span>
            <span className="pill leaf">{v.trades.toLocaleString()} deliveries</span>
          </div>
        </div>
        <ChevronRight size={18} className="muted" />
      </div>
      {item ? <div className="row between" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}><span className="row" style={{ gap: 10 }}><span className="thumb-art sm"><ProductArt k={item.key} rounded={0} /></span><span className="muted" style={{ fontSize: 14 }}>{item.name}</span></span><b>{naira(item.price)} <span className="small">/ {item.unit}</span></b></div>
        : <div className="mini-goods">{v.catalog.slice(0, 5).map(c => <span key={c.key + c.unit} className="thumb-art"><ProductArt k={c.key} rounded={0} /></span>)}</div>}
    </button>
  );
}

function AdCard({ v, loc }) {
  const { go } = useNav();
  return (
    <button className="ad-card" onClick={() => go('seller', { id: v.id })}>
      <div className="hero-media"><ShopArt color={v.color} keys={v.catalog.map(c => c.key)} label={v.name} /></div>
      <div className="body">
        <div className="row" style={{ gap: 6 }}><b className="clip">{v.name}</b><BadgeCheck size={16} className="royal" style={{ flex: 'none' }} /></div>
        <div className="small clip" style={{ marginTop: 2 }}>{v.about}</div>
        <div className="small" style={{ marginTop: 6, fontWeight: 700, color: 'var(--text-2)' }}>{v.market}, {fmtKm(kmFrom(loc, v))}</div>
        <div className="mini-goods">{v.catalog.slice(0, 4).map(c => <span key={c.key + c.unit} className="thumb-art"><ProductArt k={c.key} rounded={0} /></span>)}</div>
      </div>
    </button>
  );
}

function MyAdCard({ ad, s }) {
  const { go } = useNav();
  const cover = ad.media?.[0];
  return (
    <button className="ad-card" onClick={() => go('advert')} style={{ border: '2px solid var(--kola)' }}>
      <div className="hero-media">{cover ? <Media m={cover} /> : <ShopArt color="#a77600" keys={s.products.map(keyFor).filter(Boolean)} />}
        <span className="pill kola" style={{ position: 'absolute', top: 10, left: 10 }}>Your advert</span></div>
      <div className="body">
        <b className="clip" style={{ display: 'block' }}>{s.profile.businessName}</b>
        <div className="small clip" style={{ marginTop: 2 }}>{ad.headline || 'Tap to finish your advert'}</div>
        <div className="small" style={{ marginTop: 6, fontWeight: 700, color: ad.published ? 'var(--leaf)' : 'var(--amber)' }}>{ad.published ? 'Live on the Hub' : 'Not published yet'}</div>
      </div>
    </button>
  );
}

export default function Hub({ focus }) {
  const s = useStore();
  const { go } = useNav();
  const loc = s.profile.location;
  const focusP = focus && s.products.find(p => p.id === focus);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(focusP ? keyFor(focusP) : null);
  const owner = isOwner(s);
  const arriving = s.orders.filter(o => o.status !== 'delivered');
  const delivered = s.orders.filter(o => o.status === 'delivered').slice(0, 3);
  const needs = useMemo(() => restockForecast(s.products, s.txns.filter(t => !t.reversed)).filter(f => f.product.qty <= f.product.lowAt || f.daysLeft < 5).slice(0, 3), [s.products, s.txns]);
  const items = searchItems(q);
  const list = search(q, cat).sort((a, b) => {
    const pa = cat ? a.catalog.find(c => c.key === cat)?.price || 0 : 0, pb = cat ? b.catalog.find(c => c.key === cat)?.price || 0 : 0;
    return pa - pb || kmFrom(loc, a) - kmFrom(loc, b);
  });
  const itemFor = v => cat ? v.catalog.find(c => c.key === cat) : null;
  const deals = useMemo(() => {
    const mine = {};
    for (const p of s.products) { const k = keyFor(p); if (k) mine[k + p.unit] = p; }
    return sellers().flatMap(v => v.catalog.map(item => {
      const p = mine[item.key + item.unit];
      const saving = p?.cost && item.price < p.cost && item.price > p.cost * 0.6 ? p.cost - item.price : 0;
      return { seller: v, item, saving, product: p };
    })).filter(d => !cat || d.item.key === cat)
      .sort((a, b) => (b.saving > 0) - (a.saving > 0) || kmFrom(loc, a.seller) - kmFrom(loc, b.seller) || a.item.price - b.item.price)
      .slice(0, cat ? 12 : 10);
  }, [s.products, cat, loc]);
  const bestDeal = useMemo(() => {
    let best = null;
    for (const p of s.products) for (const o of offersFor(p)) if (o.saving > 0 && (!best || o.saving * Math.max(1, p.lowAt) > best.saving * Math.max(1, best.product.lowAt))) best = { ...o, product: p };
    return best;
  }, [s.products]);
  const typing = q.trim().length > 0;

  return (
    <div className="page with-nav">
      <Top title="Vendors Hub" sub="Verified sellers. Buy in bulk, get it delivered.">
        <div style={{ marginTop: 14 }}><SearchBar value={q} onChange={v => { setQ(v); if (v) setCat(null); }} placeholder="Search rice, Indomie, a seller or market" label="Search the Vendors Hub" /></div>
      </Top>
      <div className="wrap" style={{ marginTop: 16 }}>
        {typing ? <>
          <div className="h2" style={{ marginTop: 0 }}>{items.length ? `${items.length} offer${items.length === 1 ? '' : 's'} for "${q.trim()}"` : `Sellers matching "${q.trim()}"`}</div>
          {items.length > 0 && <div className="list">{items.map(({ seller: v, item }) => (
            <button key={v.id + item.key + item.unit} className="item" onClick={() => go('seller', { id: v.id })}>
              <span className="thumb-art"><ProductArt k={item.key} rounded={0} /></span>
              <span className="grow"><div className="t clip">{item.name}</div><div className="s clip">{v.name}, {v.market}, {fmtKm(kmFrom(loc, v))}</div></span>
              <span style={{ textAlign: 'right' }}><div className="amt">{naira(item.price)}</div><div className="s">per {item.unit}</div></span>
            </button>
          ))}</div>}
          {!items.length && (list.length ? <div className="gap cards">{list.map(v => <SellerCard key={v.id} v={v} loc={loc} />)}</div>
            : <Empty icon={Store} title={`No seller has "${q.trim()}" yet`} body="Try another word, like rice, milk, oil or a market name." action={<button className="btn plain" onClick={() => setQ('')}>Show all sellers</button>} />)}
        </> : <>
          {owner && (s.advert ? null : (
            <button className="banner kola" onClick={() => go('advert')}>
              <Megaphone size={22} />
              <span className="grow"><b>Advertise your shop here</b><br />Add photos or a short video. Buyers near you will find you.</span>
              <ChevronRight size={18} />
            </button>
          ))}

          {arriving.map(o => (
            <div key={o.id} className="card" style={{ marginTop: 12, borderLeft: '4px solid var(--royal)' }}>
              <div className="row"><Truck size={22} className="royal" /><b className="grow">On the way from {o.sellerName}</b><span className="pill royal">{o.pay === 'loan' ? 'Wema loan' : 'Paid'}</span></div>
              <div className="small" style={{ marginTop: 6 }}>{o.lines.map(l => `${l.qty} ${l.unit} ${l.name}`).join(', ')}. Ordered {timeAgo(o.at)}, {naira(o.total)}</div>
              <button className="btn leaf full" style={{ marginTop: 12 }} onClick={async () => {
                try { await confirmDelivery(o.id); } catch (error) { toast(error.message, 'bad'); }
              }}><PackageCheck size={20} />I have received it</button>
            </div>
          ))}

          {bestDeal && (
            <button className="hero-deal" style={{ width: '100%', textAlign: 'left', marginTop: 12 }} onClick={() => go('seller', { id: bestDeal.seller.id })}>
              <span className="grow">
                <span className="tag">Deal for your shop</span>
                <h3>Save {naira(bestDeal.saving)} on every {bestDeal.item.unit} of {bestDeal.product.name}</h3>
                <span style={{ color: '#c5d3fb', fontSize: 14 }}>{naira(bestDeal.item.price)} at {bestDeal.seller.name}, {bestDeal.seller.market}</span>
                <span className="btn kola sm" style={{ marginTop: 12 }}>Order now</span>
              </span>
              <span className="art"><ProductArt k={bestDeal.item.key} plain /></span>
            </button>
          )}

          <div className="h2">Shop by item</div>
          <div className="cat-row" role="tablist" aria-label="Shop by item">
            {CATS.map(([k, l]) => (
              <button key={k} className="cat" aria-pressed={cat === k} onClick={() => setCat(cat === k ? null : k)}>
                <span className="ring2"><ProductArt k={k} rounded={0} /></span>{l}
              </button>
            ))}
          </div>

          <div className="h2">{cat ? `${CATS.find(c => c[0] === cat)[1]} deals` : 'Top deals near you'} {cat && <button className="more" onClick={() => setCat(null)}>Show all</button>}</div>
          <div className="deals">
            {deals.map(({ seller: v, item, saving }) => (
              <button key={v.id + item.key + item.unit} className="deal" onClick={() => go('seller', { id: v.id })}>
                <span className="im"><ProductArt k={item.key} rounded={0} />{saving > 0 && <span className="save">Save {naira(saving)}</span>}</span>
                <span className="bd">
                  <div className="nm">{item.name}</div>
                  <div className="pr">{naira(item.price)} <span className="small">/ {item.unit}</span></div>
                  <div className="sl"><BadgeCheck size={12} className="royal" style={{ verticalAlign: -2 }} /> {v.name}</div>
                  <div className="sl">{v.market}, {fmtKm(kmFrom(loc, v))}, min {item.moq}</div>
                </span>
              </button>
            ))}
          </div>

          <div className="h2">Featured shops</div>
          <div className="gallery" style={{ margin: '0 -16px', padding: '0 16px 6px' }}>
            {s.advert && <MyAdCard ad={s.advert} s={s} />}
            {sellers().slice().sort((a, b) => kmFrom(loc, a) - kmFrom(loc, b)).map(v => <AdCard key={v.id} v={v} loc={loc} />)}
          </div>

          {needs.length > 0 && !focusP && <>
            <div className="h2">You need these soon</div>
            <div className="gap cards">{needs.map(f => {
              const offers = offersFor(f.product);
              return (
                <div key={f.product.id} className="card">
                  <div className="row between"><b>{f.product.name}</b><StockPill p={f.product} /></div>
                  <div className="small" style={{ marginTop: 4 }}>{offers.length ? `Best price ${naira(offers[0].item.price)} at ${offers[0].seller.name}${offers[0].saving > 0 ? `, ${naira(offers[0].saving)} cheaper than you pay now` : ''}` : 'No verified seller lists this yet'}</div>
                  {offers.length > 0 && <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn soft sm grow" onClick={() => go('seller', { id: offers[0].seller.id, productId: f.product.id })}>Order</button>
                    {owner && <button className="btn kola sm grow" onClick={() => go('loan', { productId: f.product.id, sellerId: offers[0].seller.id })}>Use Wema loan</button>}
                  </div>}
                </div>
              );
            })}</div>
          </>}

          <div className="h2">{focusP ? `Sellers for ${focusP.name}` : 'All verified sellers'}</div>
          {!loc && <button className="banner royal" style={{ marginTop: 12 }} onClick={() => go('location')}><MapPin size={20} /><span className="grow">Set your shop location to see the nearest sellers first.</span><ChevronRight size={18} /></button>}
          <div className="gap cards" style={{ marginTop: 12 }}>{list.map(v => <SellerCard key={v.id} v={v} item={itemFor(v)} loc={loc} />)}</div>

          <div className="card" style={{ marginTop: 16 }}>
            <b>What "verified" means</b>
            <div className="gap" style={{ marginTop: 10, fontSize: 14, lineHeight: 1.45 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={18} className="leaf" style={{ flex: 'none' }} /><span className="muted">Business account checked by Wema, so payments go to the real owner.</span></div>
              <div className="row" style={{ alignItems: 'flex-start' }}><BadgeCheck size={18} className="leaf" style={{ flex: 'none' }} /><span className="muted">Registered with CAC.</span></div>
              <div className="row" style={{ alignItems: 'flex-start' }}><Clock size={18} className="leaf" style={{ flex: 'none' }} /><span className="muted">Every delivery is confirmed by the trader who received it.</span></div>
            </div>
          </div>
          {delivered.length > 0 && <>
            <div className="h2">Received</div>
            <div className="list">{delivered.map(o => <div key={o.id} className="item"><PackageCheck size={20} className="leaf" /><span className="grow"><div className="t clip">{o.sellerName}</div><div className="s">{naira(o.total)}, delivered {timeAgo(o.deliveredAt)}</div></span></div>)}</div>
          </>}
        </>}
      </div>
    </div>
  );
}

