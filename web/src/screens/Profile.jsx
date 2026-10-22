import React, { useState } from 'react';
import { Users, Crown, MessageCircle, ShieldCheck, Languages, Volume2, Bell, Landmark, ChevronRight, RotateCcw, Store, UserRound, TrendingUp, FileText, MapPin, BadgeCheck, Megaphone, Mic, Lock } from 'lucide-react';
import { useStore, Top, Sheet, Field, Toggle, initials } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { updateProfile, resetAll, loadDemo, isOwner, currentStaff, toast, activateOfflineAccount } from '../lib/store.js';
import { LANGUAGES, langLabel } from '../lib/i18n.js';
import { fmtCoord } from '../lib/device.js';
import { useAuthStore } from '../features/auth/authStore.js';
import { replicaScope } from '../features/sync/replicaRepository.js';
import { encryptedReplicaRepository } from '../features/security/encryptedReplicaRepository.js';
import {
  isEnrolledForOfflineAccess,
  enableOfflineAccess,
  revokeOfflineEnrollment,
} from '../features/security/offlineEnrollment.js';


export default function Profile() {
  const s = useStore();
  const { back, go } = useNav();
  const p = s.profile;
  const [edit, setEdit] = useState(false);
  const [lang, setLang] = useState(false);
  const [reset, setReset] = useState(false);
  const owner = isOwner(s);
  const me = currentStaff(s);
  const authenticated = useAuthStore(state => state.status === 'authenticated');
  const user = useAuthStore(state => state.user);
  const selectedBusinessId = useAuthStore(state => state.selectedBusinessId);
  const [offlineModal, setOfflineModal] = useState(false);
  const [offlinePassword, setOfflinePassword] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineError, setOfflineError] = useState('');
  const [enrolled, setEnrolled] = useState(() => isEnrolledForOfflineAccess(user?.id, selectedBusinessId));


  const Row = ({ icon: Icon, tone = 'ink', label, sub, onClick, right }) => (
    <button className="item" onClick={onClick}>
      <span className={'avatar-sm ic ' + tone}><Icon size={19} /></span>
      <span className="grow"><div className="t">{label}</div>{sub && <div className="s">{sub}</div>}</span>
      {right || <ChevronRight size={18} className="muted" />}
    </button>
  );
  const Switch = ({ icon: Icon, label, sub, on, set }) => (
    <div className="item">
      <span className="avatar-sm ic ink"><Icon size={19} /></span>
      <span className="grow"><div className="t">{label}</div>{sub && <div className="s">{sub}</div>}</span>
      <Toggle on={on} onChange={set} label={label} />
    </div>
  );

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Profile" onBack={back} tall />
      <div className="wrap over">
        <div className="card row">
          <span className="avatar" style={{ width: 60, height: 60, fontSize: 20 }}>{initials(p.name)}</span>
          <div className="grow">
            <b style={{ fontSize: 18 }}>{p.name}</b>
            <div className="muted" style={{ fontSize: 14 }}>{p.businessName}{p.city ? `, ${p.city}` : ''}</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              {p.premium && <span className="pill kola"><Crown size={12} />Premium</span>}
              {me && s.staff.length > 1 && <span className="pill grey">Signed in as {me.name}</span>}
            </div>
          </div>
          {owner && <button className="btn plain sm" onClick={() => setEdit(true)}>Edit</button>}
        </div>

        <div className="h2">Your business</div>
        <div className="list">
          <Row icon={Landmark} tone="royal" label="Wema account" sub={p.accountNumber ? `${p.accountNumber}, ${p.accountName}` : 'Not opened yet'} onClick={() => go('wallet', { seg: 'payments' })} />
          {owner && <Row icon={TrendingUp} tone="royal" label="Business Score" onClick={() => go('score')} />}
          <Row icon={ShieldCheck} tone="leaf" label="Secured records" sub="Proof your sales are real" onClick={() => go('records')} />
          <Row icon={FileText} tone="royal" label="Invoices" sub="Every sale, numbered. Export to Excel for Wema" onClick={() => go('invoices')} />
          <Row icon={MapPin} tone="royal" label="Shop location" sub={p.location ? `${fmtCoord(p.location)}, ±${p.location.accuracy} m` : 'Not set. Tap to pin your shop'} onClick={() => go('permissions')} />
          {owner && <Row icon={BadgeCheck} tone="leaf" label="CAC registration" sub={s.cac.number || ({ none: 'Save small daily, Wema registers you', saving: 'Saving for it', paused: 'Saving paused', ready: 'Money complete. Fill the form', submitted: 'Wema is filing it', approved: 'Name approved' }[s.cac.status])} onClick={() => go('cac')} />}
          {owner && <Row icon={Megaphone} tone="kola" label="My Vendors Hub advert" sub={s.advert?.published ? 'Live' : 'Add photos or a video of your shop'} onClick={() => go('advert')} />}
          <Row icon={Users} label={owner ? 'Shop assistants' : 'Switch user'} sub={owner ? `${Math.max(0, s.staff.length - 1)} added` : 'Hand the phone back to the owner'} onClick={() => go('staff')} />
          <Row icon={MessageCircle} tone="leaf" label="Vendora on WhatsApp" sub={p.whatsappLinked ? 'Linked' : 'Record sales by WhatsApp message'} onClick={() => go('whatsapp')} />
          {owner && <Row icon={Crown} tone="kola" label="Premium" sub={p.premium ? 'Active' : 'Unlimited WhatsApp, reports, more staff'} onClick={() => go('premium')} />}
        </div>

        <div className="h2">Settings</div>
        <div className="list">
          {authenticated && <Row icon={ShieldCheck} label="Change password" sub="Signs out every device; keeps local records" onClick={() => go('password')} />}
          {authenticated && (
            <Row
              icon={Lock}
              tone={enrolled ? "leaf" : "ink"}
              label="Offline access"
              sub={enrolled ? "Enabled on this device" : "Reopen your shop without internet"}
              onClick={() => {
                setOfflineError('');
                setOfflinePassword('');
                setOfflineModal(true);
              }}
            />
          )}
          <Row icon={Mic} label="Permissions" sub="Microphone, sound, location, camera" onClick={() => go('permissions')} />
          <Row icon={Languages} label="Language" sub={langLabel(p.language)} onClick={() => setLang(true)} />
          <Switch icon={Volume2} label="Speak replies out loud" on={p.speakReplies} set={v => updateProfile({ speakReplies: v })} />
          <Switch icon={Bell} label="WhatsApp alerts" sub="Low stock and payments" on={p.whatsappAlerts} set={v => updateProfile({ whatsappAlerts: v })} />
          {owner && <Switch icon={ShieldCheck} label="Share records with Wema" sub="Needed for loans. Turn off any time." on={p.consentShareData} set={v => updateProfile({ consentShareData: v })} />}
        </div>

        {owner && <>
          <div className="h2">Shop on this phone</div>
          <div className="list">
            <Row icon={Store} label="Load the sample shop" sub="See Vendora with 30 days of sales" onClick={() => { loadDemo(); toast('Sample shop loaded.'); }} />
            <Row icon={RotateCcw} tone="pepper" label="Start over" sub="Clears this phone" onClick={() => setReset(true)} />
          </div>
        </>}
        <div className="small center" style={{ marginTop: 22 }}>Vendora 1.0</div>
      </div>

      {edit && <EditProfile onClose={() => setEdit(false)} />}
      {lang && (
        <Sheet title="Language" onClose={() => setLang(false)}>
          <div className="list">{LANGUAGES.map(l => (
            <button key={l.code} className="item" onClick={() => { updateProfile({ language: l.code }); setLang(false); }}><span className="grow t">{l.label}</span>{p.language === l.code && <span className="pill royal">Selected</span>}</button>
          ))}</div>
        </Sheet>
      )}
      {reset && (
        <Sheet title="Start over?" sub="Everything on this phone is cleared: items, sales, debts and settings." onClose={() => setReset(false)}>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn plain grow" onClick={() => setReset(false)}>Keep my shop</button>
            <button className="btn danger grow" onClick={() => { resetAll(); }}>Clear everything</button>
          </div>
        </Sheet>
      )}
      {offlineModal && (
        <Sheet
          title="Offline access"
          sub="Reopen your shop and make sales even without internet connection. Your local records are protected with your password."
          onClose={() => setOfflineModal(false)}
        >
          {enrolled ? (
            <div>
              <div className="card row" style={{ background: '#e6f4ea', borderColor: '#ceead6', marginTop: 12 }}>
                <ShieldCheck size={22} style={{ color: '#137333', flexShrink: 0 }} />
                <div className="grow">
                  <b style={{ color: '#137333' }}>Offline access is active</b>
                  <div className="small muted">
                    Your account is secured with password-wrapped offline encryption.
                  </div>
                </div>
              </div>
              {offlineError && (
                <div style={{ color: '#c5221f', background: '#fce8e6', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 }}>
                  {offlineError}
                </div>
              )}
              <button
                className="btn danger full"
                style={{ marginTop: 20 }}
                disabled={offlineBusy}
                onClick={async () => {
                  if (offlineBusy) return;
                  setOfflineError('');
                  setOfflineBusy(true);
                  try {
                    await revokeOfflineEnrollment({
                      userId: user?.id,
                      businessId: selectedBusinessId,
                    });
                    setEnrolled(false);
                    toast('Offline access disabled for this device.');
                    setOfflineModal(false);
                  } catch (err) {
                    setOfflineError(err?.message || 'Could not disable offline access.');
                  } finally {
                    setOfflineBusy(false);
                  }
                }}
              >
                {offlineBusy ? 'Checking records...' : 'Disable offline access'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              {offlineError && (
                <div style={{ color: '#c5221f', background: '#fce8e6', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                  {offlineError}
                </div>
              )}
              <Field label="Confirm account password">
                <input
                  type="password"
                  value={offlinePassword}
                  onChange={e => setOfflinePassword(e.target.value)}
                  placeholder="Enter your Vendora password"
                />
              </Field>
              <button
                className="btn primary full"
                style={{ marginTop: 16 }}
                disabled={offlineBusy || !offlinePassword}
                onClick={async () => {
                  if (offlineBusy) return;
                  setOfflineError('');
                  setOfflineBusy(true);
                  try {
                    const { accountKey } = await enableOfflineAccess({
                      userId: user.id,
                      businessId: selectedBusinessId,
                      password: offlinePassword,
                      businessName: p.businessName,
                      userName: user.name,
                      phone: user.phone,
                    });
                    const scope = replicaScope(user.id, selectedBusinessId);
                    encryptedReplicaRepository.setAccountKey(scope, accountKey);
                    await activateOfflineAccount(user.id, selectedBusinessId, accountKey);
                    setEnrolled(true);
                    toast('Offline access enabled on this device.');
                    setOfflineModal(false);
                  } catch (err) {
                    setOfflineError(err?.message || 'Could not enable offline access. Please check your password.');
                  } finally {
                    setOfflineBusy(false);
                  }
                }}
              >
                {offlineBusy ? 'Securing offline access...' : 'Enable offline access'}
              </button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

function EditProfile({ onClose }) {
  const p = useStore(s => s.profile);
  const [f, setF] = useState({ name: p.name, businessName: p.businessName, phone: p.phone, city: p.city });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <Field label="Your name" pre={<UserRound size={18} />}><input value={f.name} onChange={set('name')} /></Field>
      <Field label="Business name" pre={<Store size={18} />}><input value={f.businessName} onChange={set('businessName')} /></Field>
      <Field label="Phone"><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
      <Field label="Market or area"><input value={f.city} onChange={set('city')} /></Field>
      <button className="btn primary full" style={{ marginTop: 18 }} disabled={f.name.trim().length < 2 || f.businessName.trim().length < 2} onClick={() => { updateProfile(f); toast('Profile saved.'); onClose(); }}>Save</button>
    </Sheet>
  );
}
