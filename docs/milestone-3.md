# Milestone 3: relational inventory foundation

Date: 2026-10-17, Africa/Lagos. Existing Phase 1 prerequisite checkpoint: bd619c2.

## Red, then green

The initial schema suite failed: quantity/threshold columns were integer,
inserting 0.5 failed with PostgreSQL 22P02, and the populated upgrade retained
the integer types. This was recorded before changing the schema.

Final executed results:

```text
prisma validate: valid schema
server npm test: 37 passed, 0 failed
web npm test: 19 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
test:integration:isolated: 18 passed, 0 failed, 1 optional Redis test skipped
test:browser: 2 passed (52.9s)
```

The six migration tests cover fresh deployment; exact half-bag storage;
populated upgrade preserving snapshot JSON, stock, sale items and money;
per-business uniqueness/tenant references/append-only ledgers/runtime grants;
and an oversized legacy integer blocking migration without partial changes.
Repeated deploy also passes. The unsafe-case test initially exposed Prisma
masking an exception inside an aborted DDL transaction. Moving the read-only
preflight before BEGIN preserves its original capacity error; DDL stays atomic.

## Decisions

- Product stock/threshold and SaleItem quantities are Decimal(12,3). Existing
  nonnegative stock and positive sale-item checks remain. The offline oversell
  policy is introduced with the atomic sales milestone, not silently enabled.
- Money remains BIGINT integer kobo. nairaToKobo validates finite/nonnegative
  input, uses Math.round(naira * 100), rejects unsafe integer conversion and
  returns bigint. Tests cover 0.1+0.2, rounding, large values and invalid inputs.
- Product, Sale and StockMovement have business-scoped nullable UUID clientId,
  legacyId, timestamps and syncSeq. Products retain unit/aliases. Sales have
  status and a same-business, unique reversal link.
- StockMovement records signed quantity, before/after quantities, source,
  reference, actor, idempotency key and oversold flag. PostgreSQL triggers and
  restricted runtime grants enforce append-only posted movements. deletedAt
  exists for the common representation but must stay null on posted movements;
  corrections/reversals append rows. Products/sales support tombstone fields.
- Business.syncSeq and immutable SyncChange events support ordered, clock-free
  pulls. Keeping events prevents losing an intermediate change when an entity
  changes repeatedly. Allocation and API publication are M4 service work;
  this schema milestone does not claim those APIs are already active.
- Business.inventoryMode defaults to SNAPSHOT. No business is cut over and
  snapshots are not modified by the migration. M6 performs verified backfill.

Decimal(12,3) supports up to 999999999.999. The migration checks all existing
integer quantity/threshold values before DDL and refuses values outside its
representable range. No values are truncated to make a deployment succeed.
No live application database was inspected or migrated; safety was verified
against fresh/populated/oversized disposable fixtures, and the same preflight
executes automatically before a real migration.

Reapply prisma/runtime-grants.sql after deployment: movement/change tables grant
the runtime role SELECT/INSERT, not UPDATE/DELETE. Keep vendora backend-only.
The new migration is 202610170001_inventory_foundation. Existing auth tables
and cookie/session contracts are unchanged. TEST_REDIS_URL remains unset, so its
optional integration check is not claimed as executed. M0(c) remains pending.

Changed files: server/prisma/schema.prisma; server/prisma/runtime-grants.sql;
server/prisma/migrations/202610170001_inventory_foundation/migration.sql;
server/src/services/money.ts; server/test/money.test.ts;
server/test/integration/inventory-schema.test.ts;
server/scripts/test-database.ts; server/test/support/database.ts;
docs/milestone-3.md. Integration files now run sequentially to avoid competing
native PostgreSQL startup/teardown on Windows.
