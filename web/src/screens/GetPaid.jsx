import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, CheckCircle2, Clock, Share2 } from 'lucide-react';
import { useStore, Top, Field } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { requestPayment, simulateCustomerPayment, toast } from '../lib/store.js';
import { naira, clock } from '../lib/format.js';

/** Collect a transfer: a one-time Wema account number for an exact amount. */
export default function GetPaid({ amount: preset }) {
  const s = useStore();
  const { back, go } = useNav();
  const [amount, setAmount] = useState(preset ? String(preset) : '');
  const [cust, setCust] = useState('');
  const [pr, setPr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = Number(amount) || 0;
  const quick = [1000, 2000, 5000, 10000, 20000];

  async function create() {
    setBusy(true); setErr('');
    try { setPr(await requestPayment({ amount: n, customerName: cust || null })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <Top title="Collect a transfer" sub="A one-time Wema account for this payment" onBack={back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        {!s.profile.accountNumber ? (
          <div className="card">
            <b>Open your Wema account first</b>
            <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>It takes a minute with your BVN or NIN.</div>
            <button className="btn primary full" style={{ marginTop: 14 }} onClick={() => go('wallet', { seg: 'payments' })}>Open account</button>
          </div>
        ) : pr ? <PaymentRequestView pr={pr} onDone={back} /> : (
          <div className="card">
            <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.45 }}>Selling items? Use <b>Sell</b> instead, so the stock updates too. Use this for any other payment.</div>
            <Field label="Amount" pre="₦"><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="0" autoFocus /></Field>
            <div className="chips" style={{ marginTop: 10 }}>{quick.map(v => <button key={v} className="chip" aria-pressed={n === v} onClick={() => setAmount(String(v))}>{naira(v)}</button>)}</div>
            <Field label="From (optional)"><input value={cust} onChange={e => setCust(e.target.value)} placeholder="Customer's name" /></Field>
            {err && <div className="error">{err}</div>}
            <button className="btn primary full" style={{ marginTop: 18 }} disabled={busy || n <= 0} onClick={create}>{busy ? 'Creating account…' : `Show account for ${n ? naira(n) : '₦0'}`}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PaymentRequestView({ pr, onDone }) {
  const s = useStore();
  const [qr, setQr] = useState('');
  const sale = pr.saleId && s.txns.find(t => t.id === pr.saleId);
  const credit = s.credits.find(c => c.paymentRequestRef === pr.ref);
  const paid = !!credit || (sale && sale.payStatus === 'verified');
  useEffect(() => {
    QRCode.toDataURL(`Wema Bank\n${pr.virtualAccountNumber}\n${s.profile.accountName}\nNGN ${pr.amount}`, { margin: 1, width: 320 }).then(setQr).catch(() => {});
  }, [pr]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = () => { navigator.clipboard?.writeText(pr.virtualAccountNumber).then(() => toast('Account number copied.')).catch(() => {}); };
  const share = encodeURIComponent(`Please pay ${naira(pr.amount)} to\nWema Bank\n${pr.virtualAccountNumber}\n${s.profile.accountName}`);

  if (paid) {
    return (
      <div className="card center">
        <CheckCircle2 size={60} className="leaf" />
        <h2 style={{ margin: '8px 0 4px' }}>Payment received</h2>
        <div className="money md">{naira(credit?.amount || pr.amount)}</div>
        <div className="muted" style={{ marginTop: 6 }}>From {credit?.senderName || sale?.payerName || 'customer'}. Confirmed by Wema{sale ? ', sale recorded' : ''}.</div>
        <button className="btn primary full" style={{ marginTop: 18 }} onClick={onDone}>Done</button>
      </div>
    );
  }
  return (
    <div>
      <div className="card center">
        <div className="small">Ask the customer to transfer exactly</div>
        <div className="money" style={{ margin: '4px 0 10px' }}>{naira(pr.amount)}</div>
        {qr && <img className="qr" src={qr} alt="Account details as a QR code" />}
        <div className="kv"><span>Bank</span><b>Wema Bank</b></div>
        <div className="kv"><span>Account number</span><b style={{ fontSize: 20, letterSpacing: 1.5 }}>{pr.virtualAccountNumber}</b></div>
        <div className="kv"><span>Name</span><b>{s.profile.accountName}</b></div>
        <div className="small" style={{ marginTop: 8 }}>Works for this payment only, until {clock(pr.expiresAt)}</div>
      </div>
      <div className="banner royal" style={{ marginTop: 12 }}>
        <Clock size={20} /><span className="grow">Waiting for the money. Vendora confirms it with Wema automatically, so you never need to trust an alert.</span>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn plain grow" onClick={copy}><Copy size={18} />Copy</button>
        <a className="btn wa grow" style={{ textDecoration: 'none' }} href={`https://wa.me/?text=${share}`} target="_blank" rel="noreferrer"><Share2 size={18} />Send</a>
      </div>
      {s.profile.demo && (
        <button className="link" style={{ display: 'block', margin: '12px auto 0' }} onClick={() => simulateCustomerPayment({ virtualAccountNumber: pr.virtualAccountNumber, amount: pr.amount, senderName: 'Emeka Chukwu' })}>Simulate the customer paying</button>
      )}
    </div>
  );
}
