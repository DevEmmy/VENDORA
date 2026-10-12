import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Home as HomeIcon, ShoppingBag, Mic, Store, Wallet as WalletIcon } from 'lucide-react';
import { useStore, Toasts } from './components/ui.jsx';
import { runDaily, syncNow, hasServer } from './lib/store.js';
import { primeSpeech, haptic } from './lib/voice.js';
import Welcome from './screens/Welcome.jsx';
import Setup from './screens/Setup.jsx';
import OpenAccount from './screens/OpenAccount.jsx';
import Home from './screens/Home.jsx';
import Sell from './screens/Sell.jsx';
import Stock from './screens/Stock.jsx';
import Wallet from './screens/Wallet.jsx';
import Assistant from './screens/Assistant.jsx';
import ConfirmPayment from './screens/ConfirmPayment.jsx';
import GetPaid from './screens/GetPaid.jsx';
import LoanApply from './screens/LoanApply.jsx';
import Score from './screens/Score.jsx';
import Records from './screens/Records.jsx';
import Profile from './screens/Profile.jsx';
import Staff from './screens/Staff.jsx';
import Premium from './screens/Premium.jsx';
import WhatsApp from './screens/WhatsApp.jsx';
import Insights from './screens/Insights.jsx';
import SellerPage from './screens/Seller.jsx';
import CreditAlert from './screens/CreditAlert.jsx';
import Hub from './screens/Hub.jsx';
import Advert from './screens/Advert.jsx';
import Cac from './screens/Cac.jsx';
import Invoices from './screens/Invoices.jsx';
import Permissions from './screens/Permissions.jsx';
import Onboard from './screens/Onboard.jsx';

const NavCtx = createContext(null);
export const useNav = () => useContext(NavCtx);

const TABS = { home: Home, sell: Sell, hub: Hub, wallet: Wallet, stock: Stock };
const PAGES = { talk: Assistant, confirm: ConfirmPayment, getpaid: GetPaid, loan: LoanApply, score: Score, records: Records, profile: Profile, staff: Staff, premium: Premium, whatsapp: WhatsApp, insights: Insights, seller: SellerPage, advert: Advert, cac: Cac, invoices: Invoices, permissions: Permissions, location: Permissions };

export default function App() {
  const onboarded = useStore(s => s.profile.onboarded);
  const creditAlert = useStore(s => s.alerts.find(a => a.kind === 'credit'));
  const [tab, setTab] = useState('home');
  const [tabParams, setTabParams] = useState({});
  const [stack, setStack] = useState([]);
  const [onb, setOnb] = useState('welcome');

  const go = useCallback((page, params = {}) => {
    haptic(8);
    if (TABS[page]) { setStack([]); setTab(page); setTabParams({ ...params, _k: Date.now() }); return; }
    setStack(s => [...s, { page, params, key: Date.now() }]);
    try { history.pushState({ vendora: true }, ''); } catch { /* ignore */ }
  }, []);
  // In-app back and the phone's back button do the same thing.
  const back = useCallback(() => { try { history.back(); } catch { setStack(s => s.slice(0, -1)); } }, []);
  useEffect(() => {
    const pop = () => setStack(s => s.slice(0, -1));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  useEffect(() => { setStack([]); setTab('home'); setTabParams({}); setOnb('welcome'); }, [onboarded]);
  useEffect(() => {
    // Phones only allow sound after the first tap: unlock spoken replies then.
    const unlock = () => { primeSpeech(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);
  useEffect(() => {
    if (!onboarded) return;
    runDaily();
    const t = setInterval(() => runDaily(), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [onboarded]);
  useEffect(() => {
    if (!onboarded || !hasServer()) return;
    syncNow();
    const t = setInterval(syncNow, 20000);
    const vis = () => document.visibilityState === 'visible' && syncNow();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [onboarded]);

  if (!onboarded) {
    return (
      <div className="device">
        {onb === 'welcome' && <Welcome next={() => setOnb('setup')} />}
        {onb === 'setup' && <Setup next={() => setOnb('perms')} back={() => setOnb('welcome')} />}
        {onb === 'perms' && <Onboard next={() => setOnb('account')} back={() => setOnb('setup')} />}
        {onb === 'account' && <OpenAccount back={() => setOnb('perms')} />}
        <Toasts />
      </div>
    );
  }

  const top = stack[stack.length - 1];
  const Page = top ? PAGES[top.page] : null;
  const Tab = TABS[tab];
  const navItems = [['home', 'Home', HomeIcon], ['sell', 'Sell', ShoppingBag], ['talk', 'Talk', Mic], ['hub', 'Hub', Store], ['wallet', 'Wallet', WalletIcon]];
  return (
    <NavCtx.Provider value={{ go, back, tab }}>
      <div className="device">
        {Page ? <Page key={top.key} {...top.params} /> : (
          <>
            <Tab key={tab + (tabParams._k || '')} {...tabParams} />
            <nav className="nav" aria-label="Main">
              {navItems.map(([k, l, Icon]) => k === 'talk' ? (
                <button key={k} className="talk" onClick={() => go('talk', { autoListen: true })} aria-label="Talk to Vendora">
                  <span className="orb"><Icon size={28} strokeWidth={2.4} /></span><span>{l}</span>
                </button>
              ) : (
                <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>
                  <Icon size={23} strokeWidth={tab === k ? 2.5 : 2} /><span>{l}</span>
                </button>
              ))}
            </nav>
          </>
        )}
        {creditAlert && <CreditAlert alert={creditAlert} />}
        <Toasts />
      </div>
    </NavCtx.Provider>
  );
}
