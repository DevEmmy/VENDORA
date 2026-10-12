import React, { useMemo, useState } from 'react';
import { Search, Plus, Minus, Package, Store, BadgeCheck, Star, Truck, MapPin, Mic, Pencil, Trash2, ChevronRight, PackageCheck } from 'lucide-react';
import { useStore, Top, Sheet, Field, Empty, StockPill, SearchBar } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { quickRestock, saveProduct, deleteProduct, toast, isOwner } from '../lib/store.js';
import { naira, qtyUnit, timeAgo } from '../lib/format.js';
import { haptic } from '../lib/voice.js';

const UNITS = ['bag', 'carton', 'piece', 'paint', 'crate', 'bottle', 'tin', 'pack', 'kg'];
const COMMON = [
  ['Rice (bag)', 'bag'], ['Indomie (carton)', 'carton'], ['Peak Milk (carton)', 'carton'], ['Tomato Paste (carton)', 'carton'],
  ['Vegetable Oil (crate)', 'crate'], ['Yellow Garri (paint)', 'paint'], ['Sugar (bag)', 'bag'], ['Flour (bag)', 'bag'], ['Beans (paint)', 'paint'],
];

export default function Stock({ add }) {
  return (
    <div className="page with-nav" style={{ paddingBottom: 190 }}>
      <Top title="My stock" sub="Tap + when goods arrive. No typing." />
      <MyStock openAdd={!!add} />
    </div>
  );
}

function MyStock({ openAdd }) {
  const s = useStore();
  const { go } = useNav();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [delta, setDelta] = useState({});
  const [edit, setEdit] = useState(openAdd ? {} : null);
  const owner = isOwner(s);
  const low = s.products.filter(p => p.qty <= p.lowAt);
  const list = s.products
    .filter(p => q.toLowerCase().split(/\s+/).filter(Boolean).every(w => (p.name + ' ' + p.unit + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(w)))
    .filter(p => filter === 'all' || (filter === 'low' ? p.qty <= p.lowAt : p.qty > p.lowAt))
    .sort((a, b) => ((b.qty <= b.lowAt) - (a.qty <= a.lowAt)) || a.name.localeCompare(b.name));
  const changes = Object.entries(delta).filter(([, n]) => n > 0);
  const addedCount = changes.reduce((a, [, n]) => a + n, 0);
  const cost = changes.reduce((a, [id, n]) => a + n * (s.products.find(p => p.id === id)?.cost || 0), 0);
  const bump = (id, by) => { haptic(8); setDelta(d => ({ ...d, [id]: Math.max(0, (d[id] || 0) + by) })); };

  function save() {
    quickRestock(Object.fromEntries(changes));
    haptic([20, 40, 20]);
    toast(`Stock updated: ${addedCount} item${addedCount === 1 ? '' : 's'} added.`, 'good');
    setDelta({});
  }

  return (
    <div className="wrap" style={{ marginTop: 16 }}>
      <div className="row">
        <div className="grow"><SearchBar value={q} onChange={setQ} placeholder="Find an item" label="Find an item in my stock" /></div>
        <button className="icon-btn light" style={{ width: 54, height: 54 }} onClick={() => go('talk', { autoListen: true })} aria-label="Add stock by voice"><Mic size={22} /></button>
      </div>
      <div className="chips scroll" style={{ marginTop: 12 }}>
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All {s.products.length}</button>
        <button className="chip" aria-pressed={filter === 'low'} onClick={() => setFilter('low')}>Low or finished {low.length}</button>
        <button className="chip" aria-pressed={filter === 'ok'} onClick={() => setFilter('ok')}>In stock</button>
      </div>

      {low.length > 0 && <button className="banner royal" style={{ marginTop: 12 }} onClick={() => go('hub')}><Store size={20} /><span className="grow"><b>{low.length} item{low.length === 1 ? ' is' : 's are'} low.</b> Buy in bulk from verified sellers in the Vendors Hub.</span><ChevronRight size={18} /></button>}
      {s.products.length === 0 ? (
        <div style={{ marginTop: 14 }}><Empty icon={Package} title="Add what you sell" body="Pick from common items or add your own. You only do this once." action={<button className="btn primary" onClick={() => setEdit({})}><Plus size={18} />Add item</button>} /></div>
      ) : (
        <div className="list" style={{ marginTop: 12 }}>
          {list.map(p => {
            const n = delta[p.id] || 0;
            return (
              <div key={p.id} className={'stock-row' + (p.qty <= 0 ? ' out' : p.qty <= p.lowAt ? ' low' : '')}>
                <button className="grow" style={{ textAlign: 'left', minHeight: 48 }} onClick={() => owner && setEdit(p)} aria-label={`Edit ${p.name}`}>
                  <div style={{ fontWeight: 800, fontSize: 15 }} className="clip">{p.name}</div>
                  <div className="row" style={{ gap: 6, marginTop: 5 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{qtyUnit(p.qty, p.unit)}</span>
                    {n > 0 ? <span className="added">+{n} arriving</span> : <StockPill p={p} />}
                  </div>
                </button>
                <div className="stepper">
                  <button onClick={() => bump(p.id, -1)} disabled={!n} aria-label={`One less ${p.name}`} style={{ opacity: n ? 1 : .35 }}><Minus size={18} /></button>
                  <span className="v" aria-live="polite">{n ? `+${n}` : 0}</span>
                  <button onClick={() => bump(p.id, 1)} aria-label={`One more ${p.name}`}><Plus size={18} /></button>
                </div>
              </div>
            );
          })}
          {!list.length && <div className="item muted">No items match.</div>}
        </div>
      )}
      {owner && s.products.length > 0 && <button className="btn soft full" style={{ marginTop: 12 }} onClick={() => setEdit({})}><Plus size={18} />Add a new item</button>}

      {changes.length > 0 && (
        <div className="savebar">
          <div className="grow">
            <div style={{ fontSize: 13, opacity: .9 }}>{addedCount} item{addedCount === 1 ? '' : 's'} arriving{cost ? `, cost ${naira(cost)}` : ''}</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Add to stock</div>
          </div>
          <button className="btn sm" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }} onClick={() => setDelta({})}>Clear</button>
          <button className="btn" style={{ background: '#fff', color: 'var(--leaf)' }} onClick={save}>Save</button>
        </div>
      )}
      {edit && <ProductSheet p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProductSheet({ p, onClose }) {
  const isNew = !p.id;
  const [f, setF] = useState({ name: p.name || '', unit: p.unit || 'bag', cost: p.cost ? String(p.cost) : '', price: p.price ? String(p.price) : '', qty: p.qty ?? 0, lowAt: p.lowAt ?? 3, aliases: (p.aliases || []).join(', ') });
  const [confirmDel, setConfirmDel] = useState(false);
  const num = k => e => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') });
  const step = (k, by) => setF(x => ({ ...x, [k]: Math.max(0, (Number(x[k]) || 0) + by) }));
  const ok = f.name.trim().length >= 2 && Number(f.price) > 0;
  const margin = Number(f.price) && Number(f.cost) ? Math.round((f.price - f.cost) / f.price * 100) : null;

  function save() {
    saveProduct({ ...p, ...f, name: f.name.trim(), qty: Number(f.qty), lowAt: Number(f.lowAt), reason: 'Stock count corrected' });
    toast(isNew ? `${f.name.trim()} added.` : 'Changes saved.', 'good');
    onClose();
  }
  return (
    <Sheet title={isNew ? 'Add an item' : p.name} sub={isNew ? 'Tap a common item or type your own' : 'Change price or correct the count'} onClose={onClose}>
      {isNew && <div className="chips scroll" style={{ marginBottom: 4 }}>{COMMON.map(([n, u]) => <button key={n} className="chip" aria-pressed={f.name === n} onClick={() => setF({ ...f, name: n, unit: u })}>{n}</button>)}</div>}
      <Field label="Item name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Golden Penny Semovita" /></Field>
      <span className="label">Sold by the</span>
      <div className="chips">{UNITS.map(u => <button key={u} className="chip" aria-pressed={f.unit === u} onClick={() => setF({ ...f, unit: u })}>{u}</button>)}</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow"><Field label="You buy at" pre="₦"><input value={f.cost} onChange={num('cost')} inputMode="numeric" placeholder="0" /></Field></div>
        <div className="grow"><Field label="You sell at" pre="₦"><input value={f.price} onChange={num('price')} inputMode="numeric" placeholder="0" /></Field></div>
      </div>
      {margin != null && <div className={'hint ' + (margin < 0 ? 'pepper' : '')}>{margin < 0 ? 'You sell below cost.' : `You make ${naira(f.price - f.cost)} (${margin}%) on each ${f.unit}.`}</div>}
      <div className="row between" style={{ marginTop: 16 }}>
        <span style={{ fontWeight: 700 }}>{isNew ? 'How many do you have now?' : 'Count in the shop'}</span>
        <div className="stepper"><button onClick={() => step('qty', -1)} aria-label="One less"><Minus size={18} /></button><span className="v">{f.qty}</span><button onClick={() => step('qty', 1)} aria-label="One more"><Plus size={18} /></button></div>
      </div>
      {!isNew && Number(f.qty) !== p.qty && <div className="hint">The change from {p.qty} to {f.qty} is saved in your records as a correction.</div>}
      <div className="row between" style={{ marginTop: 12 }}>
        <span style={{ fontWeight: 700 }}>Warn me when it gets to</span>
        <div className="stepper"><button onClick={() => step('lowAt', -1)} aria-label="Lower"><Minus size={18} /></button><span className="v">{f.lowAt}</span><button onClick={() => step('lowAt', 1)} aria-label="Higher"><Plus size={18} /></button></div>
      </div>
      <Field label="Other names customers use (optional)" hint="Helps Vendora understand you when you talk, e.g. iresi, osikapa"><input value={f.aliases} onChange={e => setF({ ...f, aliases: e.target.value })} placeholder="Separate with commas" /></Field>
      <button className="btn primary full" style={{ marginTop: 18 }} disabled={!ok} onClick={save}>{isNew ? 'Add item' : 'Save changes'}</button>
      {!isNew && (confirmDel ? (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn plain grow" onClick={() => setConfirmDel(false)}>Keep it</button>
          <button className="btn danger grow" onClick={() => { deleteProduct(p.id); toast(`${p.name} removed.`); onClose(); }}>Remove item</button>
        </div>
      ) : <button className="btn plain full" style={{ marginTop: 10 }} onClick={() => setConfirmDel(true)}><Trash2 size={18} />Remove this item</button>)}
    </Sheet>
  );
}
