# Vendora

Vendora is a React web app with a TypeScript/Express API, Prisma/PostgreSQL,
Redis rate limiting and local browser storage. `app/` contains the paused
Flutter prototype. This repository includes both authenticated inventory/sales
and sample banking/marketplace flows; the latter are not a live bank integration.

## Run locally

Use Node 22.12+ in the 22.x line or Node 24.x, PostgreSQL and Redis.

```text
cd server
npm ci
```

Copy `server/.env.example` to `.env`, configure database connections, Redis,
RSA signing keys and the delivery encryption key. For development use
`COOKIE_SECURE=false`, `CORS_ORIGINS=http://localhost:5173` and
`PUBLIC_API_ORIGIN=http://localhost:5173`. Apply migrations with a migration
credential using `npm run db:deploy`, then `npm run dev`.

In another terminal:

```text
cd web
npm ci
npm run dev
```

Vite proxies `/api`, `/wema` and `/whatsapp` to localhost:8080. Leave
`VITE_SERVER_URL` empty for this proxy. Authenticated accounts use the API even
when that variable is empty. The separately scoped sample shop uses mock banking.
A static frontend host alone does not supply a working account backend.

Production uses `npm run build` in each directory and `npm start` in `server`.
Serve `web/dist` over HTTPS with a same-site API/proxy. See
[deployment and cookie smoke checks](docs/auth-deployment.md) and
[backend configuration](docs/backend-auth.md). Never put backend secrets in
Vite variables. The single-file build is a demo artifact, not the production
service-worker/offline deployment verified by the tests.

## Authentication

Signup creates an active account, shop and owner membership atomically without
phone verification. Login uses HttpOnly access and rotating refresh cookies;
there are no bearer credentials in browser storage or API response JSON.
Business context uses `X-Business-ID` and server-checked memberships/permissions.

All private clients use one refresh pipeline with an in-tab promise, cross-tab
Web Locks, and an advisory lease/BroadcastChannel fallback. A request retries
once. The immediately previous refresh credential has a configurable 10-second
reuse grace; older/late reuse revokes its session family. Server sessions enforce
30-minute idle expiry and an absolute lifetime. Expiry prompts re-login and
retains pending browser operations.

Cookie mutations require JSON and a trusted Origin or same-site Fetch Metadata.
New passwords require 8–128 characters and reject a common-password denylist;
legacy short passwords still log in. Profile has password change, which revokes
all sessions. Recovery requires an independently verified destination; enrollment
and a hosted reset-token form are follow-up work. Staff PINs are PBKDF2 device
convenience locks, not server identities or permission boundaries.

## Inventory and sales

One relational inventory model supports Decimal(12,3) quantities and integer
kobo money. Product CRUD, restocks, observed-count corrections, sales, repayments
and reversals are scoped by business. Transactions lock stock, post append-only
movements, assign monotonic cursors and retain idempotency receipts. Replaying
an operation UUID cannot apply it twice; different facts under that UUID conflict.

Online sales reject insufficient stock with 409 and the available quantity.
Queued physical sales accept negative stock and create an oversold alert for
reconciliation. Low-stock threshold crossings also create dashboard alerts.
Reversals restore stock once and preserve the original sale.

The frontend commits local actions and an ordered UUID outbox in IndexedDB,
scoped by user/business. Sync pushes batches with individual results, retries
uncertain responses with backoff, and pulls products, sales and movements by
cursor. Empty devices restore stock and sales history. Rejections appear in
Sync status; known stock failures require an explicit decision. Logout flushes
or asks for a confirmed discard. Local storage is not encrypted; browser/device
storage deletion can destroy unsent work.

Existing shops start in SNAPSHOT mode. A transactional, idempotent backfill maps
legacy IDs, converts naira/fractions, reports anomalies, verifies stock totals
and switches to RELATIONAL. The original snapshot becomes read-only; stale
array endpoints return 410. Dry-run first:

```text
cd server
npm run inventory:backfill -- --business <business-uuid> --dry-run
npm run inventory:backfill -- --business <business-uuid>
```

Review [backfill and cutover instructions](docs/inventory-backfill.md).
`INVENTORY_LAZY_BACKFILL=false` disables login-triggered migration by default;
the verified new app can separately request migration when sync encounters a
SNAPSHOT shop. Malformed legacy data blocks migration and needs operator review.
Legacy banking/balance history is retained and reported, not fully reconstructed.

## Privacy and limits

The service worker caches only public shell/hashed assets fetched without
credentials. It never caches `/api`, banking paths, mutations or private/no-store
responses. Activation deletes every old cache and claims clients; account
changes also purge response/query caches without clearing the business outbox.

The browser parser supports typed sales/restocks and browser voice input where
available. Banking accounts, loans, premium/CAC and sample marketplace claims
remain prototype/mock flows; production financial mutations are restricted.
Local receipt labels and device ledger signatures are not independent bank
verification. No real bank, email enrollment or native app release was verified.
WhatsApp is disabled by default; a RELATIONAL shop receives an instruction to
use the app rather than recording through the obsolete snapshot path.

## Verification

Run from the named directory (commands work in PowerShell and bash):

```text
server: npm test
server: npm run test:integration:isolated
server: npm run test:browser
server: npm run typecheck
server: npm run lint
server: npm run build
web:    npm test
web:    npm run build
```

The integration wrapper creates/migrates/resets a disposable local `_test`
database, never the application URL. Chromium browser tests build and serve the
real production frontend/service worker. Redis integration is optional when
`TEST_REDIS_URL` is absent; route-level throttle tests always run.
See [frontend architecture](docs/frontend-auth.md), milestone reports in `docs/`,
and the [final verification report](docs/final-auth-inventory-report.md) for actual
results and deployment steps.
