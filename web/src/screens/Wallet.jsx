import React, { useEffect, useState } from 'react';
import { QrCode, ScanLine, Copy, Landmark, ShoppingBag, PackagePlus, HandCoins, Undo2, BookUser, Phone, MessageCircle, Plus, ShieldCheck, PiggyBank, ChevronRight, CircleAlert, CalendarClock, TrendingUp, BadgeCheck } from 'lucide-react';
import { useStore, Top, Sheet, Field, Seg, Toggle, Empty, initials } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { reverseTxn, recordDebtPayment, saveCustomer, getLoanOffer, repayLoan, updateProfile, setSavings, withdrawSavings, openAccount, toast, reopenCredit, isOwner, businessScoreNow, integrity } from '../lib/store.js';
import { naira, nairaShort, timeAgo, clock, qtyUnit, DAY } from '../lib/format.js';
import { evidenceMap, EVIDENCE } from '../lib/ledger.js';

const TYPE_ICON = { sale: ShoppingBag, restock: PackagePlus, debtPayment: HandCoins, income: Landmark, loanRepayment: Landmark };
const TYPE_TONE = { sale: 'royal', restock: 'leaf', debtPayment: 'kola', income: 'leaf', loanRepayment: 'ink' };

function txnTitle(t) {
  if (t.type === 'saleReversal') return 'Sale reversal';
  if (t.type === 'sale' || t.type === 'restock') return t.items.map(i => `${qtyUnit(i.qty, i.unit)} ${i.name}`).join(', ') || 'Sale';
  if (t.type === 'debtPayment') return `${t.customerName} paid debt`;
  if (t.type === 'loanRepayment') return 'Wema loan repayment';
  return t.note || 'Money received';
}
function payLabel(t) {
  if (t.syncStatus === 'rejected' || t.syncStatus === 'discarded') return 'Not posted · review Sync status';
  if (t.syncStatus === 'pending') return 'Saved on this device · pending sync';
  if (t.type === 'restock') return t.source === 'supplier' ? 'Delivered by verified seller' : 'Stock added';
  if (t.payStatus === 'verified') return 'Confirmed by Wema';
  if (t.payStatus === 'pending') return 'Waiting for transfer';
  if (t.payStatus === 'unverified') return 'Transfer not confirmed';
  if (t.payStatus === 'credit') return `${t.customerName || 'Customer'} owes`;
  return 'Cash';
}

/** One record in a list. Tapping it opens the details, where it can be cancelled (never deleted). */
export function TxnRow({ t }) {
  const [open, setOpen] = useState(false);
  const Icon = TYPE_ICON[t.type] || Landmark;
  const out = t.type === 'restock' || t.type === 'loanRepayment';
  const owed = t.type === 'sale' ? t.outstanding ?? t.amount - t.paid : 0;
  return (
    <>
      <button className="item" onClick={() => setOpen(true)} style={t.reversed ? { opacity: .55 } : undefined}>
        <span className={'avatar-sm ic ' + (TYPE_TONE[t.type] || 'ink')}><Icon size={19} /></span>
        <span className="grow">
          <div className="t clip" style={t.reversed ? { textDecoration: 'line-through' } : undefined}>{txnTitle(t)}</div>
          <div className="s clip">{t.reversed ? 'Cancelled' : payLabel(t)}{t.customerName && t.type === 'sale' ? `, ${t.customerName}` : ''}, {timeAgo(t.at)}</div>
        </span>
        <span style={{ textAlign: 'right' }}>
          <div className={'amt ' + (t.reversed ? '' : out ? '' : 'leaf')}>{out ? '−' : '+'}{naira(t.amount)}</div>
          {owed > 0 && !t.reversed && <div className="s pepper" style={{ fontWeight: 700 }}>{naira(owed)} owed</div>}
        </span>
      </button>
      {open && <TxnSheet t={t} onClose={() => setOpen(false)} />}
    </>
  );
}

function TxnSheet({ t, onClose }) {
  const s = useStore();
  const { go } = useNav();
  const [confirm, setConfirm] = useState(false);
  const ev = evidenceMap(s.ledger).get(t.id) || 'manual';
  const owner = isOwner(s);
  return (
    <Sheet title={txnTitle(t)} sub={`${new Date(t.at).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(t.at)}`} onClose={onClose}>
      <div className="card">
        {t.items?.map((i, k) => <div key={k} className="kv"><span>{qtyUnit(i.qty, i.unit)} {i.name}</span><b>{naira(i.qty * i.price)}</b></div>)}
        <div className="kv"><span>Total</span><b>{naira(t.amount)}</b></div>
        {t.type === 'sale' && t.amount !== t.paid && <div className="kv"><span>Paid now</span><b>{naira(t.paid)}</b></div>}
        {t.customerName && <div className="kv"><span>Customer</span><b>{t.payerName || t.customerName}</b></div>}
        <div className="kv"><span>Recorded by</span><b>{t.staffName || s.profile.name}</b></div>
        <div className="kv"><span>Proof</span><b className={EVIDENCE[ev]?.verified ? 'leaf' : ''}>{EVIDENCE[ev]?.label || 'Typed in'}</b></div>
      </div>
      {t.reversed && <div className="banner amber" style={{ marginTop: 12 }}><Undo2 size={20} /><span>Cancelled: {t.reversedReason}. It stays in your records so nothing is hidden.</span></div>}
      {t.type === 'sale' && !t.reversed && (t.payStatus === 'pending' || t.payStatus === 'unverified') && (
        <button className="btn soft full" style={{ marginTop: 12 }} onClick={() => { onClose(); go('confirm', { amount: t.paid || t.amount, txnId: t.id, sender: t.customerName || '' }); }}><ScanLine size={18} />Check the customer's receipt</button>
      )}
      {!t.reversed && owner && ['sale', 'restock', 'debtPayment'].includes(t.type) && (confirm ? (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Cancel this record?</b>
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>Stock and debts go back to how they were. The cancelled record stays visible to you and to Wema.</div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn plain grow" onClick={() => setConfirm(false)}>Keep it</button>
            <button className="btn danger grow" onClick={async () => { try {
              await reverseTxn(t.id, 'Cancelled by owner'); toast('Cancellation saved.'); onClose();
            } catch (error) { toast(error.message, 'bad'); } }}>Cancel record</button>
          </div>
        </div>
      ) : <button className="btn plain full" style={{ marginTop: 12 }} onClick={() => setConfirm(true)}><Undo2 size={18} />This was a mistake</button>)}
    </Sheet>
  );
}

export default function Wallet({ seg: initial }) {
  const s = useStore();
  const [seg, setSeg] = useState(initial || 'payments');
  const owner = isOwner(s);
  const segs = [['payments', 'Payments'], ['debts', 'Debts'], ...(owner ? [['loans', 'Loans'], ['savings', 'Savings']] : [])];
  return (
    <div className="page with-nav">
      <Top title="Wallet" sub="Your Wema account, debts and loans" tall />
      <div className="wrap over">
        <BankCard />
        <div style={{ marginTop: 16 }}><Seg value={seg} onChange={setSeg} options={segs} label="Wallet sections" /></div>
        <div style={{ marginTop: 14 }}>
          {seg === 'payments' && <Payments />}
          {seg === 'debts' && <Debts />}
          {seg === 'loans' && <Loans />}
          {seg === 'savings' && <Savings />}
        </div>
      </div>
    </div>
  );
}

function BankCard() {
  const s = useStore();
  const p = s.profile;
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const today = Date.now() - DAY;
  const inToday = s.credits.filter(c => c.at >= today).reduce((a, c) => a + c.amount, 0);
  if (!p.accountNumber) {
    return (
      <div className="bankcard" style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Open your Wema account</div>
        <div style={{ opacity: .85, fontSize: 14, marginTop: 4, lineHeight: 1.4 }}>Customers pay into it, Vendora confirms every transfer, and it unlocks Wema restock loans.</div>
        <div className="field" style={{ marginTop: 14, border: 0 }}>
          <input value={id} onChange={e => setId(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="Your BVN or NIN (11 digits)" aria-label="BVN or NIN" style={{ color: 'var(--text)' }} />
        </div>
        {err && <div style={{ color: '#dfdfdf', fontWeight: 600, fontSize: 13.5, marginTop: 8 }}>{err}</div>}
        <button className="btn kola full" style={{ marginTop: 12 }} disabled={busy || id.length !== 11} onClick={async () => {
          setBusy(true); setErr('');
          try { await openAccount(id); toast('Your Wema account is ready.', 'good'); } catch (e) { setErr(e.message); } finally { setBusy(false); }
        }}>{busy ? 'Opening account…' : 'Open account'}</button>
      </div>
    );
  }
  return (
    <div className="bankcard" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="row between">
        <b style={{ fontSize: 15 }}>Wema Bank</b>
        <span className="pill" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}><ShieldCheck size={13} />Linked</span>
      </div>
      <div className="acct" style={{ marginTop: 18 }}>{p.accountNumber.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')}</div>
      <div className="row between" style={{ marginTop: 6 }}>
        <span style={{ opacity: .85, fontSize: 13.5 }} className="clip">{p.accountName}</span>
        <button className="pill" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', minHeight: 32 }} onClick={() => navigator.clipboard?.writeText(p.accountNumber).then(() => toast('Account number copied.')).catch(() => {})}><Copy size={13} />Copy</button>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.18)', fontSize: 13.5 }}>
        <span style={{ opacity: .8 }}>Transfers received in the last 24 hours</span> <b style={{ float: 'right' }}>{naira(inToday)}</b>
      </div>
    </div>
  );
}

function Payments() {
  const s = useStore();
  const { go } = useNav();
  const [filter, setFilter] = useState('all');
  const [n, setN] = useState(25);
  const unmatched = s.credits.filter(c => !c.handled);
  const pending = s.txns.filter(t => t.type === 'sale' && !t.reversed && (t.payStatus === 'pending' || t.payStatus === 'unverified'));
  const list = s.txns.filter(t => filter === 'all' || (filter === 'sales' ? t.type === 'sale' : filter === 'stock' ? t.type === 'restock' : ['debtPayment', 'income', 'loanRepayment'].includes(t.type)));
  return (
    <>
      <div className="actions" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="action" onClick={() => go('getpaid')}><span className="ic ink"><QrCode size={22} /></span>Collect transfer</button>
        <button className="action" onClick={() => go('confirm')}><span className="ic amber"><ScanLine size={22} /></span>Check a receipt</button>
      </div>
      {unmatched.map(c => (
        <button key={c.id} className="banner leaf" style={{ marginTop: 12 }} onClick={() => reopenCredit(c.id)}>
          <Landmark size={22} />
          <span className="grow"><b>{naira(c.amount)} from {c.senderName}</b><br />{timeAgo(c.at)}. Tap to say what it was for</span>
          <ChevronRight size={18} />
        </button>
      ))}
      {pending.slice(0, 3).map(t => (
        <button key={t.id} className="banner amber" style={{ marginTop: 12 }} onClick={() => go('confirm', { amount: t.paid || t.amount, txnId: t.id, sender: t.customerName || '' })}>
          <CircleAlert size={22} />
          <span className="grow"><b>{naira(t.amount)} transfer not confirmed yet</b><br />{txnTitle(t)}. Tap to check the receipt</span>
          <ChevronRight size={18} />
        </button>
      ))}
      <div className="h2">All records</div>
      <div className="chips scroll" style={{ marginBottom: 12 }}>
        {[['all', 'All'], ['sales', 'Sales'], ['stock', 'Stock in'], ['money', 'Money in']].map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {list.length ? (
        <div className="list">{list.slice(0, n).map(t => <TxnRow key={t.id} t={t} />)}</div>
      ) : <Empty icon={ShoppingBag} title="Nothing here yet" body="Your sales and payments show up here as you record them." action={<button className="btn primary" onClick={() => go('sell')}>Record a sale</button>} />}
      {list.length > n && <button className="btn plain full" style={{ marginTop: 12 }} onClick={() => setN(n + 25)}>Show more</button>}
    </>
  );
}

function Debts() {
  const s = useStore();
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const owing = s.customers.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance);
  const cleared = s.customers.filter(c => !(c.balance > 0));
  const total = owing.reduce((a, c) => a + c.balance, 0);
  const cust = open && s.customers.find(c => c.id === open);
  return (
    <>
      <div className="card row">
        <span className="ic pepper" style={{ width: 48, height: 48, borderRadius: 16, display: 'grid', placeItems: 'center' }}><BookUser size={24} /></span>
        <div className="grow">
          <div className="small" style={{ fontWeight: 700 }}>Customers owe you</div>
          <div className="money md">{naira(total)}</div>
        </div>
        <span className="pill grey">{owing.length} {owing.length === 1 ? 'person' : 'people'}</span>
      </div>
      <div className="h2">Who is owing <button className="more" onClick={() => setAdding(true)}><Plus size={14} style={{ verticalAlign: -2 }} /> Add</button></div>
      {owing.length ? (
        <div className="list">
          {owing.map(c => (
            <button key={c.id} className="item" onClick={() => setOpen(c.id)}>
              <span className="avatar-sm ic pepper">{initials(c.name)}</span>
              <span className="grow"><div className="t clip">{c.name}</div><div className="s">{c.phone || 'Tap to record a payment'}</div></span>
              <span className="amt pepper">{naira(c.balance)}</span>
            </button>
          ))}
        </div>
      ) : <Empty icon={BookUser} title="Nobody owes you" body="When you sell on credit, choose 'Owe me' at checkout and the debt appears here." />}
      {cleared.length > 0 && <>
        <div className="h2">Paid up</div>
        <div className="list">
          {cleared.slice(0, 8).map(c => (
            <button key={c.id} className="item" onClick={() => setOpen(c.id)}>
              <span className="avatar-sm ic leaf">{initials(c.name)}</span>
              <span className="grow"><div className="t clip">{c.name}</div><div className="s">No debt</div></span>
              <BadgeCheck size={20} className="leaf" />
            </button>
          ))}
        </div>
      </>}
      {cust && <DebtSheet c={cust} onClose={() => setOpen(null)} />}
      {adding && <AddCustomer onClose={() => setAdding(false)} />}
    </>
  );
}

function DebtSheet({ c, onClose }) {
  const s = useStore();
  const [amt, setAmt] = useState('');
  const [phone, setPhone] = useState(c.phone || '');
  const history = s.txns.filter(t => t.customerId === c.id).slice(0, 6);
  const chips = c.balance > 0 ? [...new Set([c.balance, Math.round(c.balance / 2 / 100) * 100, 1000, 5000].filter(v => v > 0 && v <= c.balance))] : [];
  const msg = encodeURIComponent(`Hello ${c.name.split(' ')[0]}, this is ${s.profile.businessName}. A friendly reminder that your balance is ${naira(c.balance)}. You can pay to Wema Bank ${s.profile.accountNumber || ''} ${s.profile.accountName || ''}. Thank you!`);
  const wa = phone ? `https://wa.me/234${phone.replace(/\D/g, '').replace(/^0/, '')}?text=${msg}` : `https://wa.me/?text=${msg}`;
  async function pay(v) {
    const n = Number(v);
    if (!(n > 0)) return;
    try {
    await recordDebtPayment(c.id, Math.min(n, c.balance));
    toast(`${naira(Math.min(n, c.balance))} from ${c.name} recorded.`, 'good');
    setAmt('');
    } catch (error) { toast(error.message, 'bad'); }
  }
  return (
    <Sheet title={c.name} sub={c.balance > 0 ? `Owes ${naira(c.balance)}` : 'No debt'} onClose={onClose}>
      {c.balance > 0 && <>
        <span className="label" style={{ marginTop: 4 }}>They paid</span>
        <div className="chips">{chips.map(v => <button key={v} className="chip" onClick={() => pay(v)}>{v === c.balance ? `All, ${naira(v)}` : naira(v)}</button>)}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <div className="field grow"><span className="pre">₦</span><input value={amt} onChange={e => setAmt(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Other amount" aria-label="Other amount" /></div>
          <button className="btn primary" disabled={!(Number(amt) > 0)} onClick={() => pay(amt)}>Record</button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <a className="btn wa grow" style={{ textDecoration: 'none' }} href={wa} target="_blank" rel="noreferrer"><MessageCircle size={18} />Remind on WhatsApp</a>
          {phone && <a className="btn plain" style={{ textDecoration: 'none' }} href={`tel:${phone}`} aria-label={`Call ${c.name}`}><Phone size={18} /></a>}
        </div>
      </>}
      {!c.phone && (
        <div className="row" style={{ marginTop: 14 }}>
          <div className="field grow"><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="Add their phone number" aria-label="Phone number" /></div>
          <button className="btn soft" disabled={phone.replace(/\D/g, '').length < 10} onClick={() => { saveCustomer({ id: c.id, phone }); toast('Phone number saved.'); }}>Save</button>
        </div>
      )}
      {history.length > 0 && <><div className="h2" style={{ marginTop: 18 }}>History</div><div className="list">{history.map(t => <TxnRow key={t.id} t={t} />)}</div></>}
    </Sheet>
  );
}

function AddCustomer({ onClose }) {
  const [f, setF] = useState({ name: '', phone: '', balance: '' });
  return (
    <Sheet title="Add a customer" sub="For debts from before you started using Vendora" onClose={onClose}>
      <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Mama Tunde" autoFocus /></Field>
      <Field label="Phone (optional)"><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="0803 000 0000" /></Field>
      <Field label="They already owe (optional)" pre="₦"><input value={f.balance} onChange={e => setF({ ...f, balance: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="0" /></Field>
      <button className="btn primary full" style={{ marginTop: 18 }} disabled={f.name.trim().length < 2} onClick={() => { saveCustomer({ name: f.name.trim(), phone: f.phone, balance: Number(f.balance) || 0 }); toast('Customer added.'); onClose(); }}>Add customer</button>
    </Sheet>
  );
}

function Loans() {
  const s = useStore();
  const { go } = useNav();
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = s.loans.find(l => l.status === 'active');
  const past = s.loans.filter(l => l.status !== 'active');
  const score = businessScoreNow();
  const integ = integrity(s);
  useEffect(() => { let on = true; getLoanOffer().then(o => on && setOffer(o)).catch(e => on && setOffer({ eligible: false, reason: e.message })); return () => { on = false; }; }, [s.loans.length, s.profile.accountNumber]);

  async function pay(l, amount) {
    setBusy(true);
    try { await repayLoan(l.id, amount); toast(`${naira(amount)} repaid to Wema.`, 'good'); } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {active ? (
        <div className="card">
          <div className="row between">
            <b style={{ fontSize: 16 }}>Wema Restock Loan</b>
            <span className="pill royal">Active</span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>Paid to {active.supplierName}, {timeAgo(active.createdAt)}</div>
          <div className="row between" style={{ marginTop: 16, alignItems: 'flex-end' }}>
            <div><div className="small">Left to pay</div><div className="money md">{naira(active.totalRepayable - active.repaid)}</div></div>
            <div style={{ textAlign: 'right' }}><div className="small">of</div><b>{naira(active.totalRepayable)}</b></div>
          </div>
          <div className="meter leaf" style={{ marginTop: 10 }}><div style={{ width: `${Math.round(active.repaid / active.totalRepayable * 100)}%` }} /></div>
          <div className="kv" style={{ marginTop: 6 }}><span><CalendarClock size={15} style={{ verticalAlign: -2 }} /> Daily repayment</span><b>{naira(active.dailyRepayment)}</b></div>
          <div className="kv"><span>Finish by</span><b>{new Date(active.dueAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}</b></div>
          <div className="kv"><span>Pay automatically each day</span><Toggle on={s.profile.autoRepay} onChange={v => updateProfile({ autoRepay: v })} label="Pay automatically each day" /></div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn soft grow" disabled={busy} onClick={() => pay(active, active.dailyRepayment)}>Pay {nairaShort(active.dailyRepayment)}</button>
            <button className="btn primary grow" disabled={busy} onClick={() => pay(active, active.totalRepayable - active.repaid)}>Pay it all</button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ background: 'linear-gradient(160deg, #1a1a1a, #3d3d3d)', color: '#fff' }}>
          <div className="row between">
            <b style={{ fontSize: 16 }}>Wema Restock Loan</b>
            <span className="pill" style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>No paperwork</span>
          </div>
          {!offer ? <div className="skel" style={{ height: 70, marginTop: 14, opacity: .25 }} /> : offer.eligible ? <>
            <div style={{ color: '#c9c9c9', fontSize: 13.5, marginTop: 14 }}>You can get up to</div>
            <div className="money" style={{ color: 'var(--kola-2)' }}>{naira(offer.limit)}</div>
            <div style={{ color: '#c9c9c9', fontSize: 13.5, marginTop: 6 }}>{(offer.rate * 100).toFixed(1)}% flat for {offer.tenorDays} days. Paid straight to your seller. Repay a little each day from your sales.</div>
            <button className="btn kola full" style={{ marginTop: 16 }} onClick={() => go('loan')}>Get restock loan</button>
          </> : <>
            <div style={{ fontSize: 15, marginTop: 14, lineHeight: 1.45 }}>{offer.reason}</div>
            <button className="btn kola full" style={{ marginTop: 16 }} onClick={() => go('score')}>See how to qualify</button>
          </>}
        </div>
      )}
      {!integ.ok && <div className="banner pepper" style={{ marginTop: 12 }}><CircleAlert size={20} /><span className="grow">Some records were changed after they were saved, so loans are paused. <button className="link" style={{ padding: 0 }} onClick={() => go('records')}>See records</button></span></div>}
      <button className="card row" style={{ width: '100%', marginTop: 12, textAlign: 'left' }} onClick={() => go('score')}>
        <TrendingUp size={22} className="royal" />
        <span className="grow"><b>Business Score {score.score}, {score.band}</b><div className="small">Every sale you record raises your limit</div></span>
        <ChevronRight size={18} className="muted" />
      </button>
      <div className="h2">How it works</div>
      <div className="card gap" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
        {[['1', 'Pick what you need from a verified seller in the Vendors Hub.'], ['2', 'Wema pays the seller directly. No cash in hand, no middleman.'], ['3', 'Confirm delivery in Vendora and your stock updates itself.'], ['4', 'A small amount is repaid each day from your sales.']].map(([k, t]) => (
          <div key={k} className="row" style={{ alignItems: 'flex-start' }}><span className="pill royal" style={{ minWidth: 26, justifyContent: 'center' }}>{k}</span><span className="grow muted">{t}</span></div>
        ))}
      </div>
      {past.length > 0 && <>
        <div className="h2">Past loans</div>
        <div className="list">{past.map(l => (
          <div key={l.id} className="item"><span className="avatar-sm ic leaf"><BadgeCheck size={19} /></span><span className="grow"><div className="t">{naira(l.principal)} to {l.supplierName}</div><div className="s">Fully repaid</div></span></div>
        ))}</div>
      </>}
    </>
  );
}

function Savings() {
  const s = useStore();
  const sv = s.savings;
  const [w, setW] = useState('');
  return (
    <>
      <div className="card">
        <div className="row">
          <span className="ic leaf" style={{ width: 48, height: 48, borderRadius: 16, display: 'grid', placeItems: 'center' }}><PiggyBank size={24} /></span>
          <div className="grow"><div className="small" style={{ fontWeight: 700 }}>Saved so far</div><div className="money md">{naira(sv.balance)}</div></div>
        </div>
        <div className="kv" style={{ marginTop: 10 }}><span>Save part of each day's sales</span><Toggle on={sv.enabled} onChange={v => setSavings({ enabled: v })} label="Save part of each day's sales" /></div>
        {sv.enabled && <>
          <span className="label">How much of each day's sales?</span>
          <div className="chips">{[2, 5, 10, 15].map(p => <button key={p} className="chip" aria-pressed={sv.percent === p} onClick={() => setSavings({ percent: p })}>{p}%</button>)}</div>
          <div className="hint">Moved into Wema savings every night. Saving regularly also raises your Business Score.</div>
        </>}
      </div>
      {sv.balance > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Move money to your account</b>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field grow"><span className="pre">₦</span><input value={w} onChange={e => setW(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={String(sv.balance)} aria-label="Amount to move" /></div>
            <button className="btn soft" onClick={() => { withdrawSavings(Number(w) || sv.balance); setW(''); }}>Move</button>
          </div>
        </div>
      )}
      {sv.history.length > 0 && <>
        <div className="h2">History</div>
        <div className="list">{sv.history.slice(0, 14).map((h, i) => (
          <div key={i} className="item"><span className="grow"><div className="t">{h.amount < 0 ? 'Moved to account' : 'Saved from sales'}</div><div className="s">{new Date(h.day).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}</div></span><span className={'amt ' + (h.amount < 0 ? '' : 'leaf')}>{h.amount < 0 ? '−' : '+'}{naira(Math.abs(h.amount))}</span></div>
        ))}</div>
      </>}
    </>
  );
}
