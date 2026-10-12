// Vendora's spoken/written replies in 5 languages.
// NOTE: Yoruba, Igbo and Hausa lines should be reviewed by native speakers before launch.
import { naira, qtyUnit } from './format.js';

export const LANGUAGES = [
  { code: 'en', label: 'English', speech: 'en-NG', tts: 'en-NG' },
  { code: 'pcm', label: 'Pidgin', speech: 'en-NG', tts: 'en-NG' },
  { code: 'yo', label: 'Yoruba', speech: 'yo-NG', tts: 'yo-NG' },
  { code: 'ig', label: 'Igbo', speech: 'ig-NG', tts: 'ig-NG' },
  { code: 'ha', label: 'Hausa', speech: 'ha-NG', tts: 'ha-NG' },
];
export const langLabel = code => (LANGUAGES.find(l => l.code === code) || LANGUAGES[0]).label;

const list = items => items.map(i => `${qtyUnit(i.qty, i.unit)} ${i.name}`).join(', ');

const R = {
  en: {
    sale: (items, total, bal, cust) => `Recorded: ${list(items)}${total ? ` for ${naira(total)}` : ''}.${bal > 0 ? ` ${cust} owes ${naira(bal)}.` : ''}`,
    restock: items => `Restocked: ${list(items)}.`,
    debtPaid: (cust, amt, left) => `${cust} paid ${naira(amt)}.${left > 0 ? ` Balance left: ${naira(left)}.` : ' Debt cleared!'}`,
    stock: (name, q, unit) => `You have ${qtyUnit(q, unit)} of ${name} left.`,
    stockOut: name => `${name} is out of stock. Restock soon.`,
    sales: (p, amt, n, best) => `${cap(enPeriod[p] || p)} you sold ${naira(amt)} from ${n} sale${n === 1 ? '' : 's'}.${best ? ` ${best} is your best seller.` : ''}`,
    noSales: p => `No sales recorded ${enPeriod[p] || p} yet.`,
    profit: (p, amt) => `Your profit ${enPeriod[p] || p} is ${naira(amt)} after cost.`,
    best: (name, q) => `${name} is your best seller this week: ${q} sold.`,
    slow: (name, q) => `${name} is moving slowly: only ${q} sold this week. Try a bundle or a small discount.`,
    debts: rows => `People owing you: ${rows}.`, noDebts: 'Nobody owes you money right now.',
    low: rows => `Running low: ${rows}.`, allGood: 'Your stock looks fine. Nothing is running low.',
    unknownItem: name => `"${name}" is not in your stock yet. Add it first, then try again.`,
    notUnderstood: 'Sorry, I did not get that. Try: "I sold 2 bags of rice to Emeka."',
    lowWarn: (name, q, unit) => `Only ${qtyUnit(q, unit)} of ${name} left. Restock soon?`,
  },
  pcm: {
    sale: (items, total, bal, cust) => `I don record am: ${list(items)}${total ? ` for ${naira(total)}` : ''}.${bal > 0 ? ` ${cust} dey owe ${naira(bal)}.` : ''}`,
    restock: items => `I don add am to your stock: ${list(items)}.`,
    debtPaid: (cust, amt, left) => `${cust} don pay ${naira(amt)}.${left > 0 ? ` E remain ${naira(left)}.` : ' E don clear finish!'}`,
    stock: (name, q, unit) => `${name}: you get ${qtyUnit(q, unit)} remain.`,
    stockOut: name => `${name} don finish. Restock quick quick.`,
    sales: (p, amt, n, best) => `Market dey move! ${cap(pcmPeriod(p))} you don sell ${naira(amt)} (${n} sales).${best ? ` ${best} na your best seller.` : ''}`,
    noSales: p => `You never record any sale ${pcmPeriod(p)}.`,
    profit: (p, amt) => `Your gain ${pcmPeriod(p)} na ${naira(amt)} after cost.`,
    best: (name, q) => `${name} dey sell pass this week: ${q} don go.`,
    slow: (name, q) => `${name} dey slow small: na only ${q} sell this week. Try bundle am.`,
    debts: rows => `People wey dey owe you: ${rows}.`, noDebts: 'Nobody dey owe you now.',
    low: rows => `These ones dey finish: ${rows}.`, allGood: 'Your stock dey okay.',
    unknownItem: name => `"${name}" never dey your stock. Add am first.`,
    notUnderstood: 'Abeg, I no catch am. Try: "I sell 2 bag rice give Emeka."',
    lowWarn: (name, q, unit) => `Na only ${qtyUnit(q, unit)} ${name} remain. You go restock?`,
  },
  yo: {
    sale: (items, total, bal, cust) => `Mo ti ko sile: ${list(items)}${total ? ` ni ${naira(total)}` : ''}.${bal > 0 ? ` ${cust} je o ni ${naira(bal)}.` : ''}`,
    restock: items => `Mo ti fi kun oja re: ${list(items)}.`,
    debtPaid: (cust, amt, left) => `${cust} ti san ${naira(amt)}.${left > 0 ? ` O ku ${naira(left)}.` : ' Gbese ti tan!'}`,
    stock: (name, q, unit) => `${name}: ${qtyUnit(q, unit)} lo ku.`,
    stockOut: name => `${name} ti tan. Ra si laipe.`,
    sales: (p, amt, n, best) => `O ti ta ${naira(amt)} ${yoPeriod(p)} (${n}).${best ? ` ${best} lo n ta julo.` : ''}`,
    noSales: p => `Ko si tita ${yoPeriod(p)}.`,
    profit: (p, amt) => `Ere re ${yoPeriod(p)} je ${naira(amt)}.`,
    best: (name, q) => `${name} lo n ta julo ni ose yii: ${q}.`,
    slow: (name, q) => `${name} ko ta pupo: ${q} nikan ni ose yii.`,
    debts: rows => `Awon to je o ni gbese: ${rows}.`, noDebts: 'Ko si eni to je o ni gbese.',
    low: rows => `Awon wonyi ti fe tan: ${rows}.`, allGood: 'Oja re dara.',
    unknownItem: name => `"${name}" ko si ninu oja re. Fi kun na.`,
    notUnderstood: 'Ma binu, ko ye mi. Gbiyanju: "Mo ta apo iresi meji fun Emeka."',
    lowWarn: (name, q, unit) => `${qtyUnit(q, unit)} ${name} lo ku. Se o fe ra si?`,
  },
  ig: {
    sale: (items, total, bal, cust) => `Edebela m: ${list(items)}${total ? ` maka ${naira(total)}` : ''}.${bal > 0 ? ` ${cust} ji gi ${naira(bal)}.` : ''}`,
    restock: items => `Etinyela m na ngwa ahia gi: ${list(items)}.`,
    debtPaid: (cust, amt, left) => `${cust} akwuola ${naira(amt)}.${left > 0 ? ` Ihe foduru: ${naira(left)}.` : ' Ugwo agwula!'}`,
    stock: (name, q, unit) => `${name}: ${qtyUnit(q, unit)} foduru.`,
    stockOut: name => `${name} agwula. Zutakwa ozo.`,
    sales: (p, amt, n, best) => `I rere ${naira(amt)} ${igPeriod(p)} (${n}).${best ? ` ${best} na-ere nke oma.` : ''}`,
    noSales: p => `O nweghi ihe i rere ${igPeriod(p)}.`,
    profit: (p, amt) => `Uru gi ${igPeriod(p)} bu ${naira(amt)}.`,
    best: (name, q) => `${name} na-ere karia izu a: ${q}.`,
    slow: (name, q) => `${name} adighi ere ngwa ngwa: naani ${q} izu a.`,
    debts: rows => `Ndi ji gi ugwo: ${rows}.`, noDebts: 'O nweghi onye ji gi ugwo.',
    low: rows => `Ndia na-agwu: ${rows}.`, allGood: 'Ngwa ahia gi di mma.',
    unknownItem: name => `"${name}" anoghi na ngwa ahia gi. Tinye ya mbu.`,
    notUnderstood: 'Ndo, aghotaghi m. Nwaa: "Erere m akpa osikapa abuo nye Emeka."',
    lowWarn: (name, q, unit) => `Naani ${qtyUnit(q, unit)} ${name} foduru. I ga-azuta ozo?`,
  },
  ha: {
    sale: (items, total, bal, cust) => `Na rubuta: ${list(items)}${total ? ` kan ${naira(total)}` : ''}.${bal > 0 ? ` ${cust} na bin ka ${naira(bal)}.` : ''}`,
    restock: items => `Na kara a kayanka: ${list(items)}.`,
    debtPaid: (cust, amt, left) => `${cust} ya biya ${naira(amt)}.${left > 0 ? ` Saura ${naira(left)}.` : ' Bashi ya kare!'}`,
    stock: (name, q, unit) => `${name}: ${qtyUnit(q, unit)} ya rage.`,
    stockOut: name => `${name} ya kare. Ka sayo wani.`,
    sales: (p, amt, n, best) => `Ka sayar da ${naira(amt)} ${haPeriod(p)} (${n}).${best ? ` ${best} ya fi sayuwa.` : ''}`,
    noSales: p => `Babu ciniki ${haPeriod(p)}.`,
    profit: (p, amt) => `Ribarka ${haPeriod(p)} ita ce ${naira(amt)}.`,
    best: (name, q) => `${name} ya fi sayuwa a wannan mako: ${q}.`,
    slow: (name, q) => `${name} baya tafiya sosai: ${q} kawai a wannan mako.`,
    debts: rows => `Masu bin ka bashi: ${rows}.`, noDebts: 'Babu wanda ke bin ka bashi.',
    low: rows => `Wadannan suna karewa: ${rows}.`, allGood: 'Kayanka suna lafiya.',
    unknownItem: name => `"${name}" baya cikin kayanka. Saka shi tukuna.`,
    notUnderstood: 'Yi hakuri, ban gane ba. Gwada: "Na sayar da buhu shinkafa biyu wa Musa."',
    lowWarn: (name, q, unit) => `${qtyUnit(q, unit)} ${name} kawai ya rage. Za ka sayo?`,
  },
};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const enPeriod = { today: 'today', yesterday: 'yesterday', week: 'this week', month: 'this month' };
const pcmPeriod = p => ({ today: 'today', yesterday: 'yesterday', week: 'this week', month: 'this month' }[p] || p);
const yoPeriod = p => ({ today: 'loni', yesterday: 'lana', week: 'ni ose yii', month: 'ni osu yii' }[p] || p);
const igPeriod = p => ({ today: 'taa', yesterday: 'unyahu', week: 'izu a', month: 'onwa a' }[p] || p);
const haPeriod = p => ({ today: 'yau', yesterday: 'jiya', week: 'a wannan mako', month: 'a wannan wata' }[p] || p);

export function replies(lang) {
  return R[lang] || R.en;
}
