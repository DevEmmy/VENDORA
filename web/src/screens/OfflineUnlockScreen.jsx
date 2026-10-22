import React, { useState } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
  WifiOff,
  Store,
  LogOut,
  RefreshCw,
  KeyRound,
} from "lucide-react";
import {
  unlockOfflineAccess,
  evaluateAccountOfflineAccess,
  getLastEnrolledAccount,
  recordOnlineVerification,
  reconcileCrossDevicePasswordChange,
} from "../features/security/offlineEnrollment.js";
import { setOfflineSessionUnlocked } from "../features/security/offlineSession.js";
import { activateOfflineAccount, activateDemo } from "../lib/store.js";
import { restoreSession } from "../features/auth/authSession.js";
import AuthBanner from "../components/AuthBanner.jsx";

export default function OfflineUnlockScreen({
  onDemo,
  onUnlocked,
  isOnline = false,
  accountInfo = null,
  onSignOut = null,
  memberships = [],
  onSwitchBusiness = null,
}) {
  const enrolled =
    isOnline && accountInfo ? accountInfo : getLastEnrolledAccount();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Cross-device password reconciliation states
  const [reconciling, setReconciling] = useState(false);
  const [previousPassword, setPreviousPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPrevPassword, setShowPrevPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  if (!enrolled) {
    return (
      <div className="device onboarding vendora-auth-layout">
        <div className="vendora-auth-form-column" style={{ margin: "auto" }}>
          <div className="vendora-auth-card-container">
            <div className="vendora-auth-card" style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  backgroundColor: "#fce8e6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                  color: "#c5221f",
                }}
              >
                <AlertCircle size={28} />
              </div>
              <h2>
                {isOnline ? "Storage Locked" : "No offline account found"}
              </h2>
              <p className="vendora-auth-subtitle">
                {isOnline
                  ? "This device contains locked records, but account metadata could not be resolved."
                  : "This device does not have an account enrolled for offline access."}
              </p>
              {isOnline && onSignOut ? (
                <button
                  type="button"
                  className="btn primary full"
                  onClick={onSignOut}
                >
                  Sign out safely
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary full"
                  onClick={() => restoreSession()}
                >
                  Try reconnecting
                </button>
              )}
              {onDemo && (
                <p style={{ marginTop: 16 }}>
                  <button type="button" className="btn plain" onClick={onDemo}>
                    Explore demo
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const policy = isOnline
    ? { allowed: true, remainingMs: 7 * 24 * 60 * 60 * 1000 }
    : evaluateAccountOfflineAccess(enrolled.userId, enrolled.businessId);

  const daysLeft =
    policy.remainingMs > 0
      ? Math.ceil(policy.remainingMs / (24 * 60 * 60 * 1000))
      : 0;

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (!password) {
      setError("Enter your account password to unlock.");
      return;
    }

    setBusy(true);
    try {
      if (isOnline) {
        recordOnlineVerification(enrolled.userId, enrolled.businessId);
      }
      const { accountKey, policy: accessPolicy } = await unlockOfflineAccess({
        userId: enrolled.userId,
        businessId: enrolled.businessId,
        password,
      });

      // Activate store with the unwrapped in-memory CryptoKey
      await activateOfflineAccount(
        enrolled.userId,
        enrolled.businessId,
        accountKey,
      );

      if (!isOnline) {
        // Mark offline session as unlocked
        setOfflineSessionUnlocked(
          enrolled.userId,
          enrolled.businessId,
          accessPolicy,
        );
      }

      if (typeof onUnlocked === "function") {
        onUnlocked({
          userId: enrolled.userId,
          businessId: enrolled.businessId,
          accountKey,
        });
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to unlock this account. Check your password and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReconcile = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (!previousPassword) {
      setError("Enter the previous password used on this device.");
      return;
    }
    if (!newPassword) {
      setError("Enter your current Vendora password.");
      return;
    }

    setBusy(true);
    try {
      if (isOnline) {
        recordOnlineVerification(enrolled.userId, enrolled.businessId);
      }

      await reconcileCrossDevicePasswordChange({
        userId: enrolled.userId,
        businessId: enrolled.businessId,
        previousPassword,
        newPassword,
      });

      const { accountKey, policy: accessPolicy } = await unlockOfflineAccess({
        userId: enrolled.userId,
        businessId: enrolled.businessId,
        password: newPassword,
      });

      await activateOfflineAccount(
        enrolled.userId,
        enrolled.businessId,
        accountKey,
      );

      if (!isOnline) {
        setOfflineSessionUnlocked(
          enrolled.userId,
          enrolled.businessId,
          accessPolicy,
        );
      }

      if (typeof onUnlocked === "function") {
        onUnlocked({
          userId: enrolled.userId,
          businessId: enrolled.businessId,
          accountKey,
        });
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to update local key. Please verify your passwords.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="device onboarding vendora-auth-layout">
      {/* Customer-Focused Desktop Brand Banner */}
      <AuthBanner
        footer={
          isOnline
            ? "Server session verified · Device storage locked"
            : "Working offline · Protected by client encryption"
        }
      />

      {/* Form Column */}
      <div className="vendora-auth-form-column">
        <div className="vendora-auth-mobile-header">
          <div className="vendora-auth-brand">
            <span className="vendora-auth-brand-icon" aria-hidden="true">
              V
            </span>
            <span>Vendora</span>
          </div>

          <h1>
            {isOnline ? "Secure Business Access" : "Unlock Vendora Offline"}
          </h1>
          <p>
            {isOnline
              ? "Your business records are safely encrypted on this device. Enter your password to unlock your offline inventory and pending sales."
              : "The server is unreachable. You can unlock your business data using your password and continue permitted sales."}
          </p>
        </div>

        <div className="vendora-auth-card-container">
          <div className="vendora-auth-card">
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  backgroundColor: "#e6f4ea",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                  color: "#137333",
                }}
              >
                <Lock size={26} />
              </div>

              <h2
                style={{ fontSize: 21, margin: "0 0 6px", color: "var(--ink)" }}
              >
                {isOnline ? "Unlock Business Records" : "Unlock Shop"}
              </h2>
              <p
                className="vendora-auth-subtitle"
                style={{ margin: "0 0 16px" }}
              >
                {isOnline
                  ? "Enter your Vendora password to access encrypted local storage."
                  : "Continue offline sales with your saved inventory."}
              </p>
            </div>

            {/* Account Badge */}
            <div
              style={{
                background: "#f8f9fa",
                borderRadius: 12,
                padding: "12px 16px",
                marginBottom: 20,
                border: "1px solid #dadce0",
              }}
            >
              <div
                style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}
              >
                {enrolled.businessName || "Your Business"}
              </div>
              <div
                style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}
              >
                {enrolled.userName || enrolled.phone || "Account Holder"}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
                  fontSize: 12,
                  color: isOnline || policy.allowed ? "#137333" : "#c5221f",
                  fontWeight: 600,
                }}
              >
                {isOnline ? (
                  <>
                    <ShieldCheck size={14} />
                    <span>
                      Online session active · Encrypted local database
                    </span>
                  </>
                ) : policy.allowed ? (
                  <>
                    <ShieldCheck size={14} />
                    <span>
                      Offline access active ({daysLeft}{" "}
                      {daysLeft === 1 ? "day" : "days"} remaining)
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={14} />
                    <span>
                      Offline verification window expired. Reconnect to renew.
                    </span>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  background: "#fce8e6",
                  color: "#c5221f",
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <AlertCircle
                  size={16}
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <span>{error}</span>
              </div>
            )}

            {!reconciling ? (
              <form onSubmit={handleUnlock} className="vendora-auth-form">
                <label className="vendora-auth-field">
                  <span>Account Password</span>
                  <div className="vendora-auth-password">
                    <input
                      id="offline-unlock-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your Vendora password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      disabled={busy || (!isOnline && !policy.allowed)}
                      required
                    />
                    <button
                      type="button"
                      className="vendora-auth-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <button
                  type="submit"
                  className="btn primary full"
                  disabled={busy || (!isOnline && !policy.allowed)}
                  style={{ marginTop: 8 }}
                >
                  {busy
                    ? "Unlocking..."
                    : isOnline
                      ? "Unlock Records"
                      : "Unlock Shop"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleReconcile} className="vendora-auth-form">
                <div
                  style={{
                    background: "#e8f0fe",
                    color: "#1a73e8",
                    padding: "10px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <strong>Changed password on another device?</strong> Enter the
                  previous password used on this device to re-wrap local records
                  with your new password. No data will be re-encrypted or lost.
                </div>

                <label className="vendora-auth-field">
                  <span>Previous Password (Used on this device)</span>
                  <div className="vendora-auth-password">
                    <input
                      type={showPrevPassword ? "text" : "password"}
                      placeholder="Previous password"
                      value={previousPassword}
                      onChange={(e) => setPreviousPassword(e.target.value)}
                      autoComplete="current-password"
                      disabled={busy}
                      required
                    />
                    <button
                      type="button"
                      className="vendora-auth-password-toggle"
                      onClick={() => setShowPrevPassword(!showPrevPassword)}
                    >
                      {showPrevPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <label className="vendora-auth-field">
                  <span>New Password (Current account password)</span>
                  <div className="vendora-auth-password">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      placeholder="New password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      disabled={busy}
                      required
                    />
                    <button
                      type="button"
                      className="vendora-auth-password-toggle"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <button
                  type="submit"
                  className="btn primary full"
                  disabled={busy}
                  style={{ marginTop: 8 }}
                >
                  {busy ? "Updating key..." : "Update Key & Unlock"}
                </button>
              </form>
            )}

            {/* Secondary actions */}
            <div
              style={{
                textAlign: "center",
                marginTop: 20,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {isOnline && (
                <button
                  type="button"
                  className="link small"
                  onClick={() => {
                    setReconciling(!reconciling);
                    setError("");
                  }}
                  disabled={busy}
                  style={{
                    color: "var(--royal)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 6,
                  }}
                >
                  <KeyRound
                    size={14}
                    style={{
                      display: "inline",
                      verticalAlign: "middle",
                      marginRight: 4,
                    }}
                  />
                  {reconciling
                    ? "Back to standard unlock"
                    : "Changed password on another device?"}
                </button>
              )}

              {isOnline && onSignOut && (
                <button
                  type="button"
                  className="btn plain sm"
                  onClick={onSignOut}
                  disabled={busy}
                  style={{ color: "var(--text-2)" }}
                >
                  <LogOut
                    size={14}
                    style={{
                      display: "inline",
                      verticalAlign: "middle",
                      marginRight: 6,
                    }}
                  />
                  Sign out safely (preserves local data)
                </button>
              )}

              {isOnline &&
                memberships &&
                memberships.length > 1 &&
                onSwitchBusiness && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <span style={{ color: "var(--text-3)" }}>
                      Switch business:{" "}
                    </span>
                    <select
                      onChange={(e) => onSwitchBusiness(e.target.value)}
                      value={enrolled.businessId}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                      }}
                      disabled={busy}
                    >
                      {memberships.map((m) => (
                        <option key={m.businessId} value={m.businessId}>
                          {m.business?.businessName || m.businessId}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              {!isOnline && (
                <>
                  <button
                    type="button"
                    className="btn plain sm"
                    onClick={() => restoreSession()}
                    disabled={busy}
                  >
                    <RefreshCw
                      size={14}
                      style={{
                        display: "inline",
                        verticalAlign: "middle",
                        marginRight: 6,
                      }}
                    />
                    Try reconnecting to server
                  </button>

                  {onDemo && (
                    <button
                      type="button"
                      className="btn plain sm"
                      onClick={onDemo}
                      disabled={busy}
                    >
                      Explore sample demo shop
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
