import React, { useState } from 'react';
import { ShieldCheck, Landmark, TrendingUp, CheckCircle2, IdCard } from 'lucide-react';
import { useStore, Top, Field } from '../components/ui.jsx';
import { openAccount, finishOnboarding, updateProfile } from '../lib/store.js';

export default function OpenAccount({ back }) {
  const p = useStore(s => s.profile);
  const [id, setId] = useState('');
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(p.accountNumber ? { accountNumber: p.accountNumber, accountName: p.accountName } : null);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      updateProfile({ consentShareData: consent });
      setDone(await openAccount(id));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Your Wema account" sub="Step 3 of 3" onBack={done ? undefined : back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        {done ? (
          <div className="bankcard center" style={{ position: 'relative', overflow: 'hidden', padding: 24 }}>
            <CheckCircle2 size={48} />
            <div style={{ fontWeight: 800, fontSize: 19, marginTop: 8 }}>Account ready</div>
            <div className="acct" style={{ marginTop: 10 }}>{done.accountNumber}</div>
            <div style={{ opacity: .85, marginTop: 4 }}>{done.accountName}, Wema Bank</div>
          </div>
        ) : <>
          <div className="card gap" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}><Landmark size={20} className="royal" style={{ flex: 'none' }} /><span>Customers pay straight into <b>your own Wema account</b>.</span></div>
            <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={20} className="leaf" style={{ flex: 'none' }} /><span>Vendora checks every transfer with Wema before you release goods.</span></div>
            <div className="row" style={{ alignItems: 'flex-start' }}><TrendingUp size={20} className="amber" style={{ flex: 'none' }} /><span>Your sales build a Business Score that unlocks restock loans.</span></div>
          </div>
          <Field label="BVN or NIN" pre={<IdCard size={18} />} hint="11 digits. Only Wema sees it, to open your account.">
            <input value={id} onChange={e => setId(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="11 digits" inputMode="numeric" />
          </Field>
          <label className="row" style={{ marginTop: 16, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, accentColor: 'var(--royal)', flex: 'none' }} />
            <span style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.45 }}>Share my sales records and Business Score with Wema <b>when I ask for a loan</b>. I can turn this off any time.</span>
          </label>
          {err && <div className="error">{err}</div>}
          <button className="btn primary full" style={{ marginTop: 20, minHeight: 56 }} disabled={busy || id.length !== 11} onClick={submit}>{busy ? 'Opening your account…' : 'Open my Wema account'}</button>
        </>}
        <button className={'btn full ' + (done ? 'kola' : 'plain')} style={{ marginTop: 12, minHeight: 56 }} onClick={finishOnboarding}>
          {done ? `Start selling, ${p.name.split(' ')[0] || 'friend'}` : 'Do this later'}
        </button>
      </div>
    </div>
  );
}
