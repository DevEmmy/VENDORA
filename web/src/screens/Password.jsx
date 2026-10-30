import React, { useState } from 'react';
import { Top, Field } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { authApi } from '../features/auth/authApi.js';
import { useAuthStore } from '../features/auth/authStore.js';
import {
  isEnrolledForOfflineAccess,
  preparePasswordChangeRewrap,
  commitPasswordChangeRewrap,
  abortPasswordChangeRewrap,
} from '../features/security/offlineEnrollment.js';
import AuthBanner from '../components/AuthBanner.jsx';

export default function Password() {
  const { back } = useNav();
  const user = useAuthStore(state => state.user);
  const selectedBusinessId = useAuthStore(state => state.selectedBusinessId);
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
    const enrolled = Boolean(user?.id && selectedBusinessId && isEnrolledForOfflineAccess(user.id, selectedBusinessId));
    try {
      if (enrolled) {
        await preparePasswordChangeRewrap({
          userId: user.id,
          businessId: selectedBusinessId,
          currentPassword: current,
          newPassword: password,
        });
      }
      await authApi.changePassword(current, password);
      if (enrolled) {
        await commitPasswordChangeRewrap({
          userId: user.id,
          businessId: selectedBusinessId,
        });
      }
      setCurrent(''); setPassword(''); setConfirm('');
      useAuthStore.getState().expireSession();
    } catch (failure) {
      if (enrolled) {
        abortPasswordChangeRewrap({ userId: user?.id, businessId: selectedBusinessId });
      }
      setError(failure.message || 'Unable to change password.');
    }
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
  const [step, setStep] = useState('request'); // 'request' | 'reset' | 'success'
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleRequest = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setIsError(false);

    try {
      await authApi.forgotPassword(phone.trim());
      setMessage('If this account has a verified recovery destination, instructions have been dispatched. Check your recovery destination or enter your reset token below.');
    } catch (failure) {
      setIsError(true);
      if (failure.status === 503) {
        setMessage('Automated recovery delivery is currently not configured on this server. Please contact your system administrator to configure DELIVERY_URL.');
      } else {
        setMessage(failure.message || 'Unable to request recovery. Please check your phone number and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    if (busy) return;
    setMessage('');
    setIsError(false);

    if (password !== confirm) {
      setIsError(true);
      setMessage('The new passwords do not match.');
      return;
    }

    const len = [...password].length;
    if (len < 8 || len > 128) {
      setIsError(true);
      setMessage('Use 8 to 128 characters and avoid common passwords.');
      return;
    }

    setBusy(true);
    try {
      await authApi.resetPassword(token.trim(), password);
      setStep('success');
      setMessage('Your password has been successfully reset! You can now sign in with your new password.');
    } catch (failure) {
      setIsError(true);
      setMessage(failure.message || 'Invalid or expired recovery token. Please request a new token.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="device onboarding vendora-auth-layout">
      {/* Customer-Focused Desktop Brand Banner */}
      <AuthBanner footer="Vendora Retail Security · Zero-Knowledge Encryption" />

      {/* Form Column */}
      <div className="vendora-auth-form-column">
        <div className="vendora-auth-mobile-header">
          <div className="vendora-auth-brand">
            <span className="vendora-auth-brand-icon" aria-hidden="true">
              V
            </span>
            <span>Vendora</span>
          </div>

          <h1>Password Recovery</h1>
          <p>Reset instructions will be sent to your verified recovery destination.</p>
        </div>

        <div className="vendora-auth-card-container">
          <div className="vendora-auth-card">
            <h2>
              {step === 'success'
                ? 'Password Reset Complete'
                : step === 'reset'
                  ? 'Set New Password'
                  : 'Forgot Password?'}
            </h2>
            <p className="vendora-auth-subtitle">
              {step === 'success'
                ? 'Your account credentials have been updated.'
                : step === 'reset'
                  ? 'Enter the recovery token you received along with your new password.'
                  : 'Enter your registered phone number to receive recovery instructions.'}
            </p>

            <p className="vendora-auth-hint" style={{ margin: '10px 0 16px', lineHeight: 1.5 }}>
              Recovery requires a previously verified recovery destination. A phone number alone cannot reset an account. Recovery enrollment is not available in this app yet.
            </p>

            {message && (
              <div
                role={isError ? 'alert' : 'status'}
                className={isError ? 'vendora-auth-error' : 'vendora-auth-notice'}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.45,
                  marginBottom: 16,
                }}
              >
                {message}
              </div>
            )}

            {step === 'request' && (
              <form onSubmit={handleRequest} className="vendora-auth-form">
                <label className="vendora-auth-field">
                  <span>Phone number</span>
                  <input
                    type="tel"
                    placeholder="08012345678"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    disabled={busy}
                  />
                </label>

                <button
                  type="submit"
                  className="btn primary full"
                  disabled={busy || !phone.trim()}
                  style={{ marginTop: 8 }}
                >
                  {busy ? 'Requesting...' : 'Request recovery'}
                </button>

                <p className="vendora-auth-switch" style={{ margin: '14px 0 0' }}>
                  Have a recovery token?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setStep('reset');
                      setMessage('');
                      setIsError(false);
                    }}
                  >
                    Enter token
                  </button>
                </p>
              </form>
            )}

            {step === 'reset' && (
              <form onSubmit={handleReset} className="vendora-auth-form">
                <label className="vendora-auth-field">
                  <span>Recovery token</span>
                  <input
                    type="text"
                    placeholder="Enter token from recovery message"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <label className="vendora-auth-field">
                  <span>New password</span>
                  <div className="vendora-auth-password">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="8 to 128 characters"
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="vendora-auth-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <label className="vendora-auth-field">
                  <span>Confirm new password</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <button
                  type="submit"
                  className="btn primary full"
                  disabled={busy || !token.trim() || !password}
                  style={{ marginTop: 8 }}
                >
                  {busy ? 'Resetting password...' : 'Set new password'}
                </button>

                <p className="vendora-auth-switch" style={{ margin: '14px 0 0' }}>
                  Need a token?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setStep('request');
                      setMessage('');
                      setIsError(false);
                    }}
                  >
                    Request instructions
                  </button>
                </p>
              </form>
            )}

            {step === 'success' && (
              <button
                type="button"
                className="btn primary full"
                onClick={onBack}
                style={{ marginTop: 12 }}
              >
                Sign in with new password
              </button>
            )}

            {/* Zero-knowledge device encryption security note */}
            <div
              style={{
                marginTop: 18,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(26, 26, 26, 0.04)',
                border: '1px solid var(--line)',
                fontSize: 12,
                lineHeight: 1.45,
                color: 'var(--text-2)',
              }}
            >
              <strong>Security note:</strong> Vendora protects local records with zero-knowledge device encryption. A password reset updates your server account, but unlocking existing offline data on this device still requires your previous device password.
            </div>

            <div className="vendora-auth-divider" style={{ margin: '16px 0' }}>
              <span>or</span>
            </div>

            <button
              type="button"
              className="btn plain full"
              aria-label="Back to sign in"
              onClick={onBack}
              disabled={busy}
              style={{ minHeight: 44, fontWeight: 700 }}
            >
              ← Back to sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
