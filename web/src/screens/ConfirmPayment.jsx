import React, { useRef, useState } from 'react';
import { Camera, Keyboard, ShieldCheck, ShieldX, ImageUp, RotateCcw } from 'lucide-react';
import { useStore, Top, Field, Seg } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { confirmPayment } from '../lib/store.js';
import { readReceipt } from '../lib/receipt.js';
import { naira } from '../lib/format.js';
import { haptic } from '../lib/voice.js';

/** "I have paid": check the customer's receipt with Wema. Scan it or type it, the trader chooses. */
export default function ConfirmPayment({ amount: presetAmount, txnId, sender: presetSender }) {
  const s = useStore();
  const { back } = useNav();
  const [mode, setMode] = useState('scan');
  const [f, setF] = useState({ amount: presetAmount ? String(presetAmount) : '', sender: presetSender || '', reference: '' });
  const [scan, setScan] = useState(null); // {preview, fingerprint, progress, status}
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const cam = useRef(null), gal = useRef(null);
  const set = k => e => setF({ ...f, [k]: k === 'amount' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value });

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setRes(null);
    setScan({ status: 'reading', progress: 0 });
    try {
      const r = await readReceipt(file, m => { if (m.status === 'recognizing text') setScan(x => ({ ...x, progress: m.progress })); });
      setScan({ status: 'read', preview: r.preview, fingerprint: r.fingerprint, bank: r.bank, date: r.date });
      setF(x => ({ amount: r.amount ? String(r.amount) : x.amount, sender: r.sender || x.sender, reference: r.reference || x.reference }));
      if (!r.amount) setErr("Couldn't read the amount. Type it below.");
    } catch {
      setScan(null);
      setErr("Couldn't read that picture. Try a clearer photo, or type the details instead.");
    }
  }

  async function check() {
    setErr(''); setBusy(true); setRes(null);
    try {
      const r = await confirmPayment({ amount: Number(f.amount), senderName: f.sender, reference: f.reference, fingerprint: scan?.fingerprint || null, txnId });
      setRes(r); haptic(r.verified ? [20, 30, 20] : [80]);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const reset = () => { setRes(null); setScan(null); setF({ amount: '', sender: '', reference: '' }); };

  return (
    <div className="page">
      <Top title="Check a receipt" sub="Never release goods on a fake alert" onBack={back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        {!s.profile.accountNumber && <div className="banner amber" style={{ marginBottom: 12 }}>Open your Wema account in Wallet first. Vendora checks receipts against it.</div>}

        {res ? (
          <div className="card center">
            {res.verified ? <ShieldCheck size={64} className="leaf" /> : <ShieldX size={64} className="pepper" />}
            <h2 style={{ margin: '10px 0 4px' }}>{res.verified ? 'Money confirmed' : res.duplicate ? 'Receipt already used' : 'Money has NOT arrived'}</h2>
            <div className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>{res.verified ? `${naira(f.amount)} from ${res.credit?.senderName || f.sender || 'the customer'} is in your Wema account. You can release the goods.` : res.message}</div>
            {!res.verified && <div className="banner pepper" style={{ marginTop: 14, textAlign: 'left' }}>Do not release the goods. Ask the customer to wait, or pay into a one-time account from Collect transfer.</div>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn plain grow" onClick={reset}><RotateCcw size={18} />New check</button>
              <button className="btn primary grow" onClick={back}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <Seg value={mode} onChange={m => { setMode(m); setErr(''); }} label="How to check" options={[['scan', 'Scan receipt', Camera], ['type', 'Type details', Keyboard]]} />

            {mode === 'scan' && (
              <div className="card" style={{ marginTop: 12 }}>
                {!scan && (
                  <>
                    <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.45 }}>Take a photo of the customer's transfer receipt, or pick a screenshot they sent you. Vendora reads it for you.</div>
                    <div className="row" style={{ marginTop: 14 }}>
                      <button className="btn primary grow" onClick={() => cam.current.click()}><Camera size={20} />Take photo</button>
                      <button className="btn soft grow" onClick={() => gal.current.click()}><ImageUp size={20} />Screenshot</button>
                    </div>
                  </>
                )}
                {scan?.status === 'reading' && (
                  <div>
                    <b>Reading the receipt…</b>
                    <div className="progress" style={{ marginTop: 10 }}><div style={{ width: `${Math.round((scan.progress || 0.05) * 100)}%` }} /></div>
                    <div className="small" style={{ marginTop: 8 }}>The first scan takes a little longer.</div>
                  </div>
                )}
                {scan?.status === 'read' && (
                  <>
                    <img className="photo" src={scan.preview} alt="The receipt you scanned" />
                    <div className="small" style={{ marginTop: 8 }}>Check what Vendora read and fix anything that's wrong.</div>
                  </>
                )}
                <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
                <input ref={gal} type="file" accept="image/*" hidden onChange={onFile} />
              </div>
            )}

            {(mode === 'type' || scan?.status === 'read') && (
              <div className="card" style={{ marginTop: 12 }}>
                <Field label="Amount" pre="₦"><input value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="0" /></Field>
                <Field label="Sender's name"><input value={f.sender} onChange={set('sender')} placeholder="As written on the receipt" /></Field>
                <Field label="Reference or session ID (optional)" hint="The long number on the receipt. It stops the same receipt being used twice."><input value={f.reference} onChange={set('reference')} placeholder="e.g. 1000042510…" /></Field>
              </div>
            )}

            {err && <div className="error">{err}</div>}
            {(mode === 'type' || scan?.status === 'read') && (
              <button className="btn primary full" style={{ marginTop: 16 }} disabled={busy || !(Number(f.amount) > 0) || !s.profile.accountNumber} onClick={check}>
                {busy ? 'Checking with Wema…' : 'Check with Wema'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
