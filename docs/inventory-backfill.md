# Inventory backfill and cutover

Apply schema migrations using the migration role first. Backfill uses the
configured runtime DATABASE_URL, TLS and pool settings; it does not run DDL.
Keep INVENTORY_LAZY_BACKFILL=false until the relational frontend is deployed
and verified. The frontend remains on legacy snapshot sync through milestone 6.

From server/ (the same commands work in PowerShell and bash):

```text
npm run inventory:backfill -- --business <business-UUID> --dry-run
npm run inventory:backfill -- --business <business-UUID> --actor <member-UUID>
```

--business is required; this command never infers a shop from a phone or scans
all businesses. --actor is optional for an administrative CLI run; when given,
it must name an active member with sales:write. Do not treat it as the author
of imported physical transactions. Historical createdById stays null and
importedBy is migration metadata. Live API operations retain their actual actor.

The JSON report contains status, snapshot SHA-256, counts, stock totals, and
warnings/errors by legacy path. Dry-run exits without writing. A blocked report
exits 2, operational/configuration failure exits 1, successful reports exit 0.
An applied report is also retained on the business. Re-running after cutover
returns already-relational without advancing the cursor or creating any rows.

One transaction locks the business, validates the snapshot, creates/reuses
legacy mappings, posts movements, verifies each product quantity and ledger
sum, emits cursor events and sets RELATIONAL. A failure rolls everything back.
The snapshot state and updatedAt remain unchanged as a rollback copy. There is
no automatic rollback after new relational sales; reconcile/export those sales
before any operator-directed storage-mode change.

Products map old string IDs to UUIDs with legacyId. Quantities retain three
decimal places; naira becomes integer kobo. Fractional sale lines round half-up
per line; totals are recomputed and differences reported. Missing prices become
zero with a warning. Missing counts, conflicting duplicate IDs, malformed rows,
out-of-range quantities and inconsistent partial imports block cutover.
Identical duplicates are skipped. Removed historical SKUs become tombstones
so their sales remain recoverable. Negative physical stock remains negative
and creates an oversold notification.

Where available, device ledger product/opening, restock, count, sale and reversal
facts become stock movements. A sale present in both uploaded sales and the
device ledger is applied once. When full history is absent or totals differ,
an explicit LEGACY_ADJUSTMENT reconciles to the saved snapshot quantity and is
reported. This is a migration adjustment, not independently verified evidence.
The original ledger signatures remain in the snapshot; the importer does not
claim to verify them. Sale/restock reversals remain visible in the movement
history and sale reversals have linked credit notes.

Review every warning before running live. Non-stock history, including legacy
customer balance summaries and unallocated debt-payment records, is retained in
the snapshot and reported; it is not silently represented as a stock movement
or a bank-confirmed payment. Imported sale tender determines relational debt.
Reconcile those summaries against the sales history before enabling debt views
on a migrated business. No live business has been migrated by the test suite.

GET/PUT /api/inventory, POST /api/sales/sync and POST /api/sync return 410
SNAPSHOT_RETIRED after cutover. Writes recheck mode under the business lock and
a database trigger protects the rollback copy against other stale writers.
SNAPSHOT shops retain the legacy API. Relational sales/history use the current
API; the snapshot copy is not a current history source.

With INVENTORY_LAZY_BACKFILL=true, successful login attempts migration only for
the user's authorized SNAPSHOT memberships. Login returns inventoryMigrations
with applied/blocked/unavailable status and still succeeds if data cannot be
migrated. This flag defaults to false. /api/auth/me exposes inventoryMode.

WhatsApp snapshot processing is disabled for a relational shop and sends an
explicit app instruction saying no sale was recorded. It does not acknowledge
a physical sale or answer stock questions from an obsolete snapshot.
