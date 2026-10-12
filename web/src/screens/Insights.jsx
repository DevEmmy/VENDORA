import React, { useMemo, useState } from 'react';
import { Lightbulb, TrendingUp, TrendingDown, MessageCircle } from 'lucide-react';
import { useStore, Top, Seg } from '../components/ui.jsx';
import { useNav } from '../App.jsx';
import { totals, weekly, qtySold, adviceCards, periodRange } from '../lib/insights.js';
import { naira, nairaShort, qtyUnit } from '../lib/format.js';

export default function Insights() {
  const s = useStore();
  const { back, go } = useNav();
  const [period, setPeriod] = useState('week');
  const live = useMemo(() => s.txns.filter(t => !t.reversed), [s.txns]);
  const t = totals(live, period);
  const w = weekly(live);
  const max = Math.max(1, ...w.days.map(d => d.total));
  const [from, to] = periodRange(period);
  const top = Object.values(qtySold(live, from, to)).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topMax = Math.max(1, ...top.map(x => x.revenue));
  const advice = adviceCards({ ...s, txns: live });
  const up = w.change >= 0;

  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="How your shop is doing" onBack={back}>
        <div style={{ marginTop: 14 }}><Seg value={period} onChange={setPeriod} options={[['today', 'Today'], ['week', 'This week'], ['month', 'This month']]} label="Period" /></div>
      </Top>
      <div className="wrap" style={{ marginTop: 16 }}>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="card grow"><div className="small" style={{ fontWeight: 700 }}>Sales</div><div className="money md">{naira(t.revenue)}</div><div className="small">{t.count} sales</div></div>
          <div className="card grow"><div className="small" style={{ fontWeight: 700 }}>Profit</div><div className="money md leaf">{naira(t.profit)}</div><div className="small">{t.revenue ? Math.round(t.profit / t.revenue * 100) : 0}% margin</div></div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="row between">
            <b>Last 7 days</b>
            {w.lastWeek > 0 && <span className={'pill ' + (up ? 'leaf' : 'pepper')}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(Math.round(w.change * 100))}% vs last week</span>}
          </div>
          <div className="bars" role="img" aria-label="Sales for each of the last 7 days">
            {w.days.map(d => (
              <div key={d.from} className={'bar' + (d.isToday ? ' today' : '')}>
                <span className="small" style={{ fontSize: 10.5, fontWeight: 700 }}>{d.total ? nairaShort(d.total) : ''}</span>
                <div className="b" style={{ height: `${Math.max(4, d.total / max * 100)}%` }} />
                <span className="l">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h2">Best sellers</div>
        {top.length ? <div className="card gap">{top.map(x => (
          <div key={x.productId}>
            <div className="row between" style={{ fontSize: 14.5 }}><span style={{ fontWeight: 600 }} className="clip">{x.name}</span><b>{naira(x.revenue)}</b></div>
            <div className="row" style={{ marginTop: 6 }}><div className="meter grow"><div style={{ width: `${x.revenue / topMax * 100}%` }} /></div><span className="small" style={{ minWidth: 70, textAlign: 'right' }}>{qtyUnit(x.qty, x.unit)}</span></div>
          </div>
        ))}</div> : <div className="card muted">No sales in this period yet.</div>}

        {advice.length > 0 && <>
          <div className="h2">Advice</div>
          <div className="gap">{advice.map((c, i) => (
            <div key={i} className="card">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <span className="ic kola" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none' }}><Lightbulb size={20} /></span>
                <div className="grow"><b>{c.title}</b><div className="muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>{c.body}</div></div>
              </div>
              {c.action && <button className="btn kola sm full" style={{ marginTop: 12 }} onClick={() => go('loan', { productId: c.action.productId })}>{c.action.label}</button>}
              {!c.action && c.ask && <button className="btn soft sm full" style={{ marginTop: 12 }} onClick={() => go('talk')}><MessageCircle size={16} />Ask Vendora</button>}
            </div>
          ))}</div>
        </>}
      </div>
    </div>
  );
}
