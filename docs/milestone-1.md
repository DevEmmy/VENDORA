# Milestone 1: service worker privacy

Date: 2026-10-17, Africa/Lagos. Baseline commit: 90ca1f1.

## Red, then green

Before the implementation, the worker suite reported 1 passed / 8 failed.
Failures confirmed API caching, ignoring no-store/private/Set-Cookie/Vary:Cookie,
credentialed asset fetching, retaining legacy caches and no purge-message handler.
The backend cache-header suite reported 4 failed (three endpoint assertions plus
their parent): all responses already used no-store but lacked Vary: Cookie.
M0's browser test had separately proved the actual cross-account leak.

After the fix:

```text
web npm test: 12 passed, 0 failed
server npm test: 35 passed, 0 failed
tsc -p tsconfig.tests.json: exit 0, no diagnostics
web npm run build: exit 0 (Vite's existing >500kB chunk advisory remains)
test:integration:isolated: reset/redeploy passed; 7 passed, 0 failed, 1 skipped
test:browser -- --grep "changing accounts": 1 passed (53.0s)
M0(a) {"identityWasA":false,"inventoryWasA":false}
```

The skipped integration is the existing Redis check: TEST_REDIS_URL is unset.
The refresh/stock reproductions remain pending for M2/M5; they are not represented
as fixed or masked with expected-failure markers.

## Behavior and assumptions

The worker caches only the explicitly public app shell and hashed build assets.
It fetches these without credentials and rejects unsafe response cache headers,
redirects, opaque responses and responses varying on Cookie/Authorization.
API/Wema/WhatsApp paths, mutations, arbitrary files and requests carrying explicit
authorization/cookie headers bypass it. Navigation to the app shell is network
first. All old cache names are removed before clients are claimed on upgrade.

Set-Cookie is not exposed to JavaScript on all browser responses. The primary
browser protection is the public-file allowlist plus credentials:omit, not an
assumption that this response header is always readable.

Logout and user/business changes clear the shared QueryClient, post CLEAR_CACHES
to the worker and purge CacheStorage. They do not delete account-scoped local
records or future offline operations. Tests verify this separation.

The Express private-path middleware now emits no-store and Vary: Cookie before
authentication and rate limiting, preserving headers on failures too.

Changed files: server/src/app.ts; server/test/private-cache.test.ts;
web/public/sw.js; web/src/App.jsx; web/src/main.jsx;
web/src/lib/queryClient.js; web/src/lib/privacy.js;
web/test/privacy.test.js; web/test/service-worker.test.js; docs/milestone-1.md.

Deployment: ship the updated sw.js without a long-lived HTTP cache lifetime.
Activation purges legacy cached responses on returning devices. No database
migration is required for this milestone.
