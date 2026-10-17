import React, { useState } from 'react';
import { Top, Field } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { authApi } from '../features/auth/authApi.js';
import { useAuthStore } from '../features/auth/authStore.js';

export default function Password() {
  const { back } = useNav();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) { setError('The new passwords do not match.'); return; }
    if ([...password].length < 8 || [...password].length > 128) { setError('Use 8–128 characters.'); return; }
    setBusy(true); setError('');
    try {
      await authApi.changePassword(current, password);
      setCurrent(''); setPassword(''); setConfirm('');
      useAuthStore.getState().expireSession();
    } catch (failure) { setError(failure.message || 'Unable to change password.'); }
    finally { setBusy(false); }
  };
  return <div className="page"><Top title="Change password" onBack={back} /><div className="wrap">
    <p>Use 8–128 characters and avoid common passwords. Changing it signs out every device. Local records and pending uploads stay saved.</p>
    <form onSubmit={save}>
      <Field label="Current password"><input aria-label="Current password" type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} /></Field>
      <Field label="New password"><input aria-label="New password" type="password" autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} /></Field>
      <Field label="Confirm new password"><input aria-label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /></Field>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="btn primary full" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
    <p className="small">Password recovery requires a previously verified recovery destination. A phone number alone cannot reset an account. Recovery enrollment is not available in this app yet.</p>
  </div></div>;
}

export function PasswordRecovery({ onBack }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="device onboarding"><div className="wrap" style={{ paddingTop: 40 }}>
    <h1>Password recovery</h1>
    <p>Recovery requires a previously verified recovery destination. A phone number alone cannot reset your account. Recovery enrollment is not available in this app yet.</p>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try { await authApi.forgotPassword(phone); setMessage('If this account has a verified recovery destination, recovery instructions will be sent there.'); }
      catch (failure) { setMessage(failure.message || 'Unable to request recovery. Try again.'); }
      finally { setBusy(false); }
    }}>
      <Field label="Phone number"><input aria-label="Phone number" type="tel" required value={phone} onChange={event => setPhone(event.target.value)} /></Field>
      <button className="btn primary full" disabled={busy}>{busy ? 'Sending…' : 'Request recovery'}</button>
    </form>
    {message && <p role="status">{message}</p>}
    <button className="btn plain full" onClick={onBack}>Back to sign in</button>
  </div></div>;
}
