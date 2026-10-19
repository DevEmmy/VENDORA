import React, { useState } from 'react';
import { useStore } from '../../components/ui.jsx';
import { getActiveSync } from './accountSync.js';

export default function SyncStatus() {
  const state = useStore(store => store.localSync);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState({});
  if (!state || !getActiveSync()) return null;
  const label = state.phase === 'synced' ? 'Synced' : state.phase === 'offline' ? `Offline · ${state.pending || 0} pending` :
    state.phase === 'expired' ? 'Sign in to sync · records saved' : state.phase === 'needs-attention' ? 'Sync needs attention' :
      state.phase === 'syncing' ? `Syncing · ${state.pending || 0} pending` : `Pending ${state.pending || 0}`;
  const action = async callback => { setError(''); try { await callback(); } catch (failure) { setError(failure.message); } };
  const actionName = action => ({ 'sale.create': 'Sale', 'sale.reverse': 'Sale cancellation', 'sale.payment': 'Debt payment',
    'stock.restock': 'Restock', 'stock.count': 'Stock count', 'product.create': 'New item', 'product.update': 'Item edit', 'product.delete': 'Item removal' }[action] || 'Business record');
  return <section aria-label="Sync status" style={{ padding: '10px 18px', background: '#f3f5fa', borderBottom: '1px solid #dce2ee' }}>
    <button type="button" className="link" onClick={() => setOpen(value => !value)} aria-expanded={open}>{label}</button>
    {(open || state.phase === 'needs-attention') && <div>
      {state.lastError && <p role="alert">{state.lastError.message}</p>}
      {error && <p role="alert">{error}</p>}
      <p className="small">Pending records are saved on this device and stay here if your session ends.</p>
      <button className="btn soft sm" onClick={() => action(() => getActiveSync().sync())}>Sync now</button>
      {state.migrationWarning && <div role="status"><p>{state.migrationWarning}</p>
        <button className="link" onClick={() => action(() => getActiveSync().acknowledgeMigrationWarning())}>I have reviewed the imported records</button></div>}
      {state.rejected?.length > 0 && <div aria-label="Rejected operations">
        {state.rejected.map(operation => <article className="card" key={operation.id} style={{ marginTop: 8 }}>
          <b>{actionName(operation.action)}</b>
          {operation.payload.items && <p>{operation.payload.items.map(item => `${item.qty} ${item.name || 'item'}`).join(', ')}</p>}
          <p>{operation.error?.message || 'This operation was not applied.'}</p>
          {operation.error?.details?.availableQuantity !== undefined && <p>Available quantity: {operation.error.details.availableQuantity}</p>}
          {operation.action === 'sale.create' && operation.error?.code === 'INSUFFICIENT_STOCK' && <>
            <label><input type="checkbox" checked={Boolean(confirmed[operation.id])}
              onChange={event => setConfirmed(value => ({ ...value, [operation.id]: event.target.checked }))} /> The customer already received these goods.</label>
            <button className="btn sm" disabled={!confirmed[operation.id]}
              onClick={() => action(() => getActiveSync().retryPhysicalSale(operation.id))}>Record completed physical sale</button>
          </>}
          <button className="link" onClick={() => action(() => getActiveSync().discardRejected(operation.id))}>Discard rejected upload · keep its local record</button>
        </article>)}
      </div>}
    </div>}
  </section>;
}
