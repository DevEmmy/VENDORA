import React, { useRef, useState } from 'react';
import { Camera, Video, ImagePlus, X, MapPin, BadgeCheck, Megaphone, CheckCircle2, Circle, ChevronRight, Eye } from 'lucide-react';
import { useStore, Top, Field, Toggle } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { saveAdvert, toast } from '../lib/store.js';
import { addMedia, removeMedia } from '../lib/media.js';
import { fmtCoord } from '../lib/device.js';
import { naira } from '../lib/format.js';
import Media from '../components/Media.jsx';

const MAX = 8;

/** The trader's own advert on the Vendors Hub: photos, a short video, what they sell and where. */
export default function Advert() {
  const s = useStore();
  const { back, go } = useNav();
  const ad = s.advert || {};
  const [f, setF] = useState({ headline: ad.headline || '', about: ad.about || '', showPrices: ad.showPrices ?? true, delivers: ad.delivers ?? false, media: ad.media || [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const photoIn = useRef(null), camIn = useRef(null), vidIn = useRef(null);
  const cacOk = s.cac.status === 'registered' || ['saving', 'ready', 'submitted', 'approved'].includes(s.cac.status);
  const checks = [
    ['photo', 'At least one photo or video of your shop', f.media.length > 0, null],
    ['loc', 'Shop location saved', !!s.profile.location, () => go('permissions')],
    ['cac', s.cac.status === 'registered' ? `CAC registered (${s.cac.number})` : 'CAC registered, or saving for it', cacOk, () => go('cac')],
  ];
  const ready = checks.every(c => c[2]) && f.headline.trim().length >= 4;

  async function onFiles(e) {
    const files = [...(e.target.files || [])]; e.target.value = '';
    setErr(''); setBusy(true);
    const added = [];
    for (const file of files.slice(0, MAX - f.media.length)) {
      try { added.push(await addMedia(file)); } catch (x) { setErr(x.message); }
    }
    const media = [...f.media, ...added];
    setF(v => ({ ...v, media }));
    saveAdvert({ media });
    setBusy(false);
  }
  function remove(id) { removeMedia(id); const media = f.media.filter(m => m.id !== id); setF({ ...f, media }); saveAdvert({ media }); }
  function save(publish) {
    saveAdvert({ ...f, headline: f.headline.trim(), about: f.about.trim(), published: publish ?? ad.published ?? false });
    toast(publish ? 'Your advert is live on the Vendors Hub.' : publish === false ? 'Advert hidden from the Hub.' : 'Advert saved.', 'good');
    if (publish) back();
  }

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Your shop advert" sub="Show buyers what you sell on the Vendors Hub" onBack={back} />
      <div className="wrap" style={{ marginTop: 16 }}>
        <span className="label" style={{ marginTop: 0 }}>Photos and video of your shop</span>
        <div className="gallery">
          {f.media.map((m, i) => (
            <div key={m.id} className="thumb">
              <Media m={m} alt={`Shop photo ${i + 1}`} />
              {i === 0 && <span className="pill kola" style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10.5 }}>Cover</span>}
              <button className="del" onClick={() => remove(m.id)} aria-label="Remove"><X size={16} /></button>
            </div>
          ))}
          {f.media.length < MAX && <>
            <button className="thumb add" onClick={() => camIn.current.click()}><Camera size={24} />Take photo</button>
            <button className="thumb add" onClick={() => photoIn.current.click()}><ImagePlus size={24} />Add photos</button>
            <button className="thumb add" onClick={() => vidIn.current.click()}><Video size={24} />Add video</button>
          </>}
        </div>
        <input ref={camIn} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
        <input ref={photoIn} type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <input ref={vidIn} type="file" accept="video/*" hidden onChange={onFiles} />
        <div className="hint">{busy ? 'Saving…' : 'Clear daylight photos of your goods sell best. Video up to 60 seconds.'}</div>
        {err && <div className="error">{err}</div>}

        <Field label="Headline" hint="One line buyers see first"><input value={f.headline} onChange={e => setF({ ...f, headline: e.target.value.slice(0, 70) })} placeholder="e.g. Rice, oil and provisions at wholesale prices" /></Field>
        <Field label="About your shop (optional)"><textarea rows={3} value={f.about} onChange={e => setF({ ...f, about: e.target.value.slice(0, 300) })} placeholder="What you sell, opening hours, landmarks near your shop" style={{ resize: 'none' }} /></Field>
        <div className="card" style={{ marginTop: 14, padding: '4px 16px' }}>
          <div className="kv"><span>Show my items and prices<div className="small">{s.products.length} items, from {naira(Math.min(...s.products.map(p => p.price), Infinity) || 0)}</div></span><Toggle on={f.showPrices} onChange={v => setF({ ...f, showPrices: v })} label="Show my items and prices" /></div>
          <div className="kv"><span>I can deliver to buyers</span><Toggle on={f.delivers} onChange={v => setF({ ...f, delivers: v })} label="I can deliver to buyers" /></div>
        </div>

        <div className="h2">Before it goes live</div>
        <div className="list">{checks.map(([k, label, ok, fix]) => (
          <button key={k} className="item" onClick={fix || undefined} disabled={ok || !fix} style={{ opacity: 1 }}>
            {ok ? <CheckCircle2 size={22} className="leaf" /> : <Circle size={22} className="muted" />}
            <span className="grow t" style={{ fontWeight: 600 }}>{label}</span>
            {!ok && fix && <ChevronRight size={18} className="muted" />}
          </button>
        ))}</div>
        {s.profile.location && <div className="small" style={{ marginTop: 8 }}><MapPin size={12} style={{ verticalAlign: -1 }} /> {fmtCoord(s.profile.location)}</div>}

        <div className="banner royal" style={{ marginTop: 14 }}><Eye size={20} /><span className="grow">Buyers see your photos, headline, location and {s.cac.status === 'registered' ? <>the <BadgeCheck size={14} style={{ verticalAlign: -2 }} /> CAC badge</> : 'your CAC progress'}. Your sales and loans stay private.</span></div>
        <button className="btn kola full" style={{ marginTop: 16, minHeight: 56 }} disabled={!ready} onClick={() => save(true)}><Megaphone size={20} />{ad.published ? 'Update my advert' : 'Publish my advert'}</button>
        {!ready && <div className="hint center">Complete the list above and add a headline to publish.</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn plain grow" onClick={() => save()}>Save for later</button>
          {ad.published && <button className="btn plain grow" onClick={() => save(false)}>Hide advert</button>}
        </div>
      </div>
    </div>
  );
}
