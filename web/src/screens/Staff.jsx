import React, { useEffect, useState } from 'react';
import { UserPlus, Trash2, UserRound, Crown } from 'lucide-react';
import { useStore, Top, Sheet, Field, Empty, initials } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import PinPad from '../components/PinPad.jsx';
import { addStaff, removeStaff, switchStaff, staffSummary, isOwner, currentStaff, toast, setStaffPin, protectStaffPins } from '../lib/store.js';
import { naira } from '../lib/format.js';

export default function Staff() {
  const s = useStore();
  const { back, go } = useNav();
  const owner = isOwner(s);
  const me = currentStaff(s);
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [pinFor, setPinFor] = useState(false);
  const summary = staffSummary();
  const ownerRec = s.staff.find(x => x.isOwner);
  useEffect(() => { protectStaffPins().catch(error => toast(error.message, 'bad')); }, []);

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title={owner ? 'Shop assistants' : 'Switch user'} sub="Convenience lock on this device" onBack={back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        <p className="small">PINs switch the recorded-by name on this phone. They do not create separate accounts or protect access to the server. Operations use the signed-in account's permissions.</p>
        {owner && !ownerRec?.pinHash && <button className="btn primary full" onClick={() => setPinFor(true)}>Set owner PIN</button>}
        <button className="btn primary full" onClick={() => setSwitching(true)}><UserRound size={18} />{owner ? 'Hand phone to an assistant' : 'Switch to another user'}</button>
        {owner && <>
          <div className="h2">Sales today by person</div>
          {summary.length ? <div className="list">{summary.map(r => (
            <div key={r.name} className="item"><span className="avatar-sm ic royal">{initials(r.name)}</span><span className="grow"><div className="t">{r.name}</div><div className="s">{r.count} sale{r.count === 1 ? '' : 's'}</div></span><span className="amt">{naira(r.revenue)}</span></div>
          ))}</div> : <div className="card muted">No sales yet today.</div>}

          <div className="h2">People <button className="more" disabled={!ownerRec?.pinHash} onClick={() => setAdding(true)}><UserPlus size={14} style={{ verticalAlign: -2 }} /> Add</button></div>
          <div className="list">
            {s.staff.map(x => (
              <div key={x.id} className="item">
                <span className={'avatar-sm ic ' + (x.isOwner ? 'kola' : 'ink')}>{x.isOwner ? <Crown size={18} /> : initials(x.name)}</span>
                <span className="grow"><div className="t">{x.name}</div><div className="s">{x.isOwner ? 'Owner view on this phone' : 'Assistant view on this phone'}</div></span>
                {x.isOwner ? <button className="btn plain sm" onClick={() => setPinFor(true)}>PIN</button>
                  : <button className="icon-btn light" style={{ width: 40, height: 40 }} onClick={() => { removeStaff(x.id); toast(`${x.name} removed.`); }} aria-label={`Remove ${x.name}`}><Trash2 size={18} /></button>}
              </div>
            ))}
          </div>
          {s.staff.length <= 1 && <div style={{ marginTop: 12 }}><Empty icon={UserPlus} title="Add your shop assistant" body="Choose an owner PIN, then add names for recording sales on this device." /></div>}
        </>}
        {!owner && ownerRec && <div className="small center" style={{ marginTop: 12 }}>The owner's PIN brings back the full app.</div>}
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} />}
      {switching && (
        <Sheet title="Enter PIN" sub="Whose turn is it?" onClose={() => setSwitching(false)}>
          <PinPad onDone={async pin => { const ok = await switchStaff(pin); if (ok) { setSwitching(false); toast('Switched user.'); go('home'); } return ok; }} />
        </Sheet>
      )}
      {pinFor && (
        <Sheet title="Choose a new owner PIN" sub="4 digits. Keep it to yourself." onClose={() => setPinFor(false)}>
          <PinPad badText="PIN could not be saved or is already in use." onDone={async pin => { await setStaffPin(ownerRec?.id || 'owner', pin); setPinFor(false); toast('PIN changed.'); return true; }} />
        </Sheet>
      )}
    </div>
  );
}

function AddPerson({ onClose }) {
  const s = useStore();
  const [name, setName] = useState('');
  const [step, setStep] = useState('name');
  return (
    <Sheet title={step === 'name' ? 'Add a shop assistant' : `PIN for ${name}`} sub={step === 'pin' ? 'They will use this to sell' : null} onClose={onClose}>
      {step === 'name' ? <>
        <Field label="Their name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tunde" autoFocus /></Field>
        <button className="btn primary full" style={{ marginTop: 18 }} disabled={name.trim().length < 2} onClick={() => setStep('pin')}>Next: choose PIN</button>
      </> : <PinPad badText="PIN could not be saved or is already in use." onDone={async pin => {
        await addStaff(name.trim(), pin); toast(`${name.trim()} added on this phone.`, 'good'); onClose(); return true;
      }} />}
    </Sheet>
  );
}
