export const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
export const nairaShort = n => { n = Number(n) || 0; return n >= 1e6 ? '₦' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm' : n >= 1e4 ? '₦' + Math.round(n / 1e3) + 'k' : naira(n); };
export const fmtQty = q => (Number.isInteger(q) ? String(q) : Number(q).toFixed(1));
export function qtyUnit(q, unit) {
  if (!unit) return fmtQty(q);
  const plural = q === 1 ? unit : (unit.endsWith('x') ? unit + 'es' : unit === 'kg' ? unit : unit + 's');
  return `${fmtQty(q)} ${plural}`;
}
export const DAY = 24 * 60 * 60 * 1000;
export const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export function timeAgo(t, now = Date.now()) {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}
export const clock = t => new Date(t).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
export const dateLabel = t => new Date(t).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });
export const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export function greeting(h = new Date().getHours()) { return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
