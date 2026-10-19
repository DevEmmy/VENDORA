import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Fingerprint, Link2, Undo2, Clock, Download, CircleAlert } from 'lucide-react';
import { useStore, Top } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { integrity } from '../lib/store.js';
import { downloadBlob } from '../lib/records.js';
import { EVIDENCE, verifySignatures } from '../lib/ledger.js';
import { naira, timeAgo } from '../lib/format.js';

/** The sealed record: what makes the sales history hard to fake, shown plainly. */
export default function Records() {
  const s = useStore();
  const { back } = useNav();
  const integ = integrity(s);
  const [sig, setSig] = useState(null);
  const reversals = s.ledger.filter(e => e.kind === 'reversal');
  const failed = s.ledger.filter(e => e.kind === 'failed-check');
  const adjusts = s.ledger.filter(e => e.kind === 'adjust');
  const tr = integ.trust;
  const ev = Object.entries(tr.byEvidence).sort((a, b) => b[1] - a[1]);
  const head = s.ledger[s.ledger.length - 1];

  useEffect(() => {
    let on = true;
    if (s.ledgerKey) verifySignatures(s.ledger, s.ledgerKey.publicJwk).then(r => on && setSig(r)).catch(() => {});
    return () => { on = false; };
  }, [s.ledger.length, s.ledgerKey, s.ledger.filter(e => e.sig).length]);

  function download() {
    const rows = [['date', 'type', 'details', 'amount', 'paid', 'customer', 'proof', 'cancelled']];
    const em = new Map(s.ledger.filter(e => e.kind === 'record' || e.kind === 'verify').map(e => [e.ref, e.evidence]));
    for (const t of [...s.txns].reverse()) rows.push([new Date(t.at).toISOString(), t.type, (t.items || []).map(i => `${i.qty} ${i.name}`).join('; ') || t.note || '', t.amount, t.paid, t.customerName || '', EVIDENCE[em.get(t.id)]?.label || '', t.reversed ? 'yes' : '']);
    rows.push([], ['seal', head ? `${head.seq}:${head.hash}` : '', 'device key', s.ledgerKey?.fingerprint || '']);
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `${(s.profile.businessName || 'vendora').replace(/\W+/g, '-')}-statement.csv`);
  }

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Secured records" sub="Why your sales history can be trusted" onBack={back} tall />
      <div className="wrap over">
        <div className="card center">
          {integ.ok ? <ShieldCheck size={56} className="leaf" /> : <ShieldAlert size={56} className="pepper" />}
          <h2 style={{ margin: '8px 0 4px' }}>{integ.ok ? 'All records intact' : 'Records were changed'}</h2>
          <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.45 }}>{integ.ok
            ? `${s.ledger.length} entries, each sealed to the one before it. Nothing has been edited or deleted.`
            : 'Some entries no longer match their seal. Loans are paused until this is reviewed by Wema.'}</div>
        </div>

        {!integ.ok && <div className="card" style={{ marginTop: 12 }}>
          {!integ.chain.ok && <div className="kv"><span>{integ.chain.reason}</span><b className="pepper">#{integ.chain.brokenAt + 1}</b></div>}
          {integ.problems.slice(0, 5).map((p, i) => <div key={i} className="kv"><span>{p.reason || 'Record does not match its seal'}</span><b className="pepper">{p.id || p.ref}</b></div>)}
        </div>}

        <div className="h2">How Vendora protects them</div>
        <div className="card">
          <div className="kv"><span><Link2 size={15} style={{ verticalAlign: -2 }} /> Sealed chain</span><b className={integ.chain.ok ? 'leaf' : 'pepper'}>{integ.chain.ok ? 'Unbroken' : 'Broken'}</b></div>
          <div className="kv"><span><Fingerprint size={15} style={{ verticalAlign: -2 }} /> Signed on this phone</span><b className={sig?.bad ? 'pepper' : 'leaf'}>{!s.ledgerKey ? 'Setting up' : !sig ? 'Checking…' : sig.bad ? `${sig.bad} bad` : `${sig.checked} of ${s.ledger.length}`}</b></div>
          <div className="kv"><span><Clock size={15} style={{ verticalAlign: -2 }} /> Clock changes caught</span><b className={integ.flags ? 'amber' : 'leaf'}>{integ.flags}</b></div>
          <div className="kv"><span><Undo2 size={15} style={{ verticalAlign: -2 }} /> Cancelled records (kept visible)</span><b>{reversals.length}</b></div>
          <div className="kv"><span><CircleAlert size={15} style={{ verticalAlign: -2 }} /> Fake receipts stopped</span><b>{failed.length}</b></div>
          <div className="kv"><span>Stock count corrections</span><b>{adjusts.length}</b></div>
          {s.sync.lastSyncAt && <div className="kv"><span><ShieldCheck size={15} style={{ verticalAlign: -2 }} /> Matches the copy held online</span><b className={integ.serverOk ? 'leaf' : 'pepper'}>{integ.serverOk ? 'Yes' : 'No'}</b></div>}
          {head && <div className="small" style={{ marginTop: 10, wordBreak: 'break-all' }}>Latest seal #{head.seq}: {head.hash.slice(0, 24)}…</div>}
        </div>

        <div className="h2">Proof behind your sales (30 days)</div>
        <div className="card gap">
          {ev.length ? ev.map(([k, amt]) => (
            <div key={k}>
              <div className="row between" style={{ fontSize: 14.5 }}><span style={{ fontWeight: 600 }}>{EVIDENCE[k]?.label || k}</span><b>{naira(amt)}</b></div>
              <div className={'meter' + (EVIDENCE[k]?.verified ? ' leaf' : '')} style={{ marginTop: 6 }}><div style={{ width: `${Math.round(amt / tr.total * 100)}%` }} /></div>
            </div>
          )) : <div className="muted">No sales in the last 30 days.</div>}
          {tr.total > 0 && <div className="small">{Math.round(tr.verifiedShare * 100)}% confirmed by money or goods actually moving. The rest was recorded live.</div>}
        </div>

        {reversals.length > 0 && <>
          <div className="h2">Cancelled records</div>
          <div className="list">{reversals.slice(-8).reverse().map(e => {
            const t = s.txns.find(x => x.id === e.ref);
            return <div key={e.seq} className="item"><Undo2 size={18} className="amber" /><span className="grow"><div className="t clip">{t ? (t.items?.map(i => `${i.qty} ${i.name}`).join(', ') || t.note) : e.ref}</div><div className="s">{e.data.reason}{e.data.by ? `, by ${e.data.by}` : ''}, {timeAgo(e.at)}</div></span>{t && <span className="amt">{naira(t.amount)}</span>}</div>;
          })}</div>
        </>}

        <button className="btn primary full" style={{ marginTop: 18 }} onClick={download}><Download size={18} />Download statement</button>
        <div className="small center" style={{ marginTop: 8 }}>Includes the seal so Wema can check nothing was changed. {s.ledger.length ? `Since ${new Date(s.ledger[0].at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}` : ''}</div>
      </div>
    </div>
  );
}
