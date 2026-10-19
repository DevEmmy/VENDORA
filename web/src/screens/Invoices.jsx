import React, { useMemo, useState } from 'react';
import { FileText, Share2, Printer, FileSpreadsheet, Send, ShieldCheck, CheckCircle2, BadgeCheck } from 'lucide-react';
import { useStore, Top, Sheet, Seg, Empty, SearchBar } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { invoiceFor, invoiceText, printInvoice, buildWorkbook, downloadBlob } from '../lib/records.js';
import { recordSubmission, businessScoreNow, isOwner, hasServer, wema, toast } from '../lib/store.js';
import { naira, qtyUnit, startOfDay, DAY, timeAgo } from '../lib/format.js';

const monthStart = (t = Date.now(), back = 0) => { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - back); return d.getTime(); };
const PERIODS = {
  today: ['Today', () => [startOfDay(), Date.now() + 1]],
  week: ['7 days', () => [startOfDay() - 6 * DAY, Date.now() + 1]],
  month: ['This month', () => [monthStart(), Date.now() + 1]],
  all: ['All', () => [0, Date.now() + 1]],
};
const SEND = {
  month: ['This month', () => [monthStart(), Date.now() + 1]],
  last: ['Last month', () => [monthStart(Date.now(), 1), monthStart()]],
  three: ['Last 3 months', () => [monthStart(Date.now(), 2), Date.now() + 1]],
};

function statusPill(inv) {
  if (inv.cancelled) return <span className="pill grey">Cancelled</span>;
  if (inv.balance > 0) return <span className="pill pepper">Owes {naira(inv.balance)}</span>;
  if (inv.verified) return <span className="pill leaf"><BadgeCheck size={12} />Confirmed</span>;
  if (inv.method.startsWith('Transfer')) return <span className="pill amber">Check payment</span>;
  return <span className="pill royal">Paid</span>;
}

export default function Invoices({ open: openId, seg: initialSeg }) {
  const s = useStore();
  const { back } = useNav();
  const owner = isOwner(s);
  const [seg, setSeg] = useState(initialSeg || 'invoices');
  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Invoices" sub="Every sale gets a numbered invoice" onBack={back}>
        {owner && <div style={{ marginTop: 14 }}><Seg value={seg} onChange={setSeg} options={[['invoices', 'Invoices', FileText], ['wema', 'Send to Wema', Send]]} label="Invoices sections" /></div>}
      </Top>
      <div className="wrap" style={{ marginTop: 16 }}>{seg === 'invoices' ? <List openId={openId} /> : <SendToWema />}</div>
    </div>
  );
}

function List({ openId }) {
  const s = useStore();
  const [period, setPeriod] = useState('month');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(openId || null);
  const [from, to] = PERIODS[period][1]();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const invs = useMemo(() => s.txns.filter(t => t.type === 'sale' && t.at >= from && t.at < to).map(t => invoiceFor(s, t))
    .filter(i => words.every(w => `${i.no} ${i.customer} ${i.items.map(x => x.name).join(' ')}`.toLowerCase().includes(w))), [s.txns, s.ledger, period, q]);
  const live = invs.filter(i => !i.cancelled);
  const total = live.reduce((a, i) => a + i.total, 0);
  const owed = live.reduce((a, i) => a + i.balance, 0);
  const sel = open && s.txns.find(t => t.id === open);
  return (
    <>
      <SearchBar value={q} onChange={setQ} placeholder="Invoice number, customer or item" label="Search invoices" />
      <div className="chips scroll" style={{ marginTop: 12 }}>{Object.entries(PERIODS).map(([k, [l]]) => <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      <div className="row" style={{ marginTop: 12, alignItems: 'stretch' }}>
        <div className="card grow" style={{ padding: 14 }}><div className="small" style={{ fontWeight: 700 }}>{live.length} invoices</div><div className="money md">{naira(total)}</div></div>
        <div className="card grow" style={{ padding: 14 }}><div className="small" style={{ fontWeight: 700 }}>Still owed</div><div className={'money md' + (owed ? ' pepper' : '')}>{naira(owed)}</div></div>
      </div>
      <div style={{ marginTop: 12 }}>{invs.length ? (
        <div className="list">{invs.slice(0, 120).map(i => (
          <button key={i.id} className="item" onClick={() => setOpen(i.id)} style={i.cancelled ? { opacity: .55 } : undefined}>
            <span className="avatar-sm ic royal"><FileText size={18} /></span>
            <span className="grow"><div className="t clip">{i.no}, {i.customer}</div><div className="s clip">{i.items.map(x => `${qtyUnit(x.qty, x.unit)} ${x.name}`).join(', ')}, {timeAgo(i.at)}</div></span>
            <span style={{ textAlign: 'right' }}><div className="amt">{naira(i.total)}</div><div style={{ marginTop: 4 }}>{statusPill(i)}</div></span>
          </button>
        ))}</div>
      ) : <Empty icon={FileText} title={q ? 'No invoice matches' : 'No invoices in this period'} body="Each sale you record makes an invoice automatically." />}</div>
      {sel && <InvoiceSheet t={sel} onClose={() => setOpen(null)} />}
    </>
  );
}

function InvoiceSheet({ t, onClose }) {
  const s = useStore();
  const inv = invoiceFor(s, t);
  const share = encodeURIComponent(invoiceText(inv));
  return (
    <Sheet title={`Invoice ${inv.no}`} sub={new Date(inv.at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} onClose={onClose}>
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><b style={{ fontSize: 16 }}>{inv.shop.name}</b><div className="small">{inv.shop.area}{inv.shop.cac ? `, ${inv.shop.cac}` : ''}</div></div>
          {statusPill(inv)}
        </div>
        <div className="small" style={{ marginTop: 10 }}>Bill to <b style={{ color: 'var(--text)' }}>{inv.customer}</b></div>
        <div className="hr" />
        {inv.items.map((x, k) => <div key={k} className="kv"><span>{qtyUnit(x.qty, x.unit)} {x.name}<div className="small">{naira(x.price)} each</div></span><b>{naira(x.qty * x.price)}</b></div>)}
        <div className="kv"><span><b>Total</b></span><b style={{ fontSize: 18 }}>{naira(inv.total)}</b></div>
        <div className="kv"><span>Paid</span><b>{naira(inv.paid)}</b></div>
        {inv.balance > 0 && <div className="kv"><span>Balance</span><b className="pepper">{naira(inv.balance)}</b></div>}
        <div className="kv"><span>Payment</span><b>{inv.method}</b></div>
        <div className="kv"><span>Proof</span><b className={inv.verified ? 'leaf' : ''}>{inv.proof}</b></div>
        <div className="kv"><span>Record seal</span><b style={{ fontSize: 12.5, fontFamily: 'inherit' }}>{inv.seal}</b></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <a className="btn wa grow" style={{ textDecoration: 'none' }} href={`https://wa.me/?text=${share}`} target="_blank" rel="noreferrer"><Share2 size={18} />Send</a>
        <button className="btn plain grow" onClick={() => printInvoice(inv)}><Printer size={18} />Print or PDF</button>
      </div>
    </Sheet>
  );
}

function SendToWema() {
  const s = useStore();
  const [period, setPeriod] = useState('month');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [from, to] = SEND[period][1]();
  const sales = s.txns.filter(t => t.type === 'sale' && !t.reversed && t.at >= from && t.at < to);
  const total = sales.reduce((a, t) => a + t.amount, 0);
  const score = businessScoreNow();

  async function make() { return buildWorkbook(s, { from, to, score }); }
  async function download() {
    setBusy('dl'); setErr('');
    try { const w = await make(); downloadBlob(w.blob, w.fileName); toast('Excel file saved to your phone.', 'good'); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function submit() {
    setBusy('send'); setErr('');
    try {
      const w = await make();
      let status = 'Received by Wema';
      if (hasServer()) {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(w.blob); });
        const resp = await wema().call('POST', '/api/submissions', { phone: s.profile.phone, accountNumber: s.profile.accountNumber, fileName: w.fileName, sha256: w.sha256, from, to, invoices: w.invoices, total: w.total, file: b64 });
        status = resp.status || status;
      } else { await new Promise(r => setTimeout(r, 700)); }
      recordSubmission({ id: `sub_${Date.now().toString(36)}`, at: Date.now(), fileName: w.fileName, sha256: w.sha256, from, to, invoices: w.invoices, total: w.total, verifiedShare: w.verifiedShare, score: score.score, status });
      toast('Records sent to Wema.', 'good');
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="card" style={{ background: 'linear-gradient(160deg, #0a1a47, #1f3b9a)', color: '#fff' }}>
        <div className="row"><ShieldCheck size={22} style={{ color: 'var(--kola-2)' }} /><b style={{ fontSize: 16 }}>Proof behind your Business Score</b></div>
        <div style={{ color: '#d7e0fb', fontSize: 14, marginTop: 8, lineHeight: 1.45 }}>Wema sees your score. This file lets them check it against every invoice, every payment Wema confirmed, every delivery and your sealed record. It makes your loan faster and harder for anyone to question.</div>
      </div>
      <span className="label">Which period?</span>
      <div className="chips">{Object.entries(SEND).map(([k, [l]]) => <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="kv"><span>Invoices</span><b>{sales.length}</b></div>
        <div className="kv"><span>Sales</span><b>{naira(total)}</b></div>
        <div className="kv"><span>Business Score</span><b>{score.score}, {score.band}</b></div>
        <div className="kv"><span>Inside the file</span><b style={{ fontWeight: 600, fontSize: 13 }}>Invoices, items, money in, deliveries, debts, loans, sealed record</b></div>
      </div>
      {err && <div className="error">{err}</div>}
      <button className="btn primary full" style={{ marginTop: 14, minHeight: 56 }} disabled={!!busy || !s.profile.accountNumber} onClick={submit}><Send size={19} />{busy === 'send' ? 'Sending to Wema…' : 'Submit to Wema'}</button>
      <button className="btn plain full" style={{ marginTop: 10 }} disabled={!!busy} onClick={download}><FileSpreadsheet size={19} />{busy === 'dl' ? 'Making the file…' : 'Download Excel file'}</button>
      {!s.profile.accountNumber && <div className="hint center">Open your Wema account in Wallet first.</div>}
      {s.submissions.length > 0 && <>
        <div className="h2">Sent to Wema</div>
        <div className="list">{s.submissions.slice(0, 12).map(x => (
          <div key={x.id} className="item">
            <CheckCircle2 size={22} className="leaf" />
            <span className="grow"><div className="t clip">{x.invoices} invoices, {naira(x.total)}</div><div className="s clip">{x.status}, {timeAgo(x.at)}. File check {x.sha256.slice(0, 12)}</div></span>
          </div>
        ))}</div>
        <div className="small" style={{ marginTop: 8 }}>The file check code is saved in your sealed record, so the file can't be changed after it was sent.</div>
      </>}
    </>
  );
}
