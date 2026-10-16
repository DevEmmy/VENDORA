# Frontend authentication

The frontend uses Zustand for identity and business selection. Shop records use
the existing offline store and account-scoped localStorage. The auth form uses
React state and manual validation; the backend validates requests with Zod.
A shared TanStack Query client is available and is cleared on account changes.
Signup, login, and logout use the
backend's cookie-based authentication; no password or token is saved in browser storage.

## Run locally

Start the backend with `npm run dev` in `server`, then `npm run dev` in `web`.
Vite proxies `/api`, `/wema`, and `/whatsapp` to `http://localhost:8080`.
Set backend `CORS_ORIGINS` to the exact frontend origin (normally
`http://localhost:5173`) and use `COOKIE_SECURE=false` locally. The browser sends
its original Origin through the proxy. Copy `web/.env.example` if needed;
leave `VITE_SERVER_URL` empty for the proxy or same-origin production deployment.
Production requires the existing backend's same-origin HTTPS cookie topology.

## Modules

- `web/src/lib/api/client.js`: credentialed HTTP, typed errors, abort support,
  business headers, one retry after session refresh, and refresh coordination.
- `web/src/features/auth/`: endpoint adapter, shared auth store and session restoration.
- `web/src/App.jsx`: auth form, expiry prompt, business activation and navigation.
- `web/src/lib/queryClient.js` and `privacy.js`: shared query client and response-cache purge.
- `web/src/lib/store.js`: existing domain actions and subscriptions; shop data
  is stored under an account-specific key.

`useAuthStore` exposes status, user, memberships, and selected business ID.
`selectBusiness` accepts only server-returned memberships. New server requests
should use `api.request(path, { method, body, signal, businessId })` for
business endpoints. The selected business is used if businessId is omitted,
and is captured before refresh so a pending operation cannot change businesses.
Public credential requests use `auth: false` so invalid
passwords never trigger refresh. Queries should include the user/business ID in
their keys. Do not trust local staff roles as server authorization.

On signup, registration is followed by login. `/me` supplies authoritative
identity and memberships. Protected screens wait for session restoration. Login
and logout clear private query/response caches. All private API adapters,
including inventory, sales, banking and server speech, use lib/api/client.js;
the duplicate lib/api.js was removed. External speech-provider requests remain
separate from Vendora authentication.

Refresh uses a single in-flight promise and navigator.locks.request('vendora-refresh')
across tabs. After acquiring the lock, /api/auth/me checks whether a peer already
refreshed. A request retries at most once after refresh. Browsers without Web
Locks use a short localStorage lease and BroadcastChannel/polling; this fallback
is advisory, with the server's default ten-second immediate-previous-token grace
handling residual races. No credentials are stored in the lease or messages.
Only a final authentication failure marks the session expired. The UI prompts
for re-login and retains local account records and business selection. Network
failures do not count as expiration.

The sample shop stays available offline and uses mock banking. Real accounts use
the backend. Existing unscoped shop data remains on the device and is never
automatically assigned to a new account. Logout switches away from private shop
data but retains the account's local records for its next login. Device owners
can still inspect local storage: the existing offline shop storage is unencrypted.
The service worker excludes private backend paths, caches only public shell and
hashed assets fetched without credentials, and removes all previous cache names.
Logout/business changes also purge response caches without clearing local records.

Signup now requires `name` and `businessName` along with phone/password, and accepts
optional `businessType` and `city` from the shop form. It provisions the shop and
owner membership atomically, as described in `backend-auth.md`. Frontend registration
calls must include these fields; login still sends only phone/password.
Banking restrictions enforced by the backend
remain in effect. Recovery/password-management screens are outside this integration.

Run `npm test` and `npm run build` in `web`. Tests cover refresh coordination,
fallback, retry limits, network/auth errors, business binding, expiration and
private-cache isolation. In server run npm run test:browser for real Chromium
cookie/worker/two-tab checks and npm run test:integration:isolated for PostgreSQL
auth tests, including grace/replay/logout-all. Before deployment,
check signup/login/logout, reload restoration, two-tab expiration, and real
HTTPS cookies against the configured backend.
