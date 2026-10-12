import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, X, CheckCircle2, Search } from 'lucide-react';
import { useRef } from 'react';
import { getState, subscribe, dismissAlert } from '../lib/store.js';

export function useStore(selector = s => s) {
  return selector(useSyncExternalStore(subscribe, getState));
}

export function Top({ title, sub, onBack, right, children, tall, round = true }) {
  return (
    <header className={'top' + (round ? ' round' : '') + (tall ? ' tall' : '')}>
      <div className="top-row">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label="Go back"><ArrowLeft size={22} /></button>}
        <div className="grow">
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}

export function Sheet({ title, sub, onClose, children }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        {title && (
          <div className="sheet-head">
            <div className="grow"><h2>{title}</h2>{sub && <div className="muted" style={{ fontSize: 14 }}>{sub}</div>}</div>
            <button className="icon-btn light" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, pre, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      {label && <span className="label">{label}</span>}
      <div className="field">{pre && <span className="pre">{pre}</span>}{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

export function Toggle({ on, onChange, label }) {
  return <button className="toggle" role="switch" aria-checked={!!on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(([k, l, Icon]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{Icon && <Icon size={16} />}{l}</button>
      ))}
    </div>
  );
}

export function Toasts() {
  const alerts = useStore(s => s.alerts.filter(a => a.kind === 'toast'));
  const ids = alerts.map(a => a.id).join(',');
  useEffect(() => {
    const timers = alerts.map(a => setTimeout(() => dismissAlert(a.id), Math.max(400, 2800 - (Date.now() - a.at))));
    return () => timers.forEach(clearTimeout);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="toasts" aria-live="polite">
      {alerts.slice(-1).map(a => <div key={a.id} className={'toast ' + (a.tone || '')}>{a.tone === 'good' && <CheckCircle2 size={20} />}{a.text}</div>)}
    </div>
  );
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

export function StockPill({ p }) {
  if (p.qty <= 0) return <span className="pill pepper">Out of stock</span>;
  if (p.qty <= p.lowAt) return <span className="pill amber">Running low</span>;
  return <span className="pill leaf">In stock</span>;
}

export function Empty({ icon: Icon, title, body, action }) {
  return (
    <div className="card center" style={{ padding: '28px 20px' }}>
      {Icon && <div className="ic royal" style={{ width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', margin: '0 auto' }}><Icon size={26} /></div>}
      <div style={{ fontWeight: 800, fontSize: 17, marginTop: 12 }}>{title}</div>
      {body && <div className="muted" style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.45 }}>{body}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export const initials = name => (name || 'V').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** Search box: the icon is a real button, Enter/Search on the keyboard works, X clears. */
export function SearchBar({ value, onChange, placeholder = 'Search', label, onSubmit, autoFocus }) {
  const ref = useRef(null);
  const submit = e => { e.preventDefault(); ref.current?.blur(); onSubmit?.(value); };
  return (
    <form className="search" role="search" onSubmit={submit}>
      <button type="submit" className="search-go" aria-label="Search"><Search size={19} /></button>
      <input ref={ref} type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} enterKeyHint="search" autoComplete="off" autoFocus={autoFocus} />
      {value && <button type="button" className="search-x" onClick={() => { onChange(''); ref.current?.focus(); }} aria-label="Clear search"><X size={18} /></button>}
    </form>
  );
}
