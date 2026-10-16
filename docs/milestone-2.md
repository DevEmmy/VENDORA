# Milestone 2: one refresh pipeline across tabs

Date: 2026-10-17, Africa/Lagos.

## Red, then green

Before the fix, the frontend unit reproduction counted two refresh requests
instead of one. The PostgreSQL grace test allowed only one of three concurrent
requests, revoking the family. The original M0 browser race also revoked the
session. These were recorded before changing either implementation.

After implementation:

```text
web npm test: 19 passed, 0 failed
server npm test: 35 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
web npm run build: exit 0 (existing Vite chunk-size advisory)
test:integration:isolated: 12 passed, 0 failed, 1 optional Redis test skipped
M2 grace {"successful":3}
test:browser: 2 passed (30.4s)
M0(a) {"identityWasA":false,"inventoryWasA":false}
M0(b) {"requestStatuses":[200,200],"sessionRevoked":false,"directMe":200}
```

The browser race additionally asserts exactly one refresh HTTP request. The
frontend suite checks single-flight, Web Locks peer rechecking, fallback leases,
retry limits, network/public-login errors, preserved business binding and
retained identity/selection on expiry. PostgreSQL checks identical successors
inside grace, late/ancestor revocation and logout-all. Existing strict-replay
integration assertions still run unchanged with grace explicitly set to zero.
The default grace behavior is independently tested, not bypassed.

## Decisions and limits

lib/api/client.js is the sole private HTTP client. The duplicate lib/api.js is
deleted; inventory, sales, auth, banking and server speech use the shared module.
External speech-provider/OCR asset fetching is not a Vendora cookie-auth flow.
Credentials remain HttpOnly. No JavaScript refresh/access token storage is added.

Web Locks serialize refresh and /me rechecks the current cookies after lock
acquisition. Fallback localStorage leases and BroadcastChannel/polling are
advisory, not an atomic cross-tab mutex. The bounded backend grace tolerates
their residual race. Original requests retry at most once; the business ID is
captured before waiting and never changes on a retry.

AUTH_REFRESH_REUSE_GRACE_MS defaults to 10000, accepts 0 to disable, and is capped
at 30000. Only an unconsumed direct successor of the presented credential can
qualify. Grace does not bypass idle/absolute expiry, user status, authVersion or
revocation. Later reuse or older ancestors revoke the family.

The documented trade-off is brief usability of a stolen immediately previous
credential. A domain-separated HMAC derives the same successor on each replica
using the existing DELIVERY_ENCRYPTION_KEY. Only digests are persisted. No schema
migration is needed. Replicas must share that secret, as delivery already
requires; changing it can reject in-flight retries from its former key.

Expiry shows a re-login prompt while retaining account data and business
selection. Network failures do not mark the session expired. The durable
operation outbox is still an M7 deliverable, not claimed here. The M0 stock
reproduction remains pending for M5. TEST_REDIS_URL remains unset.

Changed files: README.md; docs/backend-auth.md; docs/frontend-auth.md;
docs/milestone-2.md; server/.env.example; server/src/app.ts;
server/src/config/env.ts; server/src/services/session.service.ts;
server/src/services/token.service.ts; server/test/browser/auth-privacy.spec.ts;
server/test/integration/database.test.ts;
server/test/integration/refresh-grace.test.ts; server/test/support/http.ts;
web/src/App.jsx; web/src/features/auth/authSession.js;
web/src/features/auth/authStore.js; web/src/features/inventory/inventorySync.js;
web/src/features/sales/salesSync.js; web/src/lib/api.js (removed);
web/src/lib/api/client.js; web/src/lib/voice.js; web/src/lib/wema.js;
web/test/api-client.test.js; web/test/session-expiry.test.js.
