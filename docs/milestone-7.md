# Milestone 7: durable operation sync

Date: 2026-10-17, Africa/Lagos.

The former inventory array uploader and separate sales uploader are removed.
Authenticated actions now commit their local projection and UUID operation in
one IndexedDB transaction, scoped to verified user and business. A single
engine uploads ordered groups of up to 25 operations/1000 sale lines with
per-operation results, persisted request bodies, idempotent retries and
exponential backoff. Each server operation keeps its own atomic transaction;
this transport differs from the all-or-nothing sales batch API.

Cursor pages and canonical records commit together. Fresh accounts restore
products and sales, including price snapshots and reversals. The local display
replays only unapplied intentions over canonical quantities; a stale receipt
never replaces a newer server value. Product identifiers remain mapped rather
than rewriting signed historical facts. Prices convert to integer kobo and
fractional sale lines round exactly before local ledger sealing.

Sync status and rejected operations appear in the app. A known stock rejection
can be dismissed or explicitly resubmitted under a new UUID only after the
user confirms goods already changed hands. Session expiry, tab closure and
re-login preserve pending operations. Logout attempts a flush and requires an
explicit discard if operations remain. Account changes isolate replicas.

Legacy device data is archived and mapped by the same legacy IDs as the
backfill. Matching products, sales and restocks do not apply twice. Ambiguous
financial history or inferred stock reconciliation produces a visible review
warning. This does not claim complete migration of legacy banking/debt history;
original device facts and the server snapshot remain available for review.

## Reproduction and verification

The fresh-device browser reproduction initially returned zero restored sales
(expected one). It passes with cursor restore. The legacy compatibility test
initially returned 400 for missing mapping support; matching backfilled records
now replay without stock changes and altered sale facts return 409. The batch
endpoint initially returned 404. The frontend batch test initially sent no
batch; both now pass, including mixed accepted/rejected/duplicate outcomes.

Actual results:

```text
server npm test: 43 passed, 0 failed
web npm test: 27 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
test:browser: 7 passed (1.2m), production Vite build and real service worker
test:integration:isolated: 53 passed, 0 failed, 1 optional Redis test skipped
integration duration: 309455.4636ms; isolated PostgreSQL stopped cleanly
git diff --check: exit 0
```

The seven browser tests include all four required production UI scenarios:
three offline half-bag sales and a 1.25-bag restock converge to 9.75 bags and
three exact 50013-kobo sales; independent devices preserve both sales; an empty
browser restores stock and visible history; and tab closure plus authoritative
session expiry retains a queued sale through re-login. Existing privacy and
cross-tab refresh regressions pass. IndexedDB is persistent browser storage;
the automated durability case closes/reopens the tab, not the browser process.

No live business or production database was migrated. The optional lazy-login
migration flag remains off. A verified app can request transactional migration;
malformed data blocks it with a visible review error, retaining local records.

Changed areas: server inventory/sales schemas, services and routes; ordered sync
schemas/service/route and app mount; production browser harness; compatibility
and batch integration tests; frontend sync modules; account lifecycle/store;
sale, stock, assistant, wallet, WhatsApp preview, delivery and credit screens;
quantity/money display and derived totals; outbox/domain tests. Obsolete
inventorySync.js and salesSync.js were removed. The pre-existing unrelated
web/package.json edit is excluded from this milestone.

The Redis case remains optional because TEST_REDIS_URL is unset. Vite reports
the existing chunk-size advisory. PowerShell marks redirected native stderr
warnings as a command error even when Playwright prints all seven passing;
future redirected runs explicitly propagate the native exit code.

Exact changed files:

- docs/milestone-7.md
- server/package.json
- server/src/app.ts
- server/src/routes/inventory.routes.ts
- server/src/routes/sales.routes.ts
- server/src/routes/sync.routes.ts
- server/src/schemas/inventory.schemas.ts
- server/src/schemas/sales.schemas.ts
- server/src/schemas/sync.schemas.ts
- server/src/services/inventory.service.ts
- server/src/services/sales.service.ts
- server/src/services/sync-action.service.ts
- server/test/browser/fixtures.ts
- server/test/browser/offline-ui.spec.ts
- server/test/browser/sync.spec.ts
- server/test/integration/sync-compat.test.ts
- server/test/integration/sync-push.test.ts
- server/test/support/http.ts
- web/src/App.jsx
- web/src/features/inventory/inventorySync.js
- web/src/features/sales/salesSync.js
- web/src/features/sync/SyncStatus.jsx
- web/src/features/sync/accountSync.js
- web/src/features/sync/bootstrap.js
- web/src/features/sync/domain.js
- web/src/features/sync/outbox.js
- web/src/features/sync/replicaRepository.js
- web/src/lib/format.js
- web/src/lib/insights.js
- web/src/lib/store.js
- web/src/screens/Assistant.jsx
- web/src/screens/CreditAlert.jsx
- web/src/screens/Hub.jsx
- web/src/screens/Sell.jsx
- web/src/screens/Stock.jsx
- web/src/screens/Wallet.jsx
- web/src/screens/WhatsApp.jsx
- web/test/outbox.test.js
- web/test/sync-domain.test.js
