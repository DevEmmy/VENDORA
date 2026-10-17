// GENERATED from server/src/parser.js by scripts/sync-shared.mjs. Do not edit here.
// Vendora command parser (reference implementation).
// The Flutter app has a line-for-line Dart port in lib/services/command_parser.dart.
// Keep the two in sync: tests in server/test/parser.test.js define the expected behaviour.


// ---------- normalisation ----------
function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalize(text) {
  let t = stripDiacritics(String(text || '').toLowerCase());
  t = t.replace(/₦/g, ' naira ');
  t = t.replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d),(\d{3})/g, '$1$2');
  t = t.replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  t = t.replace(/\bn(\d+)/g, '$1'); // "n5000" -> "5000"
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// ---------- vocabularies ----------
const NUMBER_WORDS = {
  // English / Pidgin
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, half: 0.5,
  // Yoruba
  okan: 1, kan: 1, meji: 2, meta: 3, merin: 4, marun: 5, mefa: 6, meje: 7, mejo: 8, mesan: 9, mewa: 10,
  ogun: 20, ogbon: 30,
  // Igbo
  otu: 1, abuo: 2, ato: 3, ano: 4, ise: 5, isii: 6, asaa: 7, asato: 8, itoolu: 9, iri: 10,
  // Hausa
  daya: 1, biyu: 2, uku: 3, hudu: 4, biyar: 5, shida: 6, bakwai: 7, takwas: 8, tara: 9, goma: 10, ashirin: 20,
};
const THOUSAND_WORDS = ['thousand', 'egberun', 'puku', 'dubu']; // en, yo, ig, ha
const HUNDRED_WORDS = ['hundred', 'ogorun', 'nari', 'dari'];

const UNIT_WORDS = {
  bag: 'bag', bags: 'bag', apo: 'bag', akpa: 'bag', buhu: 'bag', sack: 'bag', sacks: 'bag',
  carton: 'carton', cartons: 'carton', katon: 'carton',
  crate: 'crate', crates: 'crate', tin: 'tin', tins: 'tin', can: 'tin', cans: 'tin',
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack', piece: 'piece', pieces: 'piece', pcs: 'piece',
  bottle: 'bottle', bottles: 'bottle', gallon: 'gallon', gallons: 'gallon', keg: 'gallon', kegs: 'gallon',
  kg: 'kg', kilo: 'kg', kilos: 'kg', paint: 'paint', paints: 'paint', mudu: 'mudu', derica: 'derica', dericas: 'derica',
  roll: 'roll', rolls: 'roll', dozen: 'dozen', box: 'box', boxes: 'box',
};

// Common goods in local languages -> canonical English keyword
const PRODUCT_ALIASES = {
  iresi: 'rice', osikapa: 'rice', shinkafa: 'rice', raisi: 'rice',
  ewa: 'beans', agwa: 'beans', wake: 'beans',
  epo: 'oil', mmanu: 'oil', manu: 'oil', mai: 'oil',
  gari: 'garri', garri: 'garri',
  suga: 'sugar', sukari: 'sugar',
  iyo: 'salt', nnu: 'salt', gishiri: 'salt',
  ata: 'pepper', ose: 'pepper', barkono: 'pepper',
  tomati: 'tomato', tumatur: 'tomato',
  isu: 'yam', ji: 'yam', doya: 'yam',
  elubo: 'flour', fulawa: 'flour', flawa: 'flour',
  indomie: 'indomie', noodles: 'indomie', noodle: 'indomie',
  wara: 'milk', mmiri: 'water', omi: 'water', ruwa: 'water',
  ose_soap: 'soap', sabulu: 'soap', ncha: 'soap',
};

const VERBS = {
  sale: ['sold', 'sell', 'sale', 'selling', 'ta', 'tita', 'ree', 'rere', 'erere', 'rerela', 'erele', 'sayar', 'sayarwa'],
  restock: ['bought', 'buy', 'restock', 'restocked', 'received', 'ra', 'rara', 'zuru', 'zutara', 'zuta', 'saya', 'sayo', 'sayi', 'collect', 'collected', 'supply', 'supplied'],
  pay: ['paid', 'pay', 'payed', 'san', 'sanwo', 'kwuru', 'kwuo', 'kwughachiri', 'biya', 'balance'],
};
const CREDIT_WORDS = ['credit', 'gbese', 'bashi', 'ugwo', 'owe', 'owing', 'later'];
const AND_WORDS = ['and', 'ati', 'pelu', 'na', 'da', 'plus'];
const CUSTOMER_MARKERS = ['to', 'fun', 'nye', 'wa', 'ga', 'give'];
const STOP_FOR_NAME = new Set(['for', 'at', 'naira', 'and', 'ati', 'na', 'da', 'paid', 'pay', 'he', 'she', 'but', 'o', 'e', 'today', 'loni', 'taa', 'yau', 'on', 'with', 'balance', 'san', 'biya', 'kwuru']);
const FILLER = ['i', 'mo', 'm', 'na', 'don', 'have', 'has', 'just', 'ti', 'ka', 'ya', 'e', 'o', 'of', 'the', 'my', 'some', 'nke', 'ni'];
const TODAY_WORDS = ['today', 'loni', 'oni', 'taa', 'yau'];
const REMAIN_WORDS = ['remain', 'remaining', 'left', 'ku', 'seku', 'foduru', 'rage', 'stock', 'dey', 'how many', 'how much'];

// ---------- helpers ----------
function tokenize(t) { return t.split(' ').filter(Boolean); }
function levenshtein(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function similar(a, b) {
  if (a === b) return 1;
  const L = Math.max(a.length, b.length);
  return L ? 1 - levenshtein(a, b) / L : 0;
}
function hasAny(tokens, words) { return words.some(w => w.includes(' ') ? tokens.join(' ').includes(w) : tokens.includes(w)); }

// Read a number starting at index i. Returns {value, next} or null.
function readNumber(tokens, i) {
  let total = 0, cur = null, j = i, used = false;
  while (j < tokens.length) {
    const tk = tokens[j];
    if (/^\d+(\.\d+)?$/.test(tk)) { if (cur !== null && used) break; cur = (cur || 0) + parseFloat(tk); used = true; j++; continue; }
    if (tk in NUMBER_WORDS && !(['a', 'an', 'kan', 'na', 'ise', 'ji', 'tara', 'da'].includes(tk) && !isNumericContext(tokens, j))) {
      const v = NUMBER_WORDS[tk];
      cur = (cur || 0) + v; used = true; j++; continue;
    }
    if (THOUSAND_WORDS.includes(tk)) {
      // en: "five thousand" ; yo/ig/ha: "egberun marun" / "puku ise" / "dubu biyar"
      if (cur !== null) { total += cur * 1000; cur = null; j++; used = true; continue; }
      const nx = readSimple(tokens, j + 1);
      if (nx) { total += nx.value * 1000; j = nx.next; used = true; continue; }
      total += 1000; j++; used = true; continue;
    }
    if (HUNDRED_WORDS.includes(tk)) {
      if (cur !== null) { cur = cur * 100; j++; used = true; continue; }
      const nx = readSimple(tokens, j + 1);
      if (nx) { total += nx.value * 100; j = nx.next; used = true; continue; }
      cur = 100; j++; used = true; continue;
    }
    break;
  }
  if (!used) return null;
  return { value: total + (cur || 0), next: j };
}
function readSimple(tokens, i) {
  const tk = tokens[i];
  if (tk === undefined) return null;
  if (/^\d+$/.test(tk)) return { value: parseInt(tk, 10), next: i + 1 };
  if (tk in NUMBER_WORDS) return { value: NUMBER_WORDS[tk], next: i + 1 };
  return null;
}
// Ambiguous short words ("a", "na", "da", "kan"...) only count as numbers right before a unit or a product.
function isNumericContext(tokens, j) {
  const nx = tokens[j + 1];
  return nx !== undefined && (nx in UNIT_WORDS);
}

// ---------- product matching ----------
function productKeywords(p) {
  const words = new Set();
  for (const src of [p.name, ...(p.aliases || [])]) {
    for (const w of tokenize(normalize(src))) if (w.length > 1 && !(w in UNIT_WORDS) && !/^\d+$/.test(w) && w !== 'kg') words.add(w);
  }
  return [...words];
}
// Find best product mentioned in tokens[from..to). Returns {product, score, at}
function matchProduct(tokens, from, to, inventory) {
  let best = null;
  for (let i = from; i < to; i++) {
    let tk = tokens[i];
    if (tk in UNIT_WORDS || tk in NUMBER_WORDS || STOP_FOR_NAME.has(tk)) continue;
    const canon = PRODUCT_ALIASES[tk] || tk;
    for (const p of inventory) {
      const kws = productKeywords(p);
      for (const kw of kws) {
        let s = Math.max(similar(canon, kw), similar(tk, kw));
        // two-word product names ("peak milk", "tomato paste")
        if (i + 1 < to) s = Math.max(s, similar(tk + tokens[i + 1], kws.join('')));
        if (kw.length <= 3 && s < 1) s = 0; // short words must match exactly
        if (s >= 0.8 && (!best || s > best.score)) best = { product: p, score: s, at: i };
      }
    }
  }
  return best;
}

// ---------- customer ----------
function findCustomer(tokens, customers) {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!CUSTOMER_MARKERS.includes(tokens[i])) continue;
    const words = [];
    for (let j = i + 1; j < tokens.length && words.length < 3; j++) {
      const tk = tokens[j];
      if (STOP_FOR_NAME.has(tk) || /^\d/.test(tk) || tk in NUMBER_WORDS || tk in UNIT_WORDS) break;
      words.push(tk);
    }
    if (words.length) return resolveCustomer(words.join(' '), customers);
  }
  return null;
}
function resolveCustomer(raw, customers) {
  const name = raw.replace(/\b\w/g, c => c.toUpperCase());
  let best = null;
  for (const c of customers || []) {
    const s = similar(normalize(c.name), normalize(raw));
    if (s >= 0.75 && (!best || s > best.s)) best = { c, s };
  }
  return best ? { id: best.c.id, name: best.c.name, isNew: false } : { id: null, name, isNew: true };
}

// ---------- amounts ----------
// All money amounts with their context role: 'paid' | 'total' | 'any'
function findAmounts(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = readNumber(tokens, i);
    if (!n) continue;
    const prev = tokens[i - 1], next = tokens[n.next];
    const isMoney = n.value >= 50 || next === 'naira' || prev === 'naira' || THOUSAND_WORDS.includes(tokens[i]) || THOUSAND_WORDS.includes(tokens[n.next - 1]);
    const beforeUnit = next in UNIT_WORDS;
    if (isMoney && !beforeUnit) {
      const back = tokens.slice(Math.max(0, i - 3), i);
      const role = back.some(w => VERBS.pay.includes(w)) ? 'paid' : 'total';
      out.push({ value: n.value, role, at: i, end: n.next });
    }
    i = n.next - 1;
  }
  return out;
}

// ---------- line items ----------
function splitSegments(tokens, verbIdx) {
  const segs = []; let cur = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const isAnd = AND_WORDS.includes(tk) && !(tk === 'da' && VERBS.sale.includes(tokens[i - 1])) && !(tk === 'na' && i === 0);
    if (isAnd) { if (cur.length) segs.push(cur); cur = []; continue; }
    cur.push({ tk, i });
  }
  if (cur.length) segs.push(cur);
  return segs;
}
function extractItems(tokens, inventory, amounts) {
  const moneyIdx = new Set();
  for (const a of amounts) for (let k = a.at; k < a.end; k++) moneyIdx.add(k);
  const items = [], unknown = [];
  for (const seg of splitSegments(tokens)) {
    const segTokens = seg.map(s => s.tk), base = seg[0].i;
    let qty = null, unit = null;
    for (let k = 0; k < segTokens.length; k++) {
      if (moneyIdx.has(base + k)) continue;
      const n = readNumber(segTokens, k);
      if (n) {
        const after = segTokens[n.next];
        if (after in UNIT_WORDS) { qty = n.value; unit = UNIT_WORDS[after]; break; }
        // a small bare number followed by a product word
        if (n.value < 1000 && qty === null) qty = n.value;
        k = n.next - 1;
      } else if (segTokens[k] in UNIT_WORDS && qty === null) {
        // Yoruba/Igbo/Hausa often put the number after the unit: "apo meji" / "bags meji"
        const n2 = readNumber(segTokens, k + 1);
        if (n2 && !moneyIdx.has(base + k + 1)) { qty = n2.value; unit = UNIT_WORDS[segTokens[k]]; break; }
        unit = UNIT_WORDS[segTokens[k]];
      }
    }
    // number after the product word: "rice meji"
    const m = matchProduct(tokens, base, base + segTokens.length, inventory);
    if (m) {
      if (qty === null) {
        const after = readNumber(tokens, m.at + 1);
        if (after && after.value < 1000 && !moneyIdx.has(m.at + 1)) qty = after.value;
      }
      const existing = items.find(it => it.productId === m.product.id);
      if (existing) existing.qty += qty || 1;
      else items.push({ productId: m.product.id, name: m.product.name, qty: qty || 1, unit: unit || m.product.unit || null, price: m.product.price || 0 });
    } else if (qty !== null) {
      const guess = segTokens.filter((w, k) => !moneyIdx.has(base + k) && !(w in UNIT_WORDS) && !(w in NUMBER_WORDS) && !/^\d/.test(w)
        && !Object.values(VERBS).flat().includes(w) && !STOP_FOR_NAME.has(w) && !CUSTOMER_MARKERS.includes(w)
        && !FILLER.includes(w));
      if (guess.length) unknown.push({ name: guess.slice(0, 3).join(' '), qty, unit });
    }
  }
  return { items, unknown };
}

// ---------- queries ----------
function detectQuery(tokens, t, inventory) {
  const isQuestion = /\b(how|what|which|who|wetin|which|melo|elo|kini|tani|ole|kedu|onye|nawa|wane|wa ne|me|abin)\b/.test(t) || REMAIN_WORDS.some(w => t.includes(w));
  if (!isQuestion) return null;
  if (/\b(owe|owing|debt|gbese|bashi|ugwo|credit)\b/.test(t)) return { type: 'query_debts' };
  if (/\b(slow|no dey move|not moving|o lo|ko ta|adighi|baya tafiya)\b/.test(t)) return { type: 'query_slow' };
  if (/\b(best|top|pass|sell pass|most)\b/.test(t)) return { type: 'query_best' };
  if (/\b(finish|finishing|low|almost|tan|n tan|agwu|kare|karewa)\b/.test(t) && !matchProduct(tokens, 0, tokens.length, inventory)) return { type: 'query_low_stock' };
  if (/\b(profit|gain|ere|uru|riba)\b/.test(t)) return { type: 'query_profit', period: period(t) };
  const m = matchProduct(tokens, 0, tokens.length, inventory);
  if (m && /\b(remain|remaining|left|ku|seku|foduru|rage|stock|many|much|melo|ole|nawa|dey)\b/.test(t)) return { type: 'query_stock', productId: m.product.id, name: m.product.name };
  if (/\b(market|sell|sold|sales|sale|ta|ree|sayar|make|made|money|owo|ego|kudi)\b/.test(t)) return { type: 'query_sales', period: period(t) };
  return null;
}
function period(t) {
  if (/\b(yesterday|ana|unyahu|jiya)\b/.test(t)) return 'yesterday';
  if (/\b(week|ose|izu|mako)\b/.test(t)) return 'week';
  if (/\b(month|osu|onwa|wata)\b/.test(t)) return 'month';
  return 'today';
}

// ---------- main ----------
/**
 * parse(text, {inventory:[{id,name,aliases,unit,price}], customers:[{id,name}]})
 * Returns one of:
 *  {type:'sale', items, unknown, total, paid, balance, customer}
 *  {type:'restock', items, unknown, cost}
 *  {type:'debt_payment', customer, amount}
 *  {type:'query_*', ...}
 *  {type:'unknown'}
 */
function parse(text, ctx = {}) {
  const inventory = ctx.inventory || [], customers = ctx.customers || [];
  const t = normalize(text);
  const tokens = tokenize(t);
  if (!tokens.length) return { type: 'unknown', text: t };

  const has = list => tokens.some(tk => list.includes(tk));
  // Hausa: "sayar" = sell must win over "saya" = buy (different tokens, so fine).
  let verb = null;
  if (has(VERBS.sale) || /\bdon sell\b/.test(t)) verb = 'sale';
  else if (has(VERBS.restock)) verb = 'restock';
  else if (has(VERBS.pay)) verb = 'pay';

  // A question can contain a sales verb ("how much did I sell today"), with or without a question mark.
  const startsQ = /^(how|what|which|who|wetin|melo|elo|ole|nawa|kini|tani|kedu|abin)\b/.test(t);
  const q = verb === null || startsQ || /\?$/.test(String(text).trim()) ? detectQuery(tokens, t, inventory) : null;
  if (q && (verb === null || startsQ)) return q;

  const amounts = findAmounts(tokens);
  const { items, unknown } = extractItems(tokens, inventory, amounts);
  const customer = findCustomer(tokens, customers);

  if (verb === 'pay' && !items.length && !unknown.length) {
    const amt = amounts[0];
    // "<name> paid 2000" / "Baba Ayo san 2000"
    let cust = customer;
    if (!cust) {
      const pi = tokens.findIndex(tk => VERBS.pay.includes(tk));
      const nameWords = tokens.slice(0, pi).filter(w => !['i', 'mo', 'na', 'don', 'has', 'have', 'just', 'o', 'ti', 'e'].includes(w));
      if (nameWords.length) cust = resolveCustomer(nameWords.slice(-3).join(' '), customers);
    }
    if (amt) return { type: 'debt_payment', customer: cust, amount: amt.value };
  }

  if ((verb === 'sale' || verb === 'pay') && (items.length || unknown.length)) {
    const calc = items.reduce((s, it) => s + it.qty * (it.price || 0), 0);
    const totalAmt = amounts.find(a => a.role === 'total');
    const paidAmt = amounts.find(a => a.role === 'paid');
    const total = totalAmt ? totalAmt.value : calc;
    const credit = has(CREDIT_WORDS);
    const paid = paidAmt ? paidAmt.value : (credit ? 0 : total);
    return { type: 'sale', items, unknown, total, paid, balance: Math.max(0, total - paid), customer };
  }
  if (verb === 'restock' && (items.length || unknown.length)) {
    const amt = amounts.find(a => a.role === 'total');
    return { type: 'restock', items, unknown, cost: amt ? amt.value : null };
  }
  if (q) return q;
  return { type: 'unknown', text: t };
}

export { parse, normalize, readNumber, tokenize };
