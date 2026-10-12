// Applies parsed commands to a trader's server-side snapshot (inventory + customers)
// so WhatsApp replies and questions are accurate even before the phone syncs.
'use strict';

function applyOp(trader, op) {
  const inv = trader.inventory || (trader.inventory = []);
  const customers = trader.customers || (trader.customers = []);
  const find = id => inv.find(p => p.id === id);
  if (op.type === 'sale') {
    for (const it of op.items) { const p = find(it.productId); if (p) p.qty = Math.max(0, (p.qty || 0) - it.qty); }
    if (op.balance > 0 && op.customer) {
      let c = op.customer.id && customers.find(x => x.id === op.customer.id);
      if (!c) c = customers.find(x => x.name.toLowerCase() === op.customer.name.toLowerCase());
      if (!c) { c = { id: 'wa_' + Date.now().toString(36), name: op.customer.name, balance: 0 }; customers.push(c); op.customer.id = c.id; }
      c.balance = (c.balance || 0) + op.balance;
    }
  } else if (op.type === 'restock') {
    for (const it of op.items) { const p = find(it.productId); if (p) p.qty = (p.qty || 0) + it.qty; }
  } else if (op.type === 'debt_payment' && op.customer) {
    const c = customers.find(x => x.id === op.customer.id) || customers.find(x => x.name.toLowerCase() === String(op.customer.name).toLowerCase());
    if (c) c.balance = Math.max(0, (c.balance || 0) - op.amount);
  }
}

function naira(n) { return '₦' + Math.round(n).toLocaleString('en-NG'); }

// Answers to questions asked on WhatsApp, using the snapshot.
function answer(trader, q) {
  const inv = trader.inventory || [];
  const lang = trader.language || 'en';
  const T = phrases[lang] || phrases.en;
  switch (q.type) {
    case 'query_stock': {
      const p = inv.find(x => x.id === q.productId);
      return p ? T.stock(p.name, p.qty || 0, p.unit || '') : T.openApp;
    }
    case 'query_low_stock': {
      const low = inv.filter(p => (p.qty || 0) <= (p.lowAt ?? 3));
      return low.length ? T.low(low.map(p => `${p.name} (${p.qty || 0})`).join(', ')) : T.allGood;
    }
    case 'query_debts': {
      const owing = (trader.customers || []).filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance);
      return owing.length ? T.debts(owing.slice(0, 5).map(c => `${c.name}: ${naira(c.balance)}`).join('\n')) : T.noDebts;
    }
    default:
      return T.openApp; // sales/profit/best-seller need full history: shown in the app
  }
}

// Short reply templates. Native speakers should review the Yoruba, Igbo and Hausa lines before launch.
const phrases = {
  en: {
    recorded: (n, total) => `✅ Recorded ${n} ${n === 1 ? 'entry' : 'entries'}${total ? `: ${naira(total)} in sales` : ''}. Open Vendora for details.`,
    stock: (name, qty, unit) => `${name}: ${qty} ${unit}${qty === 1 ? '' : 's'} left.`,
    low: list => `⚠️ Running low: ${list}`, allGood: 'Stock looks fine. Nothing is running low.',
    debts: list => `People owing you:\n${list}`, noDebts: 'Nobody owes you money right now. 👏',
    notUnderstood: 'Sorry, I did not get that. Try: "I sold 2 bags of rice to Emeka".',
    unknownItem: name => `I don't have "${name}" in your stock yet. Add it in the Vendora app first.`,
    voicePending: 'Voice note received 🎙️ Open Vendora to confirm it.',
    openApp: 'Open the Vendora app to see this.',
  },
  pcm: {
    recorded: (n, total) => `✅ I don record ${n}${total ? `, sales na ${naira(total)}` : ''}. Open Vendora to see everything.`,
    stock: (name, qty, unit) => `${name}: ${qty} ${unit} remain.`,
    low: list => `⚠️ These ones dey finish: ${list}`, allGood: 'Stock dey okay. Nothing dey finish.',
    debts: list => `People wey dey owe you:\n${list}`, noDebts: 'Nobody dey owe you now. 👏',
    notUnderstood: 'Abeg, I no understand. Try: "I sell 2 bag rice give Emeka".',
    unknownItem: name => `"${name}" never dey your stock. Add am for Vendora app first.`,
    voicePending: 'I don receive your voice note 🎙️ Open Vendora make you confirm am.',
    openApp: 'Open Vendora app to see am.',
  },
  yo: {
    recorded: (n, total) => `✅ Mo ti ko ${n} sile${total ? `: ${naira(total)}` : ''}. Si Vendora lati ri gbogbo re.`,
    stock: (name, qty, unit) => `${name}: ${qty} ${unit} lo ku.`,
    low: list => `⚠️ Awon wonyi ti fe tan: ${list}`, allGood: 'Oja re dara. Ko si eyi to fe tan.',
    debts: list => `Awon to je o ni gbese:\n${list}`, noDebts: 'Ko si eni to je o ni gbese bayi. 👏',
    notUnderstood: 'Ma binu, ko ye mi. Gbiyanju: "Mo ta apo iresi meji fun Emeka".',
    unknownItem: name => `"${name}" ko si ninu oja re. Fi kun ni Vendora na.`,
    voicePending: 'Mo ti gba ohun re 🎙️ Si Vendora lati jerisi.',
    openApp: 'Si Vendora lati ri eyi.',
  },
  ig: {
    recorded: (n, total) => `✅ Edebela m ${n}${total ? `: ${naira(total)}` : ''}. Mepee Vendora ka i hu ihe niile.`,
    stock: (name, qty, unit) => `${name}: ${qty} ${unit} foduru.`,
    low: list => `⚠️ Ndia na-agwu: ${list}`, allGood: 'Ngwa ahia gi di mma.',
    debts: list => `Ndi ji gi ugwo:\n${list}`, noDebts: 'O nweghi onye ji gi ugwo ugbu a. 👏',
    notUnderstood: 'Ndo, aghotaghi m. Nwaa: "Erere m akpa osikapa abuo nye Emeka".',
    unknownItem: name => `"${name}" anoghi na ngwa ahia gi. Tinye ya na Vendora.`,
    voicePending: 'Anatala m olu gi 🎙️ Mepee Vendora ka i kwado ya.',
    openApp: 'Mepee Vendora ka i hu nke a.',
  },
  ha: {
    recorded: (n, total) => `✅ Na rubuta ${n}${total ? `: ${naira(total)}` : ''}. Bude Vendora don ganin komai.`,
    stock: (name, qty, unit) => `${name}: ${qty} ${unit} ya rage.`,
    low: list => `⚠️ Wadannan suna karewa: ${list}`, allGood: 'Kayanka suna nan lafiya.',
    debts: list => `Masu bin ka bashi:\n${list}`, noDebts: 'Babu wanda ke bin ka bashi yanzu. 👏',
    notUnderstood: 'Yi hakuri, ban gane ba. Gwada: "Na sayar da buhu shinkafa biyu wa Musa".',
    unknownItem: name => `"${name}" baya cikin kayanka. Saka shi a Vendora tukuna.`,
    voicePending: 'Na karbi sakon muryarka 🎙️ Bude Vendora don tabbatarwa.',
    openApp: 'Bude Vendora don ganin wannan.',
  },
};

module.exports = { applyOp, answer, phrases, naira };
