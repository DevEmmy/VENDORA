
import { SERVER_URL } from './config.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let refreshPromise = null;

async function send(path, { method = 'GET', body, businessId } = {}) {
  // Use relative URLs when SERVER_URL is not configured.

  const headers = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (businessId) {
    headers['X-Business-ID'] = businessId;
  }

  let response;

  try {
    response = await fetch(`${SERVER_URL || ""}${path}`, {
      method,
      credentials: 'include',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('Cannot reach the Vendora server.', 0);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      data?.message || data?.error || `Request failed (${response.status}).`,
      response.status
    );
  }

  if (response.status === 204) return null;

  return response.json();
}

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = send('/api/auth/refresh', {
      method: 'POST',
      body: {},
    }).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  try {
    return await send(path, options);
  } catch (error) {
    const isAuthEndpoint = path.startsWith('/api/auth/');

    if (error.status !== 401 || isAuthEndpoint) {
      throw error;
    }

    await refreshSession();

    return send(path, options);
  }
}

export const authApi = {
  register: (data) =>
    apiRequest('/api/auth/register', {
      method: 'POST',
      body: data,
    }),

  login: (phone, password) =>
    apiRequest('/api/auth/login', {
      method: 'POST',
      body: { phone, password },
    }),

  me: () => apiRequest('/api/auth/me'),

  refresh: () => refreshSession(),

  logout: () =>
    apiRequest('/api/auth/logout', {
      method: 'POST',
      body: {},
    }),
};
