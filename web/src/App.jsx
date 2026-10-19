import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  Home as HomeIcon,
  ShoppingBag,
  Mic,
  Store,
  Wallet as WalletIcon,
  Package,
  FileText,
  UserRound,
} from "lucide-react";

import { useStore, Toasts } from "./components/ui.jsx";

import {
  loadDemo,
  startCustomDemo,
  runDaily,
  activateAccount,
  activateDemo,
  deactivateAccount,
  updateProfile,
} from "./lib/store.js";

import { primeSpeech, haptic } from "./lib/voice.js";
import { useAuthStore } from "./features/auth/authStore.js";
import { authApi } from "./features/auth/authApi.js";
import { clearPrivateCaches } from "./lib/privacy.js";
import { restoreSession } from "./features/auth/authSession.js";
import {
  startAccountSync,
  getActiveSync,
} from "./features/sync/accountSync.js";
import SyncStatus from "./features/sync/SyncStatus.jsx";

import Welcome from "./screens/Welcome.jsx";
import Setup from "./screens/Setup.jsx";
import OpenAccount from "./screens/OpenAccount.jsx";
import Home from "./screens/Home.jsx";
import Sell from "./screens/Sell.jsx";
import Stock from "./screens/Stock.jsx";
import Wallet from "./screens/Wallet.jsx";
import Assistant from "./screens/Assistant.jsx";
import ConfirmPayment from "./screens/ConfirmPayment.jsx";
import GetPaid from "./screens/GetPaid.jsx";
import LoanApply from "./screens/LoanApply.jsx";
import Score from "./screens/Score.jsx";
import Records from "./screens/Records.jsx";
import Profile from "./screens/Profile.jsx";
import Password, { PasswordRecovery } from "./screens/Password.jsx";
import Staff from "./screens/Staff.jsx";
import Premium from "./screens/Premium.jsx";
import WhatsApp from "./screens/WhatsApp.jsx";
import Insights from "./screens/Insights.jsx";
import SellerPage from "./screens/Seller.jsx";
import CreditAlert from "./screens/CreditAlert.jsx";
import Hub from "./screens/Hub.jsx";
import Advert from "./screens/Advert.jsx";
import Cac from "./screens/Cac.jsx";
import Invoices from "./screens/Invoices.jsx";
import Permissions from "./screens/Permissions.jsx";
import Onboard from "./screens/Onboard.jsx";
import BusinessWorkspace from "./screens/BusinessWorkspace.jsx";

const NavCtx = createContext(null);

export const useNav = () => useContext(NavCtx);

const TABS = {
  home: Home,
  sell: Sell,
  hub: Hub,
  wallet: Wallet,
  stock: Stock,
};

const PAGES = {
  talk: Assistant,
  confirm: ConfirmPayment,
  getpaid: GetPaid,
  loan: LoanApply,
  score: Score,
  records: Records,
  profile: Profile,
  password: Password,
  staff: Staff,
  premium: Premium,
  whatsapp: WhatsApp,
  insights: Insights,
  seller: SellerPage,
  advert: Advert,
  cac: Cac,
  invoices: Invoices,
  permissions: Permissions,
  location: Permissions,
};

function StatusScreen({ title, message, action, actionLabel }) {
  return (
    <div className="device onboarding">
      <div
        style={{
          maxWidth: 420,
          margin: "auto",
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1>{title}</h1>
        <p>{message}</p>

        {action && (
          <button type="button" onClick={action}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function AuthScreen({ onDemo, expired = false }) {
  const [recovering, setRecovering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    password: "",
    businessName: "",
    businessType: "",
    city: "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const change = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (busy) return;

    setError("");

    if (mode === "register") {
      const name = form.name.trim();
      const businessName = form.businessName.trim();
      const city = form.city.trim();
      const phone = form.phone.trim();
      const passwordLength = [...form.password].length;
      const normalizedPhone = phone.replace(/[ +()-]/g, "");
      const validPhone =
        /^0\d{10}$/.test(normalizedPhone) ||
        /^[1-9]\d{9,14}$/.test(normalizedPhone);

      if (name.length < 2 || name.length > 200) {
        setError("Full name must contain 2 to 200 characters.");
        return;
      }

      if (!validPhone || phone.length > 20) {
        setError("Enter a valid phone number, such as 08012345678.");
        return;
      }

      if (passwordLength < 8 || passwordLength > 128) {
        setError("Use 8 to 128 characters and avoid common passwords.");
        return;
      }

      if (businessName.length < 2 || businessName.length > 200) {
        setError("Business name must contain 2 to 200 characters.");
        return;
      }

      if (
        ![
          "Foodstuff",
          "Provisions",
          "Clothing",
          "Phones & accessories",
          "Cosmetics",
          "Pharmacy",
          "Other",
        ].includes(form.businessType)
      ) {
        setError("Please select a valid business type.");
        return;
      }

      if (city.length > 200) {
        setError("City must not exceed 200 characters.");
        return;
      }
    }

    setBusy(true);

    try {
      if (mode === "register") {
        await authApi.register({
          name: form.name.trim(),
          phone: form.phone.trim(),
          password: form.password,
          businessName: form.businessName.trim(),
          businessType: form.businessType.trim(),
          city: form.city.trim(),
        });
      }

      await authApi.login(form.phone.trim(), form.password);

      const session = await authApi.me();

      if (!session?.user) {
        throw new Error("Unable to verify your session.");
      }

      useAuthStore.getState().setSession({
        user: session.user,
        memberships: session.memberships || [],
      });
    } catch (err) {
      setError(err?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  if (recovering)
    return <PasswordRecovery onBack={() => setRecovering(false)} />;

  return (
    <div className="device onboarding vendora-auth">
      <div className="vendora-auth-scroll">
        <header className="vendora-auth-header">
          <div className="vendora-auth-brand">
            <span className="vendora-auth-brand-icon" aria-hidden="true">
              V
            </span>
            <span>Vendora</span>
          </div>

          <h1>{mode === "login" ? "Welcome back!" : "Join Vendora"}</h1>
          <p>
            {mode === "login"
              ? "Your business, right at your fingertips."
              : "Let's get your business ready for better sales."}
          </p>
        </header>

        <main className="vendora-auth-content">
          <div className="vendora-auth-card">
            <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
            <p className="vendora-auth-subtitle">
              {mode === "login"
                ? "Enter your details to continue."
                : "Tell us a little about yourself and your business."}
            </p>

            {expired && (
              <p role="status" className="vendora-auth-notice">
                Your session has ended. Sign in again. Your offline records are
                saved.
              </p>
            )}

            <form onSubmit={submit} className="vendora-auth-form">
              {mode === "register" && (
                <label className="vendora-auth-field">
                  <span>Full name</span>
                  <input
                    placeholder="Your full name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => change("name", e.target.value)}
                    required
                  />
                </label>
              )}

              <label className="vendora-auth-field">
                <span>Phone number</span>
                <input
                  type="tel"
                  placeholder="08012345678"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => change("phone", e.target.value)}
                  required
                />
              </label>

              <label className="vendora-auth-field">
                <span>Password</span>
                <div className="vendora-auth-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    value={form.password}
                    onChange={(e) => change("password", e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="vendora-auth-password-toggle"
                    onClick={() => setShowPassword((previous) => !previous)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              {mode === "register" && (
                <>
                  <label className="vendora-auth-field">
                    <span>Business name</span>
                    <input
                      placeholder="Your business name"
                      value={form.businessName}
                      onChange={(e) => change("businessName", e.target.value)}
                      required
                    />
                  </label>

                  <label className="vendora-auth-field">
                    <span>Business type</span>
                    <select
                      value={form.businessType}
                      onChange={(e) => change("businessType", e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Select business type
                      </option>
                      {[
                        "Foodstuff",
                        "Provisions",
                        "Clothing",
                        "Phones & accessories",
                        "Cosmetics",
                        "Pharmacy",
                        "Other",
                      ].map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="vendora-auth-field">
                    <span>City</span>
                    <input
                      placeholder="e.g. Lagos"
                      value={form.city}
                      onChange={(e) => change("city", e.target.value)}
                      required
                    />
                  </label>

                  <p className="vendora-auth-hint">
                    Use 8 to 128 characters and avoid common passwords.
                  </p>
                </>
              )}

              {error && (
                <p role="alert" className="vendora-auth-error">
                  {error}
                </p>
              )}

              {mode === "login" && (
                <button
                  type="button"
                  className="vendora-auth-forgot"
                  onClick={() => setRecovering(true)}
                >
                  Forgot password?
                </button>
              )}

              <button
                type="submit"
                className="btn primary full"
                disabled={busy}
              >
                {busy
                  ? "Please wait..."
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </form>

            <p className="vendora-auth-switch">
              {mode === "login"
                ? "New to Vendora?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setShowPassword(false);
                  setMode(mode === "login" ? "register" : "login");
                }}
              >
                {mode === "login" ? "Create account" : "Sign in"}
              </button>
            </p>

            <div className="vendora-auth-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="vendora-auth-demo"
              onClick={onDemo}
            >
              Explore demo
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}


export default function App() {
  const [activeScope, setActiveScope] = useState(null);

  const storeState = useStore();
  const creditAlert =
    storeState.alerts?.find(
      (alert) =>
        alert.creditId &&
        storeState.credits?.some((credit) => credit.id === alert.creditId),
    ) ?? null;
  const [loggingOut, setLoggingOut] = useState(false);
  const [authError, setAuthError] = useState("");
  const [scopeError, setScopeError] = useState("");
  const [pendingLogout, setPendingLogout] = useState(false);
  const [tab, setTab] = useState("home");
  const [tabParams, setTabParams] = useState({});
  const [stack, setStack] = useState([]);
  const [onb, setOnb] = useState("welcome");
  const [demoWelcome, setDemoWelcome] = useState(false);
  const onboarded = Boolean(storeState.profile?.onboarded);
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const selectedBusinessId = useAuthStore((s) => s.selectedBusinessId);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = React.useRef(null);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const onPointerDown = (event) => {
      const insideAccountMenu = accountMenuRef.current?.contains(event.target);

      const clickedHomeAvatar =
        event.target instanceof Element &&
        Boolean(event.target.closest(".top .avatar"));

      if (!insideAccountMenu && !clickedHomeAvatar) {
        setAccountMenuOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
        accountMenuRef.current
          ?.querySelector(".vendora-account-trigger")
          ?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);
  const [demoMode, setDemoMode] = useState(
    () => sessionStorage.getItem("vendora:demo-mode") === "true",
  );
  useEffect(() => {
    if (demoMode) {
      sessionStorage.setItem("vendora:demo-mode", "true");
    } else {
      sessionStorage.removeItem("vendora:demo-mode");
    }
  }, [demoMode]);

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    void clearPrivateCaches();
  }, [user?.id, selectedBusinessId]);

  const expectedScope =
    authStatus === "authenticated" && user?.id && selectedBusinessId
      ? `account:${user.id}:${selectedBusinessId}`
      : demoMode
        ? "demo"
        : null;
  useEffect(() => {
    setActiveScope(null);
    setScopeError("");
    let cancelled = false;

    if (authStatus === "authenticated" && user?.id && selectedBusinessId) {
      const isMember = memberships.some(
        (m) => m.businessId === selectedBusinessId,
      );

      if (!isMember) return;

      void activateAccount(user.id, selectedBusinessId)
        .then(() => {
          if (cancelled) return;
          const business = memberships.find(
            (item) => item.businessId === selectedBusinessId,
          )?.business;
          updateProfile({
            name: user.name || "",
            phone: user.phone || "",
            businessName: business?.businessName || "",
            businessType: business?.businessType || "",
            city: business?.city || "",
            onboarded: true,
            demo: false,
          });
          setActiveScope(`account:${user.id}:${selectedBusinessId}`);
        })
        .catch((error) => {
          if (!cancelled) setScopeError(error.message);
        });
      return () => {
        cancelled = true;
      };
    }

    deactivateAccount();

    if (demoMode && authStatus !== "authenticated") {
      activateDemo();
      setActiveScope("demo");
    }
  }, [authStatus, user?.id, selectedBusinessId, memberships, demoMode]);

  useEffect(() => {
    if (
      authStatus !== "authenticated" ||
      !user?.id ||
      !selectedBusinessId ||
      activeScope !== `account:${user.id}:${selectedBusinessId}`
    ) {
      return;
    }

    const stopSync = startAccountSync({
      userId: user.id,
      businessId: selectedBusinessId,
    });

    return stopSync;
  }, [authStatus, user?.id, selectedBusinessId, activeScope]);

  const go = useCallback((page, params = {}) => {
    haptic(8);

    if (TABS[page]) {
      setStack([]);
      setTab(page);
      setTabParams({ ...params, _k: Date.now() });
      return;
    }

    setStack((s) => [...s, { page, params, key: Date.now() }]);

    try {
      history.pushState({ vendora: true }, "");
    } catch {
      // Browser history unavailable.
    }
  }, []);

  const openRoot = useCallback(
    (page) => {
      if (TABS[page]) {
        go(page);
        return;
      }

      haptic(8);
      setStack([{ page, params: {}, key: Date.now() }]);

      try {
        history.pushState({ vendora: true }, "");
      } catch {
        // Browser history unavailable.
      }
    },
    [go],
  );

  const back = useCallback(() => {
    try {
      history.back();
    } catch {
      setStack((s) => s.slice(0, -1));
    }
  }, []);

  useEffect(() => {
    const pop = () => {
      setStack((s) => s.slice(0, -1));
    };

    window.addEventListener("popstate", pop);

    return () => {
      window.removeEventListener("popstate", pop);
    };
  }, []);

  useEffect(() => {
    setStack([]);
    setTab("home");
    setTabParams({});
    setOnb("welcome");
  }, [activeScope]);

  useEffect(() => {
    const unlock = () => {
      primeSpeech();
      window.removeEventListener("pointerdown", unlock);
    };

    window.addEventListener("pointerdown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  const ready = Boolean(expectedScope && activeScope === expectedScope);

  useEffect(() => {
    if (!ready || !onboarded) return;

    runDaily();

    const timer = setInterval(() => runDaily(), 10 * 60 * 1000);

    return () => clearInterval(timer);
  }, [ready, onboarded, activeScope]);

  const logout = async (discardConfirmed = false) => {
    if (loggingOut) return;

    setLoggingOut(true);
    setAuthError("");

    try {
      const sync = getActiveSync();
      if (sync) {
        if (discardConfirmed === true) await sync.discardForLogout();
        else {
          await sync.sync();
          if (await sync.pending()) {
            setPendingLogout(true);
            return;
          }
        }
      }
      setPendingLogout(false);
      await authApi.logout();

      await clearPrivateCaches();

      deactivateAccount();
      useAuthStore.getState().setGuest();
      setDemoMode(false);
      setActiveScope(null);
    } catch (error) {
      setAuthError(error?.message || "Could not sign out. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  };

  if (authStatus === "loading" && !demoMode) {
    return (
      <StatusScreen
        title="Loading Vendora"
        message="Checking your session..."
      />
    );
  }

  if (authStatus === "unavailable" && !demoMode) {
    return (
      <div className="device onboarding">
        <div
          style={{
            maxWidth: 420,
            margin: "auto",
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1>Connection unavailable</h1>

          <p>
            We couldn't verify your session because the server is unreachable.
            Your account data remains protected.
          </p>

          <button type="button" onClick={restoreSession}>
            Try again
          </button>

          <p>
            <button
              type="button"
              onClick={() => {
                activateDemo();
                setOnb("welcome");
                setDemoWelcome(true);
                setDemoMode(true);
              }}
            >
              Explore offline demo
            </button>
          </p>
        </div>
      </div>
    );
  }
  if ((authStatus === "guest" || authStatus === "expired") && !demoMode) {
    return (
      <AuthScreen
        expired={authStatus === "expired"}
        onDemo={() => {
          activateDemo();
          setOnb("welcome");
          setDemoWelcome(true);
          setDemoMode(true);
        }}
      />
    );
  }

  if (authStatus === "authenticated" && !selectedBusinessId) {
    return (
      <StatusScreen
        title="No business available"
        message="Your account does not currently have an accessible business."
        action={logout}
        actionLabel="Sign out"
      />
    );
  }

  if (!ready) {
    return (
      <StatusScreen
        title="Loading business"
        message={scopeError || "Preparing your business workspace..."}
        action={scopeError ? () => location.reload() : undefined}
        actionLabel="Try again"
      />
    );
  }

  if (authStatus === "authenticated") {
    const membership = memberships.find(
      (item) => item.businessId === selectedBusinessId,
    );

    if (!membership) {
      return (
        <StatusScreen
          title="Business unavailable"
          message="We couldn't find your selected business membership."
          action={logout}
          actionLabel="Sign out"
        />
      );
    }
  }
  if (authStatus !== "authenticated" && (demoWelcome || !onboarded)) {
    return (
      <div className="device onboarding">
        {onb === "welcome" && (
          <Welcome
            next={() => {
              startCustomDemo();
              setDemoWelcome(true);
              setOnb("setup");
            }}
            onSample={() => {
              loadDemo();
              setDemoWelcome(false);
            }}
          />
        )}

        {onb === "setup" && (
          <Setup next={() => setOnb("perms")} back={() => setOnb("welcome")} />
        )}

        {onb === "perms" && (
          <Onboard
            next={() => setOnb("account")}
            back={() => setOnb("setup")}
          />
        )}

        {onb === "account" && (
          <OpenAccount
            back={() => setOnb("perms")}
            onComplete={() => setDemoWelcome(false)}
          />
        )}

        {demoMode && (
          <div className="vendora-demo-exit-wrap">
            <button
              type="button"
              className="vendora-demo-exit"
              onClick={() => {
                setDemoMode(false);
                deactivateAccount();
              }}
            >
              Exit demo
            </button>
          </div>
        )}

        <Toasts />
      </div>
    );
  }

  const top = stack[stack.length - 1];
  const Page = top ? PAGES[top.page] : null;
  const Tab = TABS[tab];

  const navItems = [
    ["home", "Home", HomeIcon],
    ["sell", "Sell", ShoppingBag],
    ["talk", "Talk", Mic],
    ["hub", "Hub", Store],
    ["wallet", "Wallet", WalletIcon],
    ["stock", "My stock", Package, true],
    ["invoices", "Invoices", FileText, true],
    ["profile", "Profile", UserRound, true],
  ];

  const current = top ? top.page : tab;

  return (
    <NavCtx.Provider
      value={{
        go,
        back,
        tab,
        openAccountMenu: () => setAccountMenuOpen((open) => !open),
      }}
    >
      <div className="device app">
        <nav className={"nav" + (Page ? " page-open" : "")} aria-label="Main">
          <div className="brand">
            <span className="brand-mark">
              <Mic size={18} strokeWidth={2.6} />
            </span>
            Vendora
          </div>

          {navItems.map(([key, label, Icon, deskOnly]) =>
            key === "talk" ? (
              <button
                key={key}
                className="talk"
                onClick={() => go("talk", { autoListen: true })}
                aria-label="Talk to Vendora"
              >
                <span className="orb">
                  <Icon size={28} strokeWidth={2.4} />
                </span>

                <span>{label}</span>

                <span className="talk-long">Talk to Vendora</span>
              </button>
            ) : (
              <button
                key={key}
                className={deskOnly ? "desk-only" : undefined}
                aria-current={current === key ? "page" : undefined}
                onClick={() => openRoot(key)}
              >
                <Icon size={23} strokeWidth={current === key ? 2.5 : 2} />

                <span>{label}</span>
              </button>
            ),
          )}

          <div className="vendora-account" ref={accountMenuRef}>
            <button
              type="button"
              className="vendora-account-trigger"
              aria-label="Account options"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="vendora-account-avatar">
                {authStatus === "authenticated"
                  ? (user?.name || user?.email || "A").charAt(0).toUpperCase()
                  : "D"}
              </span>

              <span className="vendora-account-trigger-text">
                <strong>
                  {authStatus === "authenticated"
                    ? memberships.find(
                        (membership) =>
                          membership.businessId === selectedBusinessId,
                      )?.business?.name || "My business"
                    : "Demo account"}
                </strong>
                <small>Account settings</small>
              </span>

              <span className="vendora-account-chevron" aria-hidden="true">
                {accountMenuOpen ? "â–²" : "â–¼"}
              </span>
            </button>

            {accountMenuOpen && (
              <div className="vendora-account-menu">
                {authStatus === "authenticated" && memberships.length > 1 && (
                  <div className="vendora-business-picker">
                    <label htmlFor="vendora-business-select">
                      Switch business
                    </label>
                    <select
                      id="vendora-business-select"
                      value={selectedBusinessId}
                      onChange={(event) => {
                        useAuthStore
                          .getState()
                          .selectBusiness(event.target.value);
                        setAccountMenuOpen(false);
                      }}
                    >
                      {memberships.map((membership) => (
                        <option
                          key={membership.businessId}
                          value={membership.businessId}
                        >
                          {membership.business?.name || membership.businessId}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  className="vendora-account-signout"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    go("profile");
                  }}
                >
                  Profile &amp; Settings
                </button>

                <button
                  type="button"
                  className="vendora-account-signout"
                  disabled={loggingOut}
                  onClick={() => {
                    setAccountMenuOpen(false);

                    if (authStatus === "authenticated") {
                      logout();
                    } else {
                      deactivateAccount();
                      setDemoMode(false);
                    }
                  }}
                >
                  {authStatus === "authenticated"
                    ? loggingOut
                      ? "Signing out..."
                      : "Sign out"
                    : "Exit demo"}
                </button>
              </div>
            )}
          </div>
        </nav>

        <main className="main">
          {authStatus === "authenticated" && <SyncStatus />}
          {authError && <p role="alert">{authError}</p>}

          {Page ? (
            <Page key={top.key} {...top.params} />
          ) : (
            <Tab key={tab + (tabParams._k || "")} {...tabParams} />
          )}
        </main>

        {creditAlert && <CreditAlert alert={creditAlert} />}
        {pendingLogout && (
          <div className="scrim">
            <section
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Unsynced records"
            >
              <h2>Records still need to sync</h2>
              <p>
                Keep this account open to synchronize them, or explicitly
                discard its pending uploads before signing out.
              </p>
              {authError && <p role="alert">{authError}</p>}
              <button
                className="btn soft full"
                onClick={() => setPendingLogout(false)}
              >
                Keep working
              </button>
              <button
                className="btn primary full"
                disabled={loggingOut}
                onClick={() => logout()}
              >
                Sync and sign out
              </button>
              <button
                className="btn danger full"
                disabled={loggingOut}
                onClick={() => logout(true)}
              >
                Discard pending uploads and sign out
              </button>
            </section>
          </div>
        )}

        <Toasts />
      </div>
    </NavCtx.Provider>
  );
}
