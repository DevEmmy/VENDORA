import React, { useEffect, useState } from 'react';
import { Mic, Volume2, Camera, MapPin, CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react';
import { useStore, Top } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { permissionState, requestMic, requestCamera, preciseLocation, secure, mapsUrl, fmtCoord } from '../lib/device.js';
import { setLocation, toast, recordPerm } from '../lib/store.js';
import { primeSpeech, speak, voiceSupport } from '../lib/voice.js';

const BLOCKED = 'Blocked. Tap the lock icon next to the web address, choose Permissions, allow it, then tap the button again.';
const HELP = {
  insecure: 'Phones only allow this when Vendora is opened from its web link (https), not from a saved file.',
  unsupported: 'This browser cannot do this. Open Vendora in Google Chrome.',
  nomic: 'No microphone found on this phone.',
  nocam: 'No camera found on this phone.',
  denied: BLOCKED,
  embedded: 'This page is shown inside another website, which blocks this. Open Vendora on its own web address to use it.',
};

function Row({ icon: Icon, title, why, state, action, onClick, busy, extra }) {
  const ok = state === 'granted';
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="perm">
        <span className={'avatar-sm ic ' + (ok ? 'leaf' : 'royal')} style={{ width: 46, height: 46, borderRadius: 14 }}><Icon size={22} /></span>
        <div className="grow">
          <b style={{ fontSize: 15.5 }}>{title}</b>
          <div className="small" style={{ marginTop: 2, lineHeight: 1.4 }}>{why}</div>
        </div>
        {ok && <CheckCircle2 size={24} className="leaf" aria-label="Allowed" />}
      </div>
      {HELP[state] && <div className="banner amber" style={{ marginTop: 12, fontSize: 13.5 }}><CircleAlert size={18} /><span>{HELP[state]}</span></div>}
      {extra}
      <button className={'btn full ' + (ok ? 'plain' : 'primary')} style={{ marginTop: 12 }} disabled={busy} onClick={onClick}>{busy ? 'Waiting for the phone…' : action}</button>
    </div>
  );
}

/** Reusable block: onboarding uses it too. */
export function PermissionList() {
  const s = useStore();
  const rec = s.profile.perms || {};
  const [mic, setMic] = useState(rec.mic?.state || 'prompt');
  const [cam, setCam] = useState(rec.camera?.state || 'prompt');
  const [sound, setSound] = useState(rec.sound?.state || null);
  const [busy, setBusy] = useState('');
  const [locErr, setLocErr] = useState('');
  const loc = s.profile.location;

  useEffect(() => {
    if (!secure()) { setMic('insecure'); setCam('insecure'); return; }
    // The browser's own answer wins when it has one; otherwise keep what this phone allowed before.
    permissionState('microphone').then(st => { if (st === 'granted' || st === 'denied') { setMic(st); recordPerm('mic', st); } });
    permissionState('camera').then(st => { if (st === 'granted' || st === 'denied') { setCam(st); recordPerm('camera', st); } });
  }, []);

  async function askMic() {
    setBusy('mic'); primeSpeech();
    const r = await requestMic(); setMic(r); setBusy('');
    if (r === 'granted' || r === 'denied') recordPerm('mic', r);
    if (r === 'granted') toast('Microphone allowed. You can talk to Vendora now.', 'good');
  }
  async function askCam() { setBusy('cam'); const r = await requestCamera(); setCam(r); setBusy(''); if (r === 'granted' || r === 'denied') recordPerm('camera', r); if (r === 'granted') toast('Camera allowed.', 'good'); }
  function testSound() { primeSpeech(); speak('Hello. Vendora is ready to talk with you.', s.profile.language === 'pcm' ? 'pcm' : 'en'); setSound('granted'); recordPerm('sound', 'granted'); }
  async function getLoc() {
    setBusy('loc'); setLocErr('');
    try { const l = await preciseLocation(); setLocation(l); toast(`Shop location saved, accurate to ${l.accuracy} metres.`, 'good'); }
    catch (e) { setLocErr(e.message); } finally { setBusy(''); }
  }

  return (
    <>
      <Row icon={Mic} title="Microphone" why="So you can record sales by talking." state={mic} busy={busy === 'mic'} onClick={askMic}
        action={mic === 'granted' ? 'Allowed. Test again' : 'Allow microphone'}
        extra={voiceSupport() === 'unsupported' && mic === 'granted' ? <div className="hint">Voice typing needs Google Chrome on this phone.</div> : null} />
      <Row icon={Volume2} title="Sound" why="So Vendora can read replies out loud. Turn your volume up." state={sound} onClick={testSound}
        action={sound ? 'Play again' : 'Allow sound and test it'} />
      <Row icon={MapPin} title="Shop location" why="Your exact shop position for the Vendors Hub, invoices and Wema. Stand inside your shop." state={loc ? 'granted' : null} busy={busy === 'loc'} onClick={getLoc}
        action={loc ? 'Update precise location' : 'Use my precise location'}
        extra={<>
          {loc && <div className="kv" style={{ marginTop: 8 }}><span>{fmtCoord(loc)}<div className="small">Accurate to {loc.accuracy} m</div></span><a className="link" href={mapsUrl(loc)} target="_blank" rel="noreferrer">Map <ExternalLink size={13} style={{ verticalAlign: -1 }} /></a></div>}
          {locErr && <div className="banner amber" style={{ marginTop: 12, fontSize: 13.5 }}><CircleAlert size={18} /><span>{locErr}</span></div>}
        </>} />
      <Row icon={Camera} title="Camera" why="To scan customers' transfer receipts and take shop photos." state={cam} busy={busy === 'cam'} onClick={askCam}
        action={cam === 'granted' ? 'Allowed. Test again' : 'Allow camera'} />
    </>
  );
}

export default function Permissions() {
  const { back } = useNav();
  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Permissions" sub="Tap a button and press Allow when your phone asks" onBack={back} />
      <div className="wrap" style={{ marginTop: 4 }}><PermissionList /></div>
    </div>
  );
}
