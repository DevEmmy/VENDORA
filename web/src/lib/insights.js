// Derived numbers and advice computed from the trader's own records.
import { DAY, startOfDay, naira, qtyUnit } from './format.js';
import { businessScore } from './finance.js';
import { trustStats } from './ledger.js';

export const sales = txns => txns.filter(t => t.type === 'sale' && !t.reversed);
const inRange = (t, from, to) => t.at >= from && t.at < to;

export function periodRange(period, now = Date.now()) {
  const today = startOfDay(now);
  switch (period) {
    case 'yesterday': return [today - DAY, today];
    case 'week': return [today - 6 * DAY, now + 1];
    case 'month': return [today - 29 * DAY, now + 1];
    default: return [today, now + 1];
  }
}

export function totals(txns, period = 'today', now = Date.now()) {
  const [from, to] = periodRange(period, now);
  const s = sales(txns).filter(t => inRange(t, from, to));
  const revenue = s.reduce((a, t) => a + t.amount, 0);
  const cost = s.reduce((a, t) => a + t.items.reduce((b, i) => b + i.qty * (i.cost || 0), 0), 0);
  return { revenue, profit: revenue - cost, count: s.length, sales: s };
}

export function qtySold(txns, from, to) {
  const m = {};
  for (const t of sales(txns)) if (inRange(t, from, to)) for (const i of t.items) {
    const e = m[i.productId] || (m[i.productId] = { productId: i.productId, name: i.name, qty: 0, revenue: 0, unit: i.unit });
    e.qty += i.qty; e.revenue += i.qty * i.price;
  }
  return m;
}

export function weekly(txns, now = Date.now()) {
  const today = startOfDay(now);
  const days = [];
  for (let d = 6; d >= 0; d--) {
    const from = today - d * DAY;
    const total = sales(txns).filter(t => inRange(t, from, from + DAY)).reduce((a, t) => a + t.amount, 0);
    days.push({ label: 'SMTWTFS'[new Date(from).getDay()], total, isToday: d === 0, from });
  }
  const thisWeek = days.reduce((a, d) => a + d.total, 0);
  const lastWeek = sales(txns).filter(t => inRange(t, today - 13 * DAY, today - 6 * DAY)).reduce((a, t) => a + t.amount, 0);
  return { days, thisWeek, lastWeek, change: lastWeek ? (thisWeek - lastWeek) / lastWeek : 0 };
}

export function restockForecast(products, txns, now = Date.now()) {
  const sold = qtySold(txns, startOfDay(now) - 13 * DAY, now + 1);
  return products.map(p => {
    const perDay = (sold[p.id]?.qty || 0) / 14;
    const daysLeft = perDay > 0 ? p.qty / perDay : Infinity;
    return { product: p, perDay, daysLeft, suggestQty: Math.max(1, Math.ceil(perDay * 7 - p.qty)) };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function adviceCards(state, now = Date.now()) {
  const { txns, products } = state;
  const cards = [];
  const weekFrom = startOfDay(now) - 6 * DAY;
  const sold = Object.values(qtySold(txns, weekFrom, now + 1)).sort((a, b) => b.revenue - a.revenue);
  // best day of week over 30 days
  const byDow = Array(7).fill(0);
  for (const t of sales(txns)) if (t.at >= now - 30 * DAY) byDow[new Date(t.at).getDay()] += t.amount;
  const best = byDow.indexOf(Math.max(...byDow));
  if (sold[0]) {
    cards.push({ tone: 'orange', icon: '🔥', title: `${sold[0].name} is your top earner`,
      body: `You sold ${qtyUnit(sold[0].qty, sold[0].unit)} this week (${naira(sold[0].revenue)}). Stock up before ${DOW[best]}, your busiest day.`,
      ask: `How much ${sold[0].name} remain?` });
  }
  const slow = products.filter(p => p.qty > 0).map(p => ({ p, q: qtySold(txns, weekFrom, now + 1)[p.id]?.qty || 0 })).sort((a, b) => a.q - b.q)[0];
  if (slow && sold[0] && slow.p.id !== sold[0].productId) {
    cards.push({ tone: 'blue', icon: '📉', title: `${slow.p.name} is moving slowly`,
      body: `Only ${qtyUnit(slow.q, slow.p.unit)} sold this week. Bundle it with ${sold[0].name.replace(/ \(.*\)/, '')} or try a small discount.`,
      ask: 'Which item slow this week?' });
  }
  const w = totals(txns, 'week', now);
  if (w.revenue > 0) {
    const margin = w.profit / w.revenue;
    const pricey = [...products].sort((a, b) => (a.price - a.cost) / a.price - (b.price - b.cost) / b.price)[0];
    cards.push({ tone: 'green', icon: '💰', title: `Your profit margin is ${Math.round(margin * 100)}%`,
      body: margin >= 0.15 ? `That is good! To earn more, cut restock cost on ${pricey.name}: buy in bulk or straight from the distributor.` : `Your margin is thin. Check your prices on ${pricey.name}; it earns you the least per sale.`,
      ask: 'How much profit I make this week?' });
  }
  const f = restockForecast(products, txns, now).find(x => x.daysLeft < 4 && x.perDay > 0);
  if (f) {
    cards.push({ tone: 'red', icon: '📦', title: `${f.product.name} will finish ${f.daysLeft < 1 ? 'today' : `in about ${Math.round(f.daysLeft)} day${Math.round(f.daysLeft) === 1 ? '' : 's'}`}`,
      body: `You sell about ${f.perDay.toFixed(1)} ${f.product.unit}s a day. Restock ${qtyUnit(f.suggestQty, f.product.unit)} to last a week.`,
      action: { label: 'Restock with Wema loan', to: 'loan', amount: f.suggestQty * f.product.cost, productId: f.product.id }, ask: null });
  }
  return cards;
}

export function scoreFor(state, integrityOk = true, now = Date.now()) {
  const s = sales(state.txns).filter(t => t.at >= now - 30 * DAY).map(t => ({ amount: t.amount, at: t.at }));
  const collected = state.txns.filter(t => t.type === 'debtPayment' && !t.reversed && t.at >= now - 30 * DAY).reduce((a, t) => a + t.amount, 0);
  const outstanding = state.customers.reduce((a, c) => a + (c.balance || 0), 0);
  let loans = null;
  const relevant = state.loans || [];
  if (relevant.length) {
    let due = 0, onTime = 0;
    for (const l of relevant) {
      const elapsed = Math.min(l.tenorDays, Math.floor((now - l.createdAt) / DAY));
      due += elapsed; onTime += Math.min(elapsed, Math.floor(l.repaid / l.dailyRepayment));
    }
    loans = due > 0 ? { due, paidOnTime: onTime } : null;
  }
  const trust = trustStats(state.txns, state.ledger || [], now - 30 * DAY);
  return businessScore({ sales: s, debts: { collected, outstanding }, loans, verifiedShare: trust.total ? trust.verifiedShare : null, integrityOk, now });
}
