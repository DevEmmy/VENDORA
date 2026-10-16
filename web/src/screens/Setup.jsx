import React, { useState } from 'react';
import { UserRound, Phone, Store, MapPin } from 'lucide-react';
import { useStore, Top, Field } from '../components/ui.jsx';
import { completeSetup, saveProduct, getState } from '../lib/store.js';
import { demoProducts } from '../lib/seed.js';

const TYPES = ['Foodstuff', 'Provisions', 'Clothing', 'Phones & accessories', 'Cosmetics', 'Pharmacy', 'Other'];
const STARTERS = ['rice', 'indomie', 'milk', 'tomato', 'oil', 'garri'];

export default function Setup({ next, back }) {
  const p = useStore(s => s.profile);
  const [f, setF] = useState({ name: p.name, phone: p.phone, businessName: p.businessName, businessType: p.businessType || '', city: p.city });
  const [err, setErr] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });

  function submit() {
    const phone = f.phone.replace(/\D/g, '').replace(/^234/, '0');
    if (f.name.trim().length < 2) return setErr('Enter your name.');
    if (!/^0?[789][01]\d{8}$/.test(phone)) return setErr('Enter a Nigerian phone number, like 0803 000 0000.');
    if (f.businessName.trim().length < 2) return setErr('Enter your shop name.');
    completeSetup({ ...f, name: f.name.trim(), businessName: f.businessName.trim(), phone: phone.startsWith('0') ? phone : '0' + phone });
    if (['Foodstuff', 'Provisions'].includes(f.businessType) && !getState().products.length) {
      demoProducts().filter(x => STARTERS.includes(x.id)).forEach(({ id, updatedAt, ...x }) => saveProduct({ ...x, qty: p.demo ? Math.max(5, Number(x.qty) || 0) : 0 }));
    }
    next();
  }

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Your shop" sub="Step 1 of 3. Takes a minute." onBack={back} />
      <div className="wrap" style={{ marginTop: 8 }}>
        <Field label="Your name" pre={<UserRound size={18} />}><input value={f.name} onChange={set('name')} placeholder="e.g. Ngozi Okafor" autoComplete="name" /></Field>
        <Field label="Phone number" pre={<Phone size={18} />} hint="Your WhatsApp number, so you can record sales there too"><input value={f.phone} onChange={set('phone')} placeholder="0803 000 0000" inputMode="tel" autoComplete="tel" /></Field>
        <Field label="Shop name" pre={<Store size={18} />}><input value={f.businessName} onChange={set('businessName')} placeholder="e.g. Ngozi Provisions" /></Field>
        <span className="label">What do you sell?</span>
        <div className="chips">{TYPES.map(t => <button key={t} className="chip" aria-pressed={f.businessType === t} onClick={() => setF({ ...f, businessType: t })}>{t}</button>)}</div>
        <Field label="Market or area" pre={<MapPin size={18} />}><input value={f.city} onChange={set('city')} placeholder="e.g. Alaba Market, Lagos" /></Field>
        {err && <div className="error">{err}</div>}
        <button className="btn primary full" style={{ marginTop: 22, minHeight: 56 }} onClick={submit}>Continue</button>
      </div>
    </div>
  );
}
