import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Top } from '../../components/ui.jsx';
import { useNav } from '../../App.jsx';
import { apiRequest } from '../../lib/api/client.js';
import { getActiveSync } from '../sync/accountSync.js';
import { playReadback, recordAudio, prepareAudio, stopReadback } from './recorder.js';
import LiveRecorder from './LiveRecorder.jsx';

const unavailable = 'Voice is unavailable. You can complete the task with manual entry below.';
export function VoiceRecorder({ busy, onAudio, onError }) {
  const [state, setState] = useState('idle');
  const [seconds, setSeconds] = useState(0), [level, setLevel] = useState(0);
  const recording = useRef(null), mounted = useRef(true), starting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recording.current?.cancel(); }; }, []);
  const start = async () => {
    if (starting.current) return;
    starting.current = true; setState('starting'); setSeconds(0);
    try {
      const session = await recordAudio({ onLevel: setLevel, onSeconds: setSeconds, onState: setState,
        onAudio: blob => { if (mounted.current) { setState('idle'); onAudio(blob); } },
        onError: error => { if (mounted.current) { setState('idle'); onError(error.message); } } });
      if (!mounted.current) session.cancel(); else recording.current = session;
    } catch (error) {
      if (mounted.current) { setState('idle'); onError(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Use manual entry below.' : 'No microphone is available. Use manual entry below.'); }
    } finally { starting.current = false; }
  };
  return <div className="card center" aria-busy={busy || state === 'starting'}>
    <button className={`mic-big ${state === 'recording' ? 'live' : ''}`} style={{ margin: '12px auto', width: 80, height: 80 }}
      disabled={busy || state === 'starting'} aria-label={state === 'recording' ? 'Stop recording' : 'Record inventory command'}
      onClick={() => state === 'recording' ? recording.current?.stop() : start()}>
      {state === 'recording' ? <Square size={30} /> : <Mic size={32} />}
    </button>
    <div role="status">{busy ? <><span className="voice-spinner" /> Processing…</> : state === 'recording' ? `Recording ${seconds}/15 seconds — tap to finish` : state === 'starting' ? 'Opening microphone…' : 'Tap and say what changed'}</div>
    {state === 'recording' && <meter min="0" max="1" value={level} aria-label="Microphone level" />}
    <p className="small">Try "I sold 2 bags of rice". Review and confirm before stock changes.</p>
  </div>;
}

export function ConfirmationCard({ command, products, busy, onConfirm, onReject, request, readbackEnabled = true, preferDeviceSpeech = false, audioContext = null }) {
  const review = useRef(null);
  const [editing, setEditing] = useState(command.status === 'needs_clarification');
  const [action, setAction] = useState(command.parsed?.action === 'unknown' ? 'sale' : command.parsed?.action || 'sale');
  const [items, setItems] = useState((command.parsed?.items || []).map(item => ({ product_id: item.product_id || '', quantity: item.quantity })));
  const [negative, setNegative] = useState(false);
  const [learnAlias, setLearnAlias] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    review.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    review.current?.focus({ preventScroll: true });
  }, [command.voice_log_id]);
  useEffect(() => {
    const check = () => setExpired(Boolean(command.expires_at && Date.now() >= Date.parse(command.expires_at)));
    check(); const timer = setInterval(check, 1000); return () => clearInterval(timer);
  }, [command.expires_at]);
  useEffect(() => {
    let active = true, stop;
    const controller = new AbortController();
    if (readbackEnabled) void (async () => {
      let blob;
      if (!preferDeviceSpeech) {
        try { blob = await request(`/api/voice/commands/${command.voice_log_id}/readback`, { responseType: 'blob', signal: controller.signal }); } catch { /* Try device speech. */ }
      }
      // Pass the unlocked AudioContext so iOS/Android can play the MP3.
      if (active) { stop = await playReadback(blob, command.readback_text, audioContext); if (!active) stop(); }
    })();
    return () => { active = false; controller.abort(); stop?.(); };
  }, [command.voice_log_id, preferDeviceSpeech, readbackEnabled, audioContext]);
  const edit = (index, values) => setItems(previous => previous.map((item, i) => i === index ? { ...item, ...values } : item));
  const valid = !expired && items.length > 0 && items.every(item => item.product_id && Number.isInteger(Number(item.quantity)) &&
    (action === 'adjustment' ? Number(item.quantity) !== 0 : Number(item.quantity) > 0));
  return <section ref={review} tabIndex={-1} className="card voice-confirm" aria-label="Review inventory command">
    <h2>Review stock change</h2><blockquote>{command.transcript}</blockquote>
    <p>{command.readback_text}</p>
    {expired && <p role="alert">This proposal expired. Cancel it and say the command again.</p>}
    {command.status === 'needs_clarification' && <p className="banner amber">{command.parsed.clarification_question}</p>}
    {editing && <label>Action<select value={action} onChange={event => setAction(event.target.value)} disabled={busy}>
      <option value="sale">Sale</option><option value="restock">Restock</option><option value="adjustment">Adjustment (signed change)</option>
    </select></label>}
    {items.map((item, index) => {
      const product = products.find(p => p.id === item.product_id);
      const candidate = command.candidates?.[index]?.find(p => p.product_id === item.product_id);
      const previousDelta = items.slice(0, index).filter(previous => previous.product_id === item.product_id)
        .reduce((sum, previous) => sum + Number(previous.quantity) * (action === 'sale' ? -1 : 1), 0);
      const before = Number(product?.currentQty ?? candidate?.current_qty ?? 0) + previousDelta;
      const after = before + (action === 'sale' ? -Number(item.quantity) : Number(item.quantity));
      const rawUnit = product?.unit || command.parsed.items[index]?.unit || '';
      const baseUnit = rawUnit.toLowerCase().replace(/s$/, '');
      const unitPlural = Math.abs(Number(item.quantity)) === 1 ? baseUnit : (baseUnit ? `${baseUnit}s` : '');
      const afterUnit = after === 1 ? baseUnit : (baseUnit ? `${baseUnit}s` : '');
      return <div className="voice-line" key={index}>
        {editing ? <>
          <label>Product<select value={item.product_id} onChange={event => edit(index, { product_id: event.target.value })} disabled={busy}>
            <option value="">Choose a product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </select></label>
          <label>Whole quantity {action === 'adjustment' && '(negative removes stock)'}<input type="number" step="1" value={item.quantity}
            onChange={event => edit(index, { quantity: event.target.value })} disabled={busy} /></label>
        </> : <b>{action}: {item.quantity} {unitPlural} of {product?.name || command.parsed.items[index]?.spoken_name}</b>}
        <p>Stock: {before} → {Number.isFinite(after) ? after : '—'} {afterUnit}</p>
        {command.status === 'needs_clarification' && <div className="chips">{(command.candidates?.[index] || []).slice(0, 3).map(p => {
          const compatibleUnit = command.parsed.items[index]?.unit?.toLowerCase().replace(/s$/, '') === p.unit.toLowerCase().replace(/s$/, '');
          const canConfirm = items.length === 1 && compatibleUnit && Number.isInteger(Number(item.quantity)) && (action === 'adjustment' ? Number(item.quantity) !== 0 : Number(item.quantity) > 0);
          return <button type="button" className="chip" key={p.product_id}
          disabled={busy || expired} aria-pressed={item.product_id === p.product_id} onClick={() => {
            if (canConfirm)
              onConfirm({ product_id: p.product_id, quantity: Number(item.quantity), action, allow_negative: negative, learn_alias: learnAlias });
            else edit(index, { product_id: p.product_id });
          }}>{canConfirm ? 'Confirm ' : 'Choose '}{p.name}</button>;
        })}</div>}
      </div>;
    })}
    {command.stockError && <label className="banner amber"><input type="checkbox" checked={negative} onChange={event => setNegative(event.target.checked)} />Record this physical change even if stock becomes negative</label>}
    <label><input type="checkbox" checked={learnAlias} onChange={event => setLearnAlias(event.target.checked)} />Remember the spoken product name as an alias for my confirmed selection</label>
    <div className="voice-actions">
      <button className="btn primary" disabled={busy || !valid || (command.stockError && !negative)} onClick={() => onConfirm({ action,
        items: items.map(item => ({ ...item, quantity: Number(item.quantity) })), allow_negative: negative, learn_alias: learnAlias })}>{busy ? 'Saving…' : 'Confirm'}</button>
      <button className="btn soft" disabled={busy} onClick={() => setEditing(!editing)}>Edit</button>
      <button className="btn soft" disabled={busy} onClick={onReject}>Cancel</button>
    </div>
  </section>;
}

export function VoiceHistory({ request, refreshKey, onSelect }) {
  const [history, setHistory] = useState([]), [cursor, setCursor] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const load = async (next, signal) => {
    setLoading(true); setError('');
    try {
      const response = await request(`/api/voice/commands?limit=20${next ? `&cursor=${next}` : ''}`, { signal });
      if (signal?.aborted) return;
      setHistory(previous => next ? [...previous, ...response.commands] : response.commands); setCursor(response.next_cursor);
    } catch (e) { if (!signal?.aborted) setError(e.message); } finally { if (!signal?.aborted) setLoading(false); }
  };
  useEffect(() => { const controller = new AbortController(); void load(null, controller.signal); return () => controller.abort(); }, [refreshKey]);
  return <section className="card"><h2>Voice history</h2>{error && <p role="alert">{error} <button className="link" onClick={() => load(null)}>Retry</button></p>}
    {loading && <p role="status">Loading history…</p>}{!loading && !error && !history.length && <p>No voice commands yet.</p>}
    {history.map(command => <article className="voice-line" key={command.voice_log_id}>
      <p>{command.transcript || 'No speech detected'}</p><span className="pill">{command.status.replaceAll('_', ' ')}</span>
      <p className="small">{new Date(command.created_at).toLocaleString()}</p>
      {command.resulting_movement?.movements?.map(m => <p className="small" key={m.id}>Stock change: {m.quantity} ({m.type.toLowerCase()})</p>)}
      {['pending', 'needs_clarification'].includes(command.status) && <button className="btn soft sm" onClick={() => onSelect(command)}>Review</button>}
    </article>)}
    {cursor && <button className="btn soft" disabled={loading} onClick={() => load(cursor)}>Load more</button>}
  </section>;
}

function ManualEntry({ products, busy, onReview }) {
  const [product, setProduct] = useState(''), [quantity, setQuantity] = useState('1'), [action, setAction] = useState('sale');
  return <details className="card" open><summary><b>Manual add / sell</b></summary>
    <form className="voice-manual" onSubmit={event => { event.preventDefault(); onReview({ action, items: [{ product_id: product, quantity: Number(quantity) }] }); }}>
      <label>Product<select required value={product} onChange={event => setProduct(event.target.value)}><option value="">Choose a product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</select></label>
      <label>Action<select value={action} onChange={event => setAction(event.target.value)}><option value="sale">Sale</option><option value="restock">Restock</option><option value="adjustment">Adjustment</option></select></label>
      <label>Whole quantity<input required type="number" step="1" min={action === 'adjustment' ? undefined : '1'} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      <button className="btn soft" disabled={busy || !products.length || !Number(quantity)}>Review manual entry</button>
    </form>
  </details>;
}

export default function VoiceWorkspace({ businessId }) {
  const { back, go } = useNav();
  const [busy, setBusy] = useState(false), [command, setCommand] = useState(null), [error, setError] = useState('');
  const [products, setProducts] = useState([]), [settings, setSettings] = useState({ live: true }), [typed, setTyped] = useState('');
  const [historyKey, setHistoryKey] = useState(0), [toast, setToast] = useState(''), [alerts, setAlerts] = useState([]), [page, setPage] = useState('record');
  const lock = useRef(false), mounted = useRef(true), controllers = useRef(new Set());
  const toastRef = useRef(null), errorRef = useRef(null);
  // Holds the unlocked AudioContext forwarded from LiveRecorder for mobile-safe TTS.
  const liveAudioCtx = useRef(null);
  useEffect(() => {
    const notice = error ? errorRef.current : toast ? toastRef.current : null;
    notice?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [toast, error]);
  const request = (path, options = {}) => apiRequest(path, { businessId, signal: AbortSignal.timeout(45000), ...options });
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request('/api/voice/config', { signal: controller.signal })
      .then(config => { if (!controller.signal.aborted) setSettings(config); })
      .catch(() => {});
    request('/api/products?limit=200', { signal: controller.signal })
      .then(catalog => { if (!controller.signal.aborted) setProducts(catalog.products); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { mounted.current = false; controller.abort(); stopReadback(); for (const ctl of controllers.current) ctl.abort(); };
  }, [businessId]);
  const run = async callback => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setToast('');
    const controller = new AbortController(); controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 45000);
    try { await callback(controller.signal); }
    catch (e) { if (mounted.current) { setError(e.name === 'AbortError' ? 'The connection timed out. Check history before trying again. Manual entry is available below.' : e.message || unavailable);
      if (e.code === 'INSUFFICIENT_STOCK') setCommand(previous => previous ? { ...previous, stockError: true } : previous); } }
    finally { clearTimeout(timer); controllers.current.delete(controller); lock.current = false; if (mounted.current) { setBusy(false); setHistoryKey(key => key + 1); } }
  };
  // ctx is the unlocked AudioContext forwarded by LiveRecorder (null on desktop).
  const acceptCommand = (result, ctx) => {
    if (!mounted.current) return;
    if (ctx) liveAudioCtx.current = ctx;
    setError(''); setToast('');
    setCommand(result); setHistoryKey(key => key + 1);
    if (result.status === 'failed') setError(result.message || unavailable);
    if (result.status === 'completed') {
      setToast(result.readback_text);
      void (async () => {
        let blob = null;
        if (result.voice_log_id) {
          try { blob = await request(`/api/voice/commands/${result.voice_log_id}/readback`, { responseType: 'blob' }); } catch { /* Fallback */ }
        }
        void playReadback(blob, result.readback_text, liveAudioCtx.current);
      })();
    }
  };
  const submit = body => run(async signal => {
    const result = await request('/api/voice/commands', { method: 'POST', body, signal });
    acceptCommand(result);
  });
  const acceptReceipt = async (result, ctx) => {
    if (!mounted.current) return;
    if (ctx) liveAudioCtx.current = ctx;
    setError('');
    setProducts(previous => previous.map(p => result.products.find(updated => updated.id === p.id) || p));
    const summary = (result.products || []).map(p => {
      const qty = Number(p.currentQty ?? 0);
      const formatted = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
      const u = (p.unit || '').trim().toLowerCase().replace(/s$/, '');
      const plural = qty === 1 ? u : (u ? `${u}s` : '');
      return `${p.name}: ${formatted} ${plural} remaining`.trim();
    }).join('. ');
    const text = result.receipt_text || (summary ? `Done. ${summary}.` : 'Done. Stock updated.');
    setAlerts(result.low_stock || []); setToast(text); setCommand(null); setHistoryKey(key => key + 1);
    let blob = null;
    if (result.voice_log_id) {
      try { blob = await request(`/api/voice/commands/${result.voice_log_id}/readback`, { responseType: 'blob' }); } catch { /* Fallback */ }
    }
    void playReadback(blob, text, liveAudioCtx.current);
    try { await getActiveSync()?.acceptVoiceResult(result); } catch { /* Periodic pull restores the confirmed server result. */ }
  };
  const confirm = overrides => run(async signal => {
    const result = await request(`/api/voice/commands/${command.voice_log_id}/confirm`, { method: 'POST', body: overrides, signal });
    await acceptReceipt(result);
  });
  return <div className="screen voice-workspace">
    <Top title="Voice inventory" sub="Speak, review, confirm" onBack={back} />
    <div className="voice-actions"><button className="btn soft" onClick={() => setPage('record')}>Record stock</button><button className="btn soft" onClick={() => setPage('history')}>Voice history</button></div>
    {toast && <p ref={toastRef} className="banner royal" role="status">{toast}</p>}
    {alerts.map(alert => <p className="banner amber" role="alert" key={alert.id}>{alert.message}</p>)}
    {error && <p ref={errorRef} className="banner amber" role="alert">{error}{error.toLowerCase().includes('manual entry') ? '' : ' Manual entry is available below.'}</p>}
    {page === 'record' && <>
      {settings?.live && <LiveRecorder key={businessId} busy={busy} request={request} pendingActionId={command && ['pending', 'needs_clarification'].includes(command.status) ? command.voice_log_id : null}
        onError={setError} onFeedback={setToast} onCancel={() => { setCommand(null); setToast('Cancelled. Stock was not changed.'); }} onReceipt={acceptReceipt}
        onCommand={acceptCommand} />}
      <details><summary>Record and upload a short clip instead</summary>
      <VoiceRecorder busy={busy || Boolean(command && ['pending', 'needs_clarification'].includes(command.status))} onError={setError} onAudio={blob => {
        if (blob.size > 5 * 1024 * 1024) { setError('Recording exceeds 5 MB. Try a shorter clip or manual entry.'); return; }
        void run(async signal => {
          const audio = await prepareAudio(blob);
          if (signal.aborted || !mounted.current) return;
          if (audio.size > 5 * 1024 * 1024) throw new Error('Recording exceeds 5 MB. Try a shorter recording.');
          const form = new FormData();
          form.append('audio', audio, audio.type === 'audio/wav' ? 'recording.wav' : audio.type.includes('mp4') ? 'recording.m4a' : 'recording.webm');
          const result = await request('/api/voice/commands', { method: 'POST', body: form, signal });
          acceptCommand(result);
        });
      }} /></details>
      {settings?.mock && <p className="banner royal">Mock demo: recordings use a canned rice transcript. Readback uses device speech when available. Review the card and confirm before stock changes.</p>}
      {settings?.typed_transcript && <form className="card" onSubmit={event => { event.preventDefault(); submit({ transcript: typed }); }}>
        <label>Demo typed transcript<input value={typed} onChange={event => setTyped(event.target.value)} placeholder="I sold 2 bags of rice" /></label>
        <button className="btn soft" disabled={busy || Boolean(command && ['pending', 'needs_clarification'].includes(command.status))}>Review transcript</button>
      </form>}
    </>}
    {command && ['pending', 'needs_clarification'].includes(command.status) && <ConfirmationCard key={command.voice_log_id} command={command} products={products} busy={busy} request={request} onConfirm={confirm} preferDeviceSpeech={settings?.mock === true} audioContext={liveAudioCtx.current}
      onReject={() => run(async signal => { await request(`/api/voice/commands/${command.voice_log_id}/reject`, { method: 'POST', body: {}, signal }); if (mounted.current) { setCommand(null); setToast('Cancelled. Stock was not changed.'); } })} />}
    <ManualEntry products={products} busy={busy || Boolean(command && ['pending', 'needs_clarification'].includes(command.status))} onReview={body => run(async signal => {
      const result = await request('/api/voice/manual', { method: 'POST', body, signal }); if (mounted.current) setCommand(result);
    })} />
    <button className="btn soft" style={{ margin: '0 16px' }} onClick={() => go('stock')}>Open stock / physical count</button>
    {!products.length && <p>No products loaded. <button className="link" onClick={() => go('stock', { add: true })}>Open stock to add products or enter manually</button></p>}
    {page === 'history' && <VoiceHistory request={request} refreshKey={historyKey} onSelect={setCommand} />}
  </div>;
}
