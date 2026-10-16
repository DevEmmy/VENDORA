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

async function send(path, options = {}) {
  const {
    method = 'GET',
    body,
    signal,
    businessId,
  } = options;

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
    response = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers,
      signal,
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    throw new ApiError(
      'Unable to connect to Vendora. Check your internet connection.'
    );
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);

    const message =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : `Request failed (${response.status}).`;

    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return null;
  }

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

export const api = {
  async request(path, options = {}) {
    const {
      auth = true,
      ...requestOptions
    } = options;

    try {
      return await send(path, requestOptions);
    } catch (error) {
     if (
    !auth ||
    error.status !== 401 ||
    (path.startsWith('/api/auth/') && path !== '/api/auth/me')
	) {
    throw error;
	}

      await refreshSession();

      return send(path, requestOptions);
    }
  },

  refresh: refreshSession,
};