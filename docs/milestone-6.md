# Milestone 6: snapshot backfill and cutover

Date: 2026-10-17, Africa/Lagos.

## Reproduction and actual verification

Before the cutover guard, the new test observed an old PUT /api/inventory
returning 200 for a RELATIONAL shop (expected 410). A second failing unit test
showed null inventory and missing counts being mistaken for empty/zero stock;
these now block migration. Tests also caught a snapshot trigger column mapping
mistake and an invalid webhook test fixture before the final checkpoint.

The WhatsApp acceptance check exposed an existing delivery-clock bug: with the
PostgreSQL timezone Africa/Lagos, a newly queued reply had jobs=1, eligible=0.
Prisma's UTC timestamp-without-time-zone fields were compared implicitly to
timestamptz NOW(). Explicit UTC clock comparisons fix expiry/lease eligibility.
The regression now sets the transaction timezone to Lagos on every platform.

Final actual results:

```text
server npm test: 43 passed, 0 failed
web npm test: 19 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
web npm run build: exit 0 (Vite chunk-size advisory)
test:integration:isolated: 51 passed, 0 failed, 1 optional Redis test skipped
integration duration: 216501.3148ms; isolated database stopped cleanly
test:browser: 2 passed (1.4m)
git diff --check: exit 0
```

The integration suite covers a real CLI dry-run without writes, an empty shop,
fractional sales/kobo conversion and cursor restore, immutable snapshot bytes/
timestamp, idempotent rerun, reuse of legacy mappings, inconsistent partial
imports, an old array upload racing cutover, ledger-only restocks/counts/sales/
reversals, negative quantities/alerts, missing prices/duplicate reports,
malformed/conflicting data, removed SKU tombstones, authorization, retained
SNAPSHOT APIs, lazy login (including malformed data without breaking login),
retired routes, database protection and the actual WhatsApp delivery queue.
Existing auth, inventory, sales, migration, privacy and refresh suites pass.

## Decisions, assumptions and limitations

See inventory-backfill.md for exact commands, report fields and deployment
steps. Inventory mode stays SNAPSHOT by default. INVENTORY_LAZY_BACKFILL=false
is the default. No live database or business was migrated.

One business transaction validates legacy data, maps string IDs, converts naira,
posts stock movements through the shared service, verifies snapshot quantities
against ledger sums, emits changes and switches mode. Historical createdById is
null; importer/recordedBy labels are metadata, not invented account identities.
Explicit reconciliation movements account for missing/truncated stock history.
Dry-run simulates pending movements and skipped receipts before any writes.

The snapshot remains a read-only rollback copy. Legacy inventory GET/PUT and
sales/sync and sync POST return 410 after cutover; writes recheck inside the
business lock and a SQL trigger protects other stale writers. WhatsApp replies
direct users to the app instead of recording against an obsolete snapshot.

Warnings must be reviewed by the operator. Non-stock records/customer balance
summaries remain in the snapshot and report; imported sale tender determines
relational receivables. This milestone does not claim complete conversion of
legacy banking/debt-payment history or independently verified device evidence.
The frontend still needs M7's relational sync before live cutover is enabled.
Optional Redis integration was skipped because TEST_REDIS_URL is unset.

Changed files:

- server/.env.example
- server/package.json
- server/prisma/schema.prisma
- server/prisma/migrations/202610170004_snapshot_cutover/migration.sql
- server/scripts/inventory-backfill.ts
- server/src/adapters/delivery-queue.ts
- server/src/config/env.ts
- server/src/routes/auth.routes.ts
- server/src/routes/snapshot.routes.ts
- server/src/services/inventory.service.ts
- server/src/services/inventory-backfill.service.ts
- server/src/services/lazy-inventory-backfill.ts
- server/src/services/snapshot-backfill-plan.ts
- server/src/services/snapshot-mode.ts
- server/src/services/webhook.service.ts
- server/src/types/auth.ts
- server/test/support/http.ts
- server/test/backfill-plan.test.ts
- server/test/integration/backfill.test.ts
- docs/inventory-backfill.md
- docs/milestone-6.md
