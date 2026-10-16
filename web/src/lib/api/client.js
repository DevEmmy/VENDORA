import { SERVER_URL } from '../config.js';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const baseUrl = SERVER_URL.replace(/\/$/, '');
let refreshPromise = null;
let businessContext = () => undefined;
const expirationListeners = new Set();
let channel;

export function setBusinessContextResolver(resolver) { businessContext = resolver; }
export function onSessionExpired(listener) {
  expirationListeners.add(listener);
  return () => expirationListeners.delete(listener);
}

function expired(error) {
  if (error?.status === 401) for (const listener of expirationListeners) listener();
}

function refreshChannel() {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vendora-auth') : null;
    channel?.unref?.();
  } catch { channel = null; }
  return channel;
}

function waitForPeer(ms) {
  return new Promise(resolve => {
    const peer = refreshChannel();
    const done = () => { clearTimeout(timer); peer?.removeEventListener('message', done); resolve(); };
    const timer = setTimeout(done, ms);
    peer?.addEventListener('message', done, { once: true });
  });
}

async function fallbackLock(callback) {
  // localStorage is not an atomic mutex. This advisory lease + broadcast/poll
  // avoids most duplicate work; backend grace covers the remaining race and
  // browsers where both Web Locks and storage are unavailable.
  let storage;
  try { storage = globalThis.localStorage; } catch { return callback(); }
  if (!storage) return callback();
  const key = 'vendora:refresh-lease:v1';
  const owner = globalThis.crypto?.randomUUID?.() || String(Math.random());
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const lease = JSON.parse(storage.getItem(key) || 'null');
      if (!lease || lease.expiresAt <= Date.now()) {
        storage.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + 15_000 }));
        await waitForPeer(0);
        if (JSON.parse(storage.getItem(key) || 'null')?.owner === owner) {
          try { return await callback(); }
          finally {
            try {
              if (JSON.parse(storage.getItem(key) || 'null')?.owner === owner) storage.removeItem(key);
            } catch { /* Storage can become unavailable during a request. */ }
            refreshChannel()?.postMessage({ type: 'refresh-complete' });
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiError || error?.name === 'AbortError') throw error;
      return callback();
    }
    await waitForPeer(80);
  }
  throw new ApiError('Another tab is reconnecting. Please try again.');
}

function coordinateRefresh(callback) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request('vendora-refresh', callback);
  return fallbackLock(callback);
}

async function send(path, { method = 'GET', body, signal, businessId, baseUrl: targetBase = baseUrl } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (businessId) headers['X-Business-ID'] = businessId;
  let response;
  try {
    response = await fetch(`${targetBase.replace(/\/$/, '')}${path}`, {
      method, credentials: 'include', headers, signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    throw new ApiError('Unable to connect to Vendora. Check your internet connection.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = typeof data?.message === 'string' ? data.message :
      typeof data?.error === 'string' ? data.error : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? null : response.json();
}

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = coordinateRefresh(async () => {
      // A peer may have refreshed while this tab waited. Recheck the real cookie
      // identity, never a cached timestamp or a JavaScript credential.
      const timeout = () => globalThis.AbortSignal?.timeout?.(10_000);
      try { await send('/api/auth/me', { signal: timeout() }); return null; }
      catch (error) { if (error.status !== 401) throw error; }
      return send('/api/auth/refresh', { method: 'POST', body: {}, signal: timeout() });
    }).catch(error => { expired(error); throw error; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export const api = {
  async request(path, options = {}) {
    const { auth = true, ...requestOptions } = options;
    // Capture business context before awaiting anything. An account switch must
    // never send a pending operation to the newly selected business on retry.
    if (!path.startsWith('/api/auth/') && requestOptions.businessId === undefined)
      requestOptions.businessId = businessContext();
    try { return await send(path, requestOptions); }
    catch (error) {
      if (!auth || error.status !== 401 ||
          (path.startsWith('/api/auth/') && path !== '/api/auth/me')) throw error;
      await refreshSession();
      try { return await send(path, requestOptions); }
      catch (retryError) { expired(retryError); throw retryError; }
    }
  },
  refresh: refreshSession,
};

export const apiRequest = (path, options) => api.request(path, options);
