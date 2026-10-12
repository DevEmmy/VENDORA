import React, { useState } from 'react';
import { UserPlus, Trash2, UserRound, Crown } from 'lucide-react';
import { useStore, Top, Sheet, Field, Empty, initials } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import PinPad from '../components/PinPad.jsx';
import { addStaff, removeStaff, switchStaff, staffSummary, isOwner, currentStaff, toast, setStaffPin } from '../lib/store.js';
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

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title={owner ? 'Shop assistants' : 'Switch user'} sub={owner ? 'Each person sells with their own PIN' : `Signed in as ${me?.name}`} onBack={back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        <button className="btn primary full" onClick={() => setSwitching(true)}><UserRound size={18} />{owner ? 'Hand phone to an assistant' : 'Switch to another user'}</button>
        {owner && <>
          <div className="h2">Sales today by person</div>
          {summary.length ? <div className="list">{summary.map(r => (
            <div key={r.name} className="item"><span className="avatar-sm ic royal">{initials(r.name)}</span><span className="grow"><div className="t">{r.name}</div><div className="s">{r.count} sale{r.count === 1 ? '' : 's'}</div></span><span className="amt">{naira(r.revenue)}</span></div>
          ))}</div> : <div className="card muted">No sales yet today.</div>}

          <div className="h2">People <button className="more" onClick={() => setAdding(true)}><UserPlus size={14} style={{ verticalAlign: -2 }} /> Add</button></div>
          <div className="list">
            {s.staff.map(x => (
              <div key={x.id} className="item">
                <span className={'avatar-sm ic ' + (x.isOwner ? 'kola' : 'ink')}>{x.isOwner ? <Crown size={18} /> : initials(x.name)}</span>
                <span className="grow"><div className="t">{x.name}</div><div className="s">{x.isOwner ? 'Owner, sees everything' : 'Can sell and add stock. Cannot see loans or cancel records.'}</div></span>
                {x.isOwner ? <button className="btn plain sm" onClick={() => setPinFor(true)}>PIN</button>
                  : <button className="icon-btn light" style={{ width: 40, height: 40 }} onClick={() => { removeStaff(x.id); toast(`${x.name} removed.`); }} aria-label={`Remove ${x.name}`}><Trash2 size={18} /></button>}
              </div>
            ))}
          </div>
          {s.staff.length <= 1 && <div style={{ marginTop: 12 }}><Empty icon={UserPlus} title="Add your shop assistant" body="They record sales with their own PIN. You see who sold what, and they can't see your loans." /></div>}
        </>}
        {!owner && ownerRec && <div className="small center" style={{ marginTop: 12 }}>The owner's PIN brings back the full app.</div>}
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} />}
      {switching && (
        <Sheet title="Enter PIN" sub="Whose turn is it?" onClose={() => setSwitching(false)}>
          <PinPad onDone={pin => { const ok = switchStaff(pin); if (ok) { setSwitching(false); toast('Switched user.'); go('home'); } return ok; }} />
        </Sheet>
      )}
      {pinFor && (
        <Sheet title="Choose a new owner PIN" sub="4 digits. Keep it to yourself." onClose={() => setPinFor(false)}>
          <PinPad onDone={pin => { setPinFor(false); if (ownerRec) setStaffPin(ownerRec.id, pin); toast('PIN changed.'); return true; }} />
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
      </> : <PinPad badText="Someone already uses that PIN. Pick another." onDone={pin => {
        if (s.staff.some(x => x.pin === pin)) return false;
        addStaff(name.trim(), pin); toast(`${name.trim()} can now sell with their PIN.`, 'good'); onClose(); return true;
      }} />}
    </Sheet>
  );
}
