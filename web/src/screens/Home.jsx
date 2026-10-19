import React from 'react';
import { useAuthStore } from '../features/auth/authStore.js';
import { ShoppingBag, PackagePlus, QrCode, ScanLine, BookUser, Landmark, Store, ShieldCheck, ShieldAlert, Mic, Lightbulb, ChevronRight, Truck, FileText, BadgeCheck, FileSpreadsheet, MapPin } from 'lucide-react';
import { useStore, useOnline, initials } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { totals, restockForecast, adviceCards } from '../lib/insights.js';
import { naira, nairaShort, greeting, timeAgo, qtyUnit } from '../lib/format.js';
import { currentStaff, integrity, businessScoreNow } from '../lib/store.js';
import { offersFor } from '../lib/hub.js';
import { TxnRow } from './Wallet.jsx';
import StockAlerts from '../features/inventory/StockAlerts.jsx';

export default function Home() {
  const s = useStore();
  const { go, openAccountMenu } = useNav();
  const online = useOnline();
  const p = s.profile;
  const live = s.txns.filter(t => !t.reversed);
  const today = totals(live, 'today');
  const integ = integrity(s);
  const score = businessScoreNow();
  const owed = s.customers.reduce((a, c) => a + (c.balance || 0), 0);
  const staff = currentStaff(s);
  const owner = !staff || staff.isOwner;
  const forecast = restockForecast(s.products, live).find(f => f.daysLeft < 4 && f.perDay > 0) || null;
  const outOrLow = s.products.filter(x => x.qty <= x.lowAt);
  const focus = forecast?.product || outOrLow[0];
  const offers = focus ? offersFor(focus) : [];
  const unmatched = s.credits.filter(c => !c.handled);
  const arriving = s.orders.filter(o => o.status !== 'delivered');
  const advice = adviceCards({ ...s, txns: live }).slice(0, 2);
  const authStatus = useAuthStore(state => state.status);
  const authUser = useAuthStore(state => state.user);

  const localName = staff && !staff.isOwner
    ? staff.name
    : (p.name || '');

  const authenticatedName =
    authStatus === 'authenticated'
      ? (authUser?.name?.trim() || '')
      : '';

  const displayName = authenticatedName || localName.trim();
  const firstName = displayName.split(/\s+/)[0] || '';

  const name = firstName || 'Welcome back!';
  const avatarInitial = firstName
    ? firstName.charAt(0).toUpperCase()
    : 'V';

  const actions = [
    { k: 'sell', label: 'Record a sale', icon: ShoppingBag, tone: 'royal', go: () => go('sell') },
    { k: 'stock', label: 'My stock', icon: PackagePlus, tone: 'leaf', go: () => go('stock'), badge: outOrLow.length ? `${outOrLow.length} low` : null },
    { k: 'getpaid', label: 'Collect transfer', icon: QrCode, tone: 'ink', go: () => go('getpaid') },
    { k: 'confirm', label: 'Check a receipt', icon: ScanLine, tone: 'amber', go: () => go('confirm') },
    { k: 'debts', label: 'Debts', icon: BookUser, tone: 'pepper', go: () => go('wallet', { seg: 'debts' }), badge: owed > 0 ? nairaShort(owed) : null },
    { k: 'invoices', label: 'Invoices', icon: FileText, tone: 'royal', go: () => go('invoices') },
    { k: 'loan', label: 'Wema loan', icon: Landmark, tone: 'kola', go: () => go('wallet', { seg: 'loans' }), hidden: !owner },
    { k: 'cac', label: s.cac.status === 'registered' ? 'CAC registered' : 'Get CAC', icon: BadgeCheck, tone: 'leaf', go: () => go('cac'), hidden: !owner, badge: s.cac.plan && s.cac.status === 'saving' ? `${Math.round(s.cac.plan.saved / s.cac.plan.target * 100)}%` : null },
    { k: 'wema', label: 'Send records to Wema', icon: FileSpreadsheet, tone: 'ink', go: () => go('invoices', { seg: 'wema' }), hidden: !owner },
].filter(a => !a.hidden);

  return (
    <div className="page with-nav">
      <header className="top round tall">
        <div className="top-row">
          <div className="grow">
            <div className="sub" style={{ marginTop: 0 }}>{greeting()}</div>
            <h1>{name}</h1>
            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
              <span className="chip-status"><span className={'dot' + (online ? '' : ' off')} />{online ? 'Online' : 'Offline, saving on this phone'}</span>
              <button className="chip-status" onClick={() => go('records')} style={integ.ok ? undefined : { background: 'rgba(224,68,62,.25)', color: '#ffd2cf' }}>
                {integ.ok ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{integ.ok ? 'Records secured' : 'Records need attention'}
              </button>
            </div>
          </div>
          <button className="avatar" onClick={() => openAccountMenu()} aria-label="Open account menu">{avatarInitial}</button>
        </div>
      </header>

      <div className="wrap over">
        <StockAlerts />
        <button className="card" style={{ width: '100%', textAlign: 'left' }} onClick={() => go('insights')}>
          <div className="row between">
            <span className="muted" style={{ fontWeight: 700, fontSize: 14 }}>Sales today</span>
            <span className="pill leaf">{naira(today.profit)} profit</span>
          </div>
          <div className="money" style={{ marginTop: 6 }}>{naira(today.revenue)}</div>
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="small">{today.count} {today.count === 1 ? 'sale' : 'sales'}{staff && s.staff.length > 1 ? `, selling as ${staff.name}` : ''}</span>
            <span className="link" style={{ padding: 0 }}>See trends</span>
          </div>
        </button>

        <button className="banner ink" style={{ marginTop: 12, minHeight: 72 }} onClick={() => go('talk', { autoListen: true })}>
          <span className="mic-big" style={{ width: 52, height: 52, boxShadow: 'none' }}><Mic size={24} /></span>
          <span className="grow">
            <b style={{ fontSize: 16 }}>Just talk</b>
            <div style={{ color: '#b9c8f5', fontSize: 13.5, marginTop: 2 }}>"I sold 2 bags of rice to Emeka"</div>
          </span>
          <ChevronRight size={20} />
        </button>

        <div className="h2">What do you want to do?</div>
        <div className="actions">
          {actions.map(a => (
            <button key={a.k} className="action" onClick={a.go}>
              {a.badge && <span className="badge">{a.badge}</span>}
              <span className={'ic ' + a.tone}><a.icon size={22} /></span>
              {a.label}
            </button>
          ))}
        </div>

        {owner && !p.location && (
          <button className="banner royal" style={{ marginTop: 14 }} onClick={() => go('permissions')}>
            <MapPin size={22} />
            <span className="grow"><b>Pin your shop location</b><br />One tap. Buyers on the Vendors Hub find you, and Wema sees where you trade.</span>
            <ChevronRight size={18} />
          </button>
        )}

        {unmatched.length > 0 && (
          <button className="banner leaf" style={{ marginTop: 14 }} onClick={() => go('wallet', { seg: 'payments' })}>
            <Landmark size={22} />
            <span className="grow"><b>{naira(unmatched[0].amount)} from {unmatched[0].senderName}</b><br />Tell Vendora what it was for</span>
            <ChevronRight size={18} />
          </button>
        )}

        {arriving.length > 0 && (
          <button className="banner royal" style={{ marginTop: 12 }} onClick={() => go('hub')}>
            <Truck size={22} />
            <span className="grow"><b>Order from {arriving[0].sellerName} is on the way</b><br />Confirm when it arrives to update stock</span>
            <ChevronRight size={18} />
          </button>
        )}

        {focus && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="ic pepper" style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center' }}><Store size={22} /></span>
              <div className="grow">
                <b>{focus.name} {focus.qty <= 0 ? 'is finished' : forecast ? `finishes in about ${Math.max(1, Math.round(forecast.daysLeft))} day${Math.round(forecast.daysLeft) <= 1 ? '' : 's'}` : 'is running low'}</b>
                <div className="small" style={{ marginTop: 3 }}>{offers.length ? `${offers.length} verified seller${offers.length === 1 ? '' : 's'} near you from ${naira(offers[0].item.price)} per ${offers[0].item.unit}` : `You have ${qtyUnit(focus.qty, focus.unit)} left`}</div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn soft sm grow" onClick={() => go('hub', { focus: focus.id })}>Find sellers</button>
              {owner && <button className="btn kola sm grow" onClick={() => go('loan', { productId: focus.id })}>Restock with Wema loan</button>}
            </div>
          </div>
        )}

        {owner && (
          <button className="card row" style={{ width: '100%', marginTop: 12, textAlign: 'left' }} onClick={() => go('score')}>
            <span className="ring" style={{ width: 58, height: 58, margin: 0, background: `conic-gradient(var(--royal) ${score.score * 3.6}deg, #e9edf5 0)` }}>
              <span className="in" style={{ width: 46, height: 46, fontWeight: 800 }}>{score.score}</span>
            </span>
            <span className="grow">
              <b>Business Score: {score.band}</b>
              <div className="small" style={{ marginTop: 2 }}>Wema uses it to decide your loan</div>
            </span>
            <ChevronRight size={18} className="muted" />
          </button>
        )}

        {advice.length > 0 && <>
          <div className="h2">Advice for you <button className="more" onClick={() => go('insights')}>More</button></div>
          <div className="gap cards">
            {advice.map((c, i) => (
              <div key={i} className="card row" style={{ alignItems: 'flex-start' }}>
                <span className="ic kola" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none' }}><Lightbulb size={20} /></span>
                <div className="grow"><b>{c.title}</b><div className="muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>{c.body}</div></div>
              </div>
            ))}
          </div>
        </>}

        {live.length > 0 && <>
          <div className="h2">Recent <button className="more" onClick={() => go('wallet', { seg: 'payments' })}>See all</button></div>
          <div className="list">{s.txns.slice(0, 4).map(t => <TxnRow key={t.id} t={t} />)}</div>
        </>}
        <div className="small center" style={{ marginTop: 18 }}>{p.businessName}{s.sync.lastSyncAt ? `, synced ${timeAgo(s.sync.lastSyncAt)}` : ''}</div>
      </div>
    </div>
  );
}
