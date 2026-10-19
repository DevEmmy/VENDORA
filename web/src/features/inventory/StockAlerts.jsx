import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../auth/authStore.js';
import { apiRequest } from '../../lib/api/client.js';

export default function StockAlerts() {
  const status = useAuthStore(state => state.status);
  const businessId = useAuthStore(state => state.selectedBusinessId);
  const userId = useAuthStore(state => state.user?.id);
  const scope = `${userId}:${businessId}`;
  const [view, setView] = useState({ scope: null, notifications: [], error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (status !== 'authenticated' || !businessId) return;
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running || navigator.onLine === false) return;
      running = true;
      try {
        const result = await apiRequest('/api/notifications?unread=true', { businessId, signal: controller.signal });
        if (active) setView({ scope, notifications: result.notifications, error: '' });
      } catch (error) {
        // Snapshot shops have no relational alerts until their M6 cutover.
        if (active) setView(previous => ({ scope, notifications: previous.scope === scope ? previous.notifications : [],
          error: error.code === 'INVENTORY_MIGRATION_REQUIRED' ? '' : error.message }));
      } finally { running = false; }
    };
    void load();
    const timer = setInterval(load, 15_000);
    window.addEventListener('online', load);
    window.addEventListener('focus', load);
    return () => { active = false; controller.abort(); clearInterval(timer);
      window.removeEventListener('online', load); window.removeEventListener('focus', load); };
  }, [status, businessId, scope, retry]);
  if (status !== 'authenticated' || view.scope !== scope) return null;
  if (!view.notifications.length && !view.error) return null;
  return <section className="card" aria-label="Stock alerts" style={{ marginBottom: 12 }}>
    <b>Stock alerts</b>
    {view.error && <p role="status">Stock alerts could not refresh: {view.error}
      {' '}<button className="link" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
    {view.notifications.map(alert => <p key={alert.id} role={alert.type === 'OVERSOLD' ? 'alert' : 'status'}>
      {alert.message}
    </p>)}
    {view.notifications.some(alert => alert.type === 'OVERSOLD') &&
      <p className="small">Check the physical stock, then record a stock count to reconcile it.</p>}
  </section>;
}
