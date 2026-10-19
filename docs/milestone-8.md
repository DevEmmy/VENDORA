# Milestone 8: account hardening

Date: 2026-10-17, Africa/Lagos.

Before fixes, focused tests observed a plaintext '2345' in staff state, accepted
cookie mutations without Origin/Fetch Metadata and accepted seven-character
new passwords. All three reproductions pass after fixes. A topology regression
also failed because incompatible origins produced no diagnostic, then passed.

Actual verification:

```text
server npm test: 47 passed, 0 failed
web npm test: 29 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
test:browser: 9 passed (1.7m), including actual cookie smoke and password UI
test:integration:isolated: 54 passed, 0 failed, 1 optional Redis test skipped
integration duration: 338178.8717ms; isolated PostgreSQL stopped cleanly
git diff --check: exit 0
```

Details and deployment assumptions are in auth-deployment.md. PINs are local
PBKDF2 hashes and clearly labelled as convenience locks. API attribution remains
the real account; all newly captured operations carry a recordedBy label. Staff
backend enrollment and email verification are deferred as allowed in the task.
The existing rate limits already covered login/signup/refresh/reset; new tests
prove exhausted limits fail before credential work. Password recovery requires
an independently verified destination; the UI explains that enrollment is not
available. Password change clears server sessions while preserving browser data.

The former six-character signup fixture is updated to a permitted passphrase
because the requested policy intentionally changes new credentials. Separate
tests keep old short-password login/verification working. Existing cookie test
clients now send trusted Origin on mutations; missing-origin denial has its own
regressions. No production credentials or deployment were used.

The optional Redis test remains skipped because TEST_REDIS_URL is unset.
The production frontend build reports the existing chunk-size advisory.
Local cookie smoke verifies browser transport; live HTTPS/proxy validation and
real delivery remain deployment checks rather than claims from this run.

Exact changed files:

- docs/auth-deployment.md
- docs/milestone-8.md
- server/.env.example
- server/package.json
- server/scripts/cookie-smoke.ts
- server/src/app.ts
- server/src/config/env.ts
- server/src/index.ts
- server/src/middleware/auth.ts
- server/src/schemas/auth.schemas.ts
- server/src/services/password-policy.ts
- server/src/services/password.service.ts
- server/test/auth-hardening.test.ts
- server/test/auth-rate-limits.test.ts
- server/test/auth.test.ts
- server/test/browser/auth-hardening.spec.ts
- server/test/integration/auth-hardening.test.ts
- server/test/integration/database.test.ts
- server/test/session.test.ts
- web/src/App.jsx
- web/src/components/PinPad.jsx
- web/src/features/auth/authApi.js
- web/src/features/sync/domain.js
- web/src/lib/staffPins.js
- web/src/lib/store.js
- web/src/screens/Password.jsx
- web/src/screens/Profile.jsx
- web/src/screens/Staff.jsx
- web/test/staff-pins.test.js
