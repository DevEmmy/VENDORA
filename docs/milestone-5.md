# Milestone 5: atomic sales

Date: 2026-10-17, Africa/Lagos.

## Reproduction and verification

Before the API existed, the sales acceptance tests failed at checkout. During
implementation the integration run also caught invalid nested Prisma inputs
(503) and a separate per-business client-key regression (404 on the second
business). These were corrected before the final checkpoint.

Actual checkpoint results:

```text
server npm test: 41 passed, 0 failed
web npm test: 19 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
web npm run build: exit 0 (Vite chunk-size advisory)
test:integration:isolated: 37 passed, 0 failed, 1 optional Redis test skipped
test:browser: 2 passed (53.8s)
test:reproductions: 1 passed, 0 failed
M0(c) {"accepted":5,"rejected":5,"remaining":0}
```

The original M0 legacy-endpoint failure is retained in commit 90ca1f1. The
current reproduction uses the authoritative product/sales endpoints with the
same five-stock/ten-request assertion. Legacy snapshot writes are isolated at
cutover in M6; this report does not claim the legacy endpoint decrements stock.

Tests cover concurrent online sales, fractional line totals, ten identical
replays, offline oversell alerts, improving negative stock by restocking,
reversal of a deleted SKU exactly once, queued physical sales of deleted SKUs,
atomic batch replay, complete rollback of multi-line and batch failures,
customer/payment scope, repayment replay/overpayment, server-captured prices,
cursor history and Lagos date boundaries. Sale, inline-customer, payment and
reversal keys can be reused independently in another business.

## Behavior and assumptions

POST /api/sales accepts a single checkout or a root clientId plus sales array.
The business lock, sale/items/payments/customer, stock movements, cursor events
and durable idempotency receipts commit together. Stock changes still use
applyStockMovement; it accepts an existing transaction rather than nesting one.

Online sales default to fromOffline=false and reject shortage with HTTP 409,
code INSUFFICIENT_STOCK and details.availableQuantity. fromOffline=true records
a physical sale even below zero and creates/updates an unread OVERSOLD alert.
This flag is an explicit trust decision for a signed-in, authorized trader; it
is not proof of network state. Counts apply deltas, and positive restocks and
reversals may improve an already negative balance. The dashboard polls private
stock alerts and displays oversold reconciliation messages and refresh errors.
The frontend checkout/outbox integration follows in M7.

POST /api/sales/:id/reverse creates a credit-note sale, restores stock, marks
the original REVERSED, and rejects a second distinct reversal. Payment rows
record subsequent/provided repayments; amountPaid includes checkout tender.
POST /api/sales/:id/payments is scoped, atomic and idempotent. Reversal here
records goods/receivable correction; it does not execute a bank refund.

Prices and totals remain integer kobo. Each fractional line is rounded half-up
to the nearest kobo using Decimal, then summed on the server. Optional quoted
line prices allow an authorized trader to record the actual physical price.
History uses createdAt/id keyset pagination and Africa/Lagos calendar dates.
Invoice numbers are allocated under the business lock. Random server IDs are
distinct from nullable per-business client IDs; legacy mappings remain separate.

Migration: 202610170003_atomic_sales. It permits negative stock, adds invoice
counters, immutable item name/unit snapshots and customer/payment mappings.
No live database was changed. The optional Redis integration was not run
because TEST_REDIS_URL is unset. pg emits a dependency deprecation warning
under transaction load; assertions and transaction outcomes all pass.

Changed files:

- server/prisma/schema.prisma
- server/prisma/migrations/202610170003_atomic_sales/migration.sql
- server/src/app.ts
- server/src/routes/inventory.routes.ts
- server/src/routes/sales.routes.ts
- server/src/schemas/inventory.schemas.ts
- server/src/schemas/sales.schemas.ts
- server/src/services/inventory-transaction.ts
- server/src/services/inventory.service.ts
- server/src/services/money.ts
- server/src/services/lagos-time.ts
- server/src/services/sales-serialization.ts
- server/src/services/sales.service.ts
- server/test/integration/inventory-api.test.ts
- server/test/integration/sales-api.test.ts
- server/test/support/api.ts
- server/test/money.test.ts
- server/test/lagos-time.test.ts
- server/test/reproductions/stock.test.ts
- web/src/features/inventory/StockAlerts.jsx
- web/src/screens/Home.jsx
- docs/milestone-5.md
