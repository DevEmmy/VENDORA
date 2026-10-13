# Frontend authentication

The frontend uses Zustand for shared identity and shop state, TanStack Query for
server state and auth mutations, and React Hook Form with Zod for form validation.
Existing screen layouts and CSS are retained. Signup, login, and logout use the
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
- `web/src/features/auth/`: endpoint adapters, schemas, shared auth store,
  query/mutation hooks, and the auth form.
- `web/src/app/`: query client, provider, session restoration, and tab events.
- `web/src/lib/store.js`: existing domain actions backed by a Zustand vanilla
  store; shop data is stored under an account-specific key.

`useAuthStore` exposes status, user, memberships, and selected business ID.
`selectBusiness` accepts only server-returned memberships. New server requests
should use `api.request(path, { method, body, signal, business: true })` for
business endpoints. Public credential requests use `auth: false` so invalid
passwords never trigger refresh. Queries should include the user/business ID in
their keys. Do not trust local staff roles as server authorization.

On signup, registration is followed by login. `/me` supplies authoritative
identity and memberships. Protected screens wait for session restoration. Login
and logout clear private query caches; tab events recheck the cookie identity.
Refresh uses a single in-flight promise plus Web Locks across tabs, with an
identity recheck before rotating cookies. Browsers without Web Locks only have
per-tab coordination; target modern browsers with Web Locks for multi-tab use.

The sample shop stays available offline and uses mock banking. Real accounts use
the backend. Existing unscoped shop data remains on the device and is never
automatically assigned to a new account. Logout switches away from private shop
data but retains the account's local records for its next login. Device owners
can still inspect local storage: the existing offline shop storage is unencrypted.
The service worker excludes private backend paths and removes its previous cache.

Signup does not provision a business membership. New users can complete local
shop onboarding, but backend shop sync waits for an operator-provisioned membership,
as described in `backend-auth.md`. Banking restrictions enforced by the backend
remain in effect. Recovery/password-management screens are outside this integration.

Run `npm test` and `npm run build` in `web`. Auth tests cover validation, cookie
requests, refresh races, expiration, errors, and cancellation. Before deployment,
check signup/login/logout, reload restoration, two-tab expiration, and real
HTTPS cookies against the configured backend.
