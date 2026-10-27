// Vendors Hub: verified bulk sellers. In production this list comes from the Vendora server, where every
// seller passes checks: Wema-verified business account, CAC registration, and a delivery track record on Vendora.
import { normalize } from './parser.js';

const SELLERS = [
  { id: 'v1', lat: 12.0717, lng: 8.4697, color: '#606060', about: 'Grains straight from northern farms. Bags weighed in front of you.', hours: 'Mon–Sat, 7am–6pm', name: 'Sule & Sons Grains', market: 'Dawanau Market', city: 'Kano', distanceKm: 14, rating: 4.9, reviews: 412, deliveryHours: 48, phone: '08031110001', accountNumber: '0211000011', cac: 'RC 1482211', trades: 2310, since: 2019,
    catalog: [['rice', 'Rice (50kg bag)', 'bag', 76000, 5], ['beans', 'Brown beans (50kg)', 'bag', 98000, 3], ['sugar', 'Sugar (50kg)', 'bag', 68500, 5]] },
  { id: 'v2', lat: 6.6067, lng: 3.4005, color: '#555555', about: 'Same-day delivery across Lagos. Cartons sealed from the factory.', hours: 'Mon–Sat, 6am–7pm', name: 'Bimbo Wholesale', market: 'Mile 12 Market', city: 'Lagos', distanceKm: 6, rating: 4.8, reviews: 268, deliveryHours: 6, phone: '08031110002', accountNumber: '0211000022', cac: 'BN 3390147', trades: 1188, since: 2020,
    catalog: [['rice', 'Rice (bag)', 'bag', 7050, 10], ['tomato', 'Tomato Paste (carton)', 'carton', 2850, 10], ['oil', 'Vegetable Oil (crate)', 'crate', 12650, 5], ['garri', 'Yellow Garri (paint)', 'paint', 1000, 20]] },
  { id: 'v3', lat: 5.118, lng: 7.341, color: '#6b6b6b', about: 'Provisions wholesaler for the south-east since 2018.', hours: 'Mon–Sat, 7am–6pm', name: 'Emeka Brothers Provisions', market: 'Ariaria Market', city: 'Aba', distanceKm: 22, rating: 4.7, reviews: 190, deliveryHours: 24, phone: '08031110003', accountNumber: '0211000033', cac: 'RC 1103398', trades: 864, since: 2018,
    catalog: [['milk', 'Peak Milk (carton)', 'carton', 7350, 5], ['indomie', 'Indomie (carton)', 'carton', 5150, 10], ['tomato', 'Tomato Paste (carton)', 'carton', 2900, 10], ['sugar', 'Sugar (50kg)', 'bag', 17200, 3]] },
  { id: 'v4', lat: 6.4627, lng: 3.1931, color: '#727272', about: 'Cash & carry prices on noodles, milk and oil. Open early.', hours: 'Daily, 6am–8pm', name: 'Alaba Cash & Carry', market: 'Alaba International', city: 'Lagos', distanceKm: 3, rating: 4.6, reviews: 341, deliveryHours: 4, phone: '08031110004', accountNumber: '0211000044', cac: 'RC 1720056', trades: 1560, since: 2021,
    catalog: [['indomie', 'Indomie (carton)', 'carton', 5200, 5], ['milk', 'Peak Milk (carton)', 'carton', 7400, 5], ['flour', 'Flour (bag)', 'bag', 21300, 2], ['oil', 'Vegetable Oil (crate)', 'crate', 12800, 3]] },
  { id: 'v5', lat: 7.4363, lng: 3.9165, color: '#878787', about: 'Garri and beans by the paint or the bag, Ibadan prices.', hours: 'Mon–Sat, 7am–5pm', name: 'Bodija Foodstuff Depot', market: 'Bodija Market', city: 'Ibadan', distanceKm: 118, rating: 4.8, reviews: 156, deliveryHours: 24, phone: '08031110005', accountNumber: '0211000055', cac: 'BN 2875510', trades: 702, since: 2017,
    catalog: [['garri', 'Yellow Garri (paint)', 'paint', 950, 30], ['beans', 'Brown beans (paint)', 'paint', 2100, 20], ['rice', 'Rice (bag)', 'bag', 7100, 10]] },
  { id: 'v6', lat: 12.001, lng: 8.52, color: '#545454', about: 'Flour and sugar for bakers and provision shops.', hours: 'Mon–Sat, 8am–6pm', name: 'Halima Flour & Sugar', market: 'Singer Market', city: 'Kano', distanceKm: 16, rating: 4.5, reviews: 98, deliveryHours: 48, phone: '08031110006', accountNumber: '0211000066', cac: 'BN 3011784', trades: 410, since: 2022,
    catalog: [['flour', 'Flour (bag)', 'bag', 20900, 5], ['sugar', 'Sugar (50kg)', 'bag', 17000, 5]] },
].map(v => ({ ...v, catalog: v.catalog.map(([key, name, unit, price, moq]) => ({ key, name, unit, price, moq })) }));

// Which catalog key does one of the trader's products belong to?
const KEYWORDS = {
  rice: ['rice', 'iresi', 'osikapa', 'shinkafa'], beans: ['beans', 'ewa', 'agwa', 'wake'], sugar: ['sugar', 'suga', 'sukari'],
  tomato: ['tomato', 'tomati', 'tumatur'], oil: ['oil', 'epo', 'mmanu', 'mai'], garri: ['garri', 'gari'],
  milk: ['milk', 'peak', 'wara'], indomie: ['indomie', 'noodles', 'noodle'], flour: ['flour', 'elubo', 'fulawa'],
};
export function keyFor(product) {
  const words = normalize([product.name, ...(product.aliases || [])].join(' ')).split(' ');
  for (const [k, list] of Object.entries(KEYWORDS)) if (words.some(w => list.includes(w))) return k;
  return null;
}

export function sellers() { return SELLERS; }
export function seller(id) { return SELLERS.find(s => s.id === id); }

/** Offers for one of the trader's products, cheapest first, comparable unit only. */
export function offersFor(product) {
  const k = keyFor(product);
  if (!k) return [];
  const samePack = c => !product.cost || (c.price > product.cost * 0.6 && c.price < product.cost * 1.4);
  return SELLERS.flatMap(s => s.catalog.filter(c => c.key === k && c.unit === product.unit && samePack(c)).map(c => ({ seller: s, item: c, saving: product.cost ? product.cost - c.price : 0 })))
    .sort((a, b) => a.item.price - b.item.price || a.seller.distanceKm - b.seller.distanceKm);
}

/** Every word typed must match somewhere (seller, market, city or an item). Clearing a word shows all. */
export function search(q, onlyKey = null) {
  const words = normalize(q || '').split(' ').filter(Boolean);
  return SELLERS.filter(s => (!onlyKey || s.catalog.some(c => c.key === onlyKey)) &&
    words.every(w => normalize([s.name, s.market, s.city, ...s.catalog.map(c => `${c.name} ${c.key} ${(KEYWORDS[c.key] || []).join(' ')}`)].join(' ')).includes(w)));
}

/** Item-level results: "rice" -> every rice offer, cheapest first. */
export function searchItems(q) {
  const words = normalize(q || '').split(' ').filter(Boolean);
  if (!words.length) return [];
  return SELLERS.flatMap(s => s.catalog.map(c => ({ seller: s, item: c })))
    .filter(({ seller: s, item: c }) => {
      const hay = normalize(`${c.name} ${c.key} ${(KEYWORDS[c.key] || []).join(' ')} ${s.name} ${s.market} ${s.city}`);
      const itemHay = normalize(`${c.name} ${c.key} ${(KEYWORDS[c.key] || []).join(' ')}`);
      return words.every(w => hay.includes(w)) && words.some(w => itemHay.includes(w));
    })
    .sort((a, b) => a.item.price - b.item.price);
}
