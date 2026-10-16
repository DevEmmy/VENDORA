
import { api } from '../../lib/api/client.js';

export const authApi = {
  register: (details) =>
    api.request('/api/auth/register', {
      method: 'POST',
      body: details,
      auth: false,
    }),

  login: (phone, password) =>
    api.request('/api/auth/login', {
      method: 'POST',
      body: { phone, password },
      auth: false,
    }),

  me: () =>
    api.request('/api/auth/me'),

  logout: () =>
    api.request('/api/auth/logout', {
      method: 'POST',
      body: {},
      auth: false,
    }),

  refresh: () => api.refresh(),
};
