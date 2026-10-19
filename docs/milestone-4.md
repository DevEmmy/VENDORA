# Milestone 4: server-authoritative relational inventory API

Date: 2026-10-17, Africa/Lagos.

## Red, then green

Before implementation all six API acceptance cases failed at POST /api/products
(404 instead of 201). The original stock-race reproduction remains separate and
is not claimed as fixed until atomic sales in M5. A later unit reproduction
also showed numeric 0.1+0.2 being rejected as excessive quantity precision.

Final actual checkpoint output:

```text
server npm test: 39 passed, 0 failed
web npm test: 19 passed, 0 failed
server npm run typecheck: exit 0
server npm run build: exit 0
web npm run build: exit 0 (existing Vite chunk-size advisory)
test:integration:isolated: 26 passed, 0 failed, 1 optional Redis test skipped
test:browser: 2 passed (46.3s)
```

The inventory suite verifies CRUD, identical/different idempotency replays,
readonly counts, tombstones, concurrent fractional restocks, ten concurrent
replays applying once, delta count corrections after arrivals and a sale,
tenant/permission isolation, real actor attribution, CORS methods, one unread
low-stock notification per product and cursor pages under interleaved writes.

## API

All routes retain cookie sessions, the existing error/requestId response fields,
and X-Business-ID. They require active sales:write permission. Relational routes
return INVENTORY_MIGRATION_REQUIRED for a SNAPSHOT business; no production
business is cut over by this milestone.

| Method/path | Behavior |
| --- | --- |
| POST /api/products | clientId, name, unitPrice (kobo), optional costPrice/units/aliases/threshold/openingQty; opening stock uses the movement service |
| GET /api/products, GET /api/products/:id | Business-scoped product reads; quantities and kobo are decimal/integer strings |
| PATCH /api/products/:id | Edit metadata/prices/threshold, never currentQty/stockQty |
| DELETE /api/products/:id | Soft delete and publish a tombstone |
| POST /api/products/:id/restock | Positive quantity and clientId |
| POST /api/products/:id/count | countedQty minus observedQty applied to current stock |
| GET /api/sync/changes?since=0&limit=100 | Immutable ordered product/sale/movement events plus nextCursor and hasMore |
| GET /api/notifications?unread=true | Latest scoped stock alerts |
| POST /api/notifications/:id/read | Idempotent acknowledgement |

Mutation replies include duplicate; product creation is 201 initially and 200 on
replay. Stock/pricing/metadata mutation operations have a durable receipt keyed
by business and UUID clientId, with a normalized request hash and original
response. Reusing an ID with different details returns 409 IDEMPOTENCY_CONFLICT.
Replays do not overwrite current state or advance syncSeq.

## Transaction and storage decisions

applyStockMovement has no Express imports. A standalone movement owns one
transaction; product opening stock and future sales pass the existing inventory
transaction without nesting a commit. Every write locks the business first,
checks current membership, locks the product when moving stock, writes before/
after quantities and the append-only movement, increments the business sequence
and appends change events atomically. Count corrections use a delta, not an
absolute replacement. Current nonnegative stock policy is retained until M5.

InventoryOperation is an immutable applied-operation receipt, not another
inventory model. It also makes metadata edits/deletes idempotent, which the
movement table alone cannot do. The real signed-in user is recorded; optional
recordedBy labels remain metadata. Notification is the first server notification
model. A SQL-owned partial unique index permits one unread alert per product.
Historical read notifications remain retained.

Changes use immutable payloads and a transaction-consistent high-water mark,
so later edits cannot make an earlier cursor skip a record. BigInt cursors/money
and Decimal quantities are explicitly serialized to strings. Browser arithmetic
noise is normalized only within machine epsilon; true fourth decimals fail.

Migration: 202610170002_inventory_api. Reapply runtime-grants.sql after deploy.
Applied-operation, movement and change receipts grant no runtime UPDATE/DELETE.
No live database was migrated. The frontend still uses its existing snapshot
flow until M6/M7; these new APIs are not falsely presented as integrated there.
The optional Redis integration remains skipped because TEST_REDIS_URL is unset.

Changed files: server/prisma/schema.prisma; server/prisma/runtime-grants.sql;
server/prisma/migrations/202610170002_inventory_api/migration.sql;
server/src/app.ts; server/src/middleware/error-handler.ts;
server/src/types/inventory.ts; server/src/schemas/inventory.schemas.ts;
server/src/services/inventory-transaction.ts;
server/src/services/inventory-serialization.ts;
server/src/services/inventory.service.ts; server/src/routes/inventory.routes.ts;
server/test/inventory-schemas.test.ts; server/test/integration/inventory-api.test.ts;
web/src/lib/api/client.js; docs/milestone-4.md.
