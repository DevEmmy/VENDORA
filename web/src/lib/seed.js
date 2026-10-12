// Demo shop: "Mama Ngozi" at Alaba Market, with 30 days of history so the
// Business Score, insights and loan offer all work immediately in a demo.
import { DAY, startOfDay } from './format.js';

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const demoProducts = () => [
  { id: 'rice', name: 'Rice (bag)', aliases: ['iresi', 'osikapa', 'shinkafa'], unit: 'bag', price: 8500, cost: 7300, qty: 4, lowAt: 5 },
  { id: 'milk', name: 'Peak Milk', aliases: ['wara', 'milk'], unit: 'carton', price: 8400, cost: 7600, qty: 6, lowAt: 2 },
  { id: 'indomie', name: 'Indomie', aliases: ['noodles'], unit: 'carton', price: 6000, cost: 5300, qty: 6, lowAt: 2 },
  { id: 'tomato', name: 'Tomato Paste', aliases: ['tomati', 'tumatur'], unit: 'carton', price: 3600, cost: 3000, qty: 2, lowAt: 3 },
  { id: 'sugar', name: 'Sugar (50kg)', aliases: ['suga', 'sukari'], unit: 'bag', price: 19000, cost: 17600, qty: 0, lowAt: 1 },
  { id: 'oil', name: 'Vegetable Oil', aliases: ['epo', 'mmanu', 'mai'], unit: 'crate', price: 14400, cost: 13100, qty: 9, lowAt: 3 },
  { id: 'garri', name: 'Yellow Garri', aliases: ['gari'], unit: 'paint', price: 1500, cost: 1100, qty: 25, lowAt: 6 },
  { id: 'flour', name: 'Flour', aliases: ['elubo', 'fulawa'], unit: 'bag', price: 23500, cost: 22000, qty: 3, lowAt: 2 },
].map(p => ({ ...p, updatedAt: Date.now() - Math.floor(Math.random() * 3) * 3600e3 }));

export function buildDemo(now = Date.now()) {
  const r = rng(42);
  const products = demoProducts();
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const weights = [['rice', 30], ['indomie', 18], ['milk', 14], ['garri', 14], ['oil', 8], ['tomato', 6], ['flour', 4], ['sugar', 6]];
  const pick = () => { let x = r() * 100; for (const [id, w] of weights) { if ((x -= w) < 0) return id; } return 'rice'; };
  const names = ['Emeka', 'Amaka', 'Chidi', 'Bisi', 'Musa', 'Tunde', 'Halima', 'Uche', 'Kemi', 'Ifeanyi', null, null, null];
  const txns = [];
  let n = 0;
  const today = startOfDay(now);
  for (let d = 29; d >= 0; d--) {
    const dayStart = today - d * DAY;
    const dow = new Date(dayStart).getDay();
    if (dow === 0 && r() < 0.6) continue; // most Sundays closed
    let count = 4 + Math.floor(r() * 4) + (dow === 5 || dow === 6 ? 3 : 0);
    if (d === 0) count = Math.max(3, Math.round(count * Math.min(1, (now - dayStart) / (14 * 3600e3))));
    for (let k = 0; k < count; k++) {
      const id = pick(); const p = P[id];
      const qty = id === 'garri' ? 1 + Math.floor(r() * 4) : 1 + (r() < 0.25 ? 1 : 0);
      const at = Math.min(now - 60e3, dayStart + (7.5 + (k / count) * 10.5 + r() * 0.5) * 3600e3);
      const src = r(); const name = names[Math.floor(r() * names.length)];
      const amount = p.price * qty;
      const transfer = src < 0.45;
      txns.push({ id: `seed_${n++}`, type: 'sale', items: [{ productId: id, name: p.name, qty, unit: p.unit, price: p.price, cost: p.cost }],
        amount, paid: amount, customerName: name, source: transfer ? 'transfer' : src < 0.62 ? 'voice' : src < 0.8 ? 'tap' : 'whatsapp',
        payStatus: transfer ? 'verified' : 'cash', at, staffName: r() < 0.3 ? 'Tunde' : 'Mama Ngozi', staffId: null, note: '' });
    }
    if (d % 6 === 3) {
      const id = ['rice', 'indomie', 'milk', 'flour'][d % 4]; const p = P[id]; const qty = id === 'flour' ? 1 : 5;
      txns.push({ id: `seed_${n++}`, type: 'restock', items: [{ productId: id, name: p.name, qty, unit: p.unit, price: p.cost, cost: p.cost }], amount: p.cost * qty, paid: p.cost * qty, source: 'supplier', payStatus: 'cash', at: dayStart + 7 * 3600e3, note: 'Delivered by Bimbo Wholesale' });
    }
    if (d % 9 === 4) txns.push({ id: `seed_${n++}`, type: 'debtPayment', items: [], amount: 3000, paid: 3000, customerName: 'Baba Ayo', customerId: 'c_ayo', source: 'voice', payStatus: 'cash', at: dayStart + 12 * 3600e3, note: 'Debt payment' });
  }
  // A few hand-made recent entries that match the Figma screens
  const t = now - 40 * 60e3;
  txns.push(
    { id: 'seed_fig1', type: 'sale', items: [{ productId: 'rice', name: 'Rice (bag)', qty: 1, unit: 'bag', price: 8500, cost: 7300 }], amount: 8500, paid: 8500, customerName: 'Emeka', source: 'transfer', payStatus: 'verified', at: t, staffName: 'Mama Ngozi', note: '' },
    { id: 'seed_fig2', type: 'sale', items: [{ productId: 'indomie', name: 'Indomie', qty: 2, unit: 'carton', price: 6000, cost: 5300 }], amount: 12000, paid: 12000, customerName: 'Amaka', source: 'voice', payStatus: 'cash', at: t + 8 * 60e3, staffName: 'Tunde', note: '' },
    { id: 'seed_fig3', type: 'income', items: [], amount: 5000, paid: 5000, customerName: null, source: 'transfer', payStatus: 'unverified', at: t + 20 * 60e3, note: 'Unknown transfer' },
  );
  txns.sort((a, b) => b.at - a.at);

  const accountNumber = '0234187421';
  return {
    profile: { name: 'Ngozi Okafor', phone: '08030000000', email: '', businessName: 'Ngozi Provisions Store', businessType: 'Foodstuff', city: 'Alaba Market, Lagos', country: 'Nigeria', currency: 'NGN', language: 'pcm', accountNumber, accountName: 'NGOZI PROVISIONS STORE', onboarded: true, premium: true, consentShareData: true, whatsappLinked: true, whatsappAlerts: true, speakReplies: true, autoRepay: true, demo: true, location: { lat: 6.462712, lng: 3.193104, accuracy: 9, at: now - 20 * DAY } },
    products,
    txns,
    customers: [
      { id: 'c_emeka', name: 'Emeka', phone: '', balance: 0 }, { id: 'c_amaka', name: 'Amaka', phone: '', balance: 0 },
      { id: 'c_ayo', name: 'Baba Ayo', phone: '08031112222', balance: 2000 }, { id: 'c_chidi', name: 'Mama Chidi', phone: '08035556666', balance: 5500 },
      { id: 'c_bisi', name: 'Iya Bisi', phone: '', balance: 3000 },
    ],
    staff: [{ id: 'owner', name: 'Mama Ngozi', pin: '0000', isOwner: true }, { id: 's_tunde', name: 'Tunde', pin: '1234', isOwner: false }],
    currentStaffId: 'owner',
    savings: { enabled: true, percent: 5, balance: 38450, lastSavedDay: startOfDay(now) - DAY, history: [] },
    loans: [], paymentRequests: [], credits: [], chat: [],
    // Money already in the Wema account that the trader hasn't matched yet (used by "Confirm a payment")
    wemaMock: { accounts: { [accountNumber]: { accountNumber, accountName: 'NGOZI PROVISIONS STORE', phone: '08030000000', balance: 0 } }, requests: {}, loans: {},
      credits: [
        { id: 'cr_seed1', accountNumber, amount: 5000, senderName: 'Chidi Obi', senderBank: 'OPay', at: now - 25 * 60e3, reference: '100004251011193022184937265101' },
        { id: 'cr_seed2', accountNumber, amount: 12000, senderName: 'Chinedu Okeke', senderBank: 'GTBank', at: now - 12 * 60e3, reference: '100013251011194500918273645509' },
      ] },
    orders: [{ id: 'o_seed1', sellerId: 'v3', sellerName: 'Emeka Brothers Provisions', lines: [{ key: 'sugar', name: 'Sugar (50kg)', unit: 'bag', price: 17200, qty: 3, productId: 'sugar' }], total: 51600, pay: 'wallet', status: 'on the way', at: now - 20 * 3600e3, etaHours: 24 }],
    cac: { status: 'saving', number: null, application: null, plan: { daily: 500, target: 25000, saved: 17500, startedAt: now - 35 * DAY, lastDay: startOfDay(now) - DAY, history: [] } },
    advert: null, submissions: [],
    sync: { ackedThrough: 0, creditsSince: 0, lastSyncAt: null },
    alerts: [],
  };
}
