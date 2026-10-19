# Milestone 0: baseline and reproductions

Branch: fix/auth-inventory-milestones. Date: 2026-10-17, Africa/Lagos.

The starting working tree already contained uncommitted Phase 1 schema,
migration, scripts, documentation and package changes. These are preserved.
No production database is used by the new harness. Application database URLs
are read only to prevent an operator from choosing the same target for reset.

## Commands

From server:
- npm test
- npm run test:integration:isolated
- npm run test:reproductions
- npm run test:browser
- npm run typecheck

From web: npm test.

Install the browser once: npx playwright install chromium.
The new browser harness serves the real service worker and the real browser HTTP
modules, using real Express/cookie auth and an isolated native UTF-8 PostgreSQL.
It uses a minimal HTML shell to isolate the auth bugs from unrelated React UI.
No API requests are mocked. Redis rate limiting is stubbed in this fixture only;
the existing limiter tests remain separate. Test credentials are synthetic.
Traces contain test credentials only and are ignored by Git.

test:integration:isolated creates an independent test cluster, migrates it,
passes its URL to the existing suite, and gracefully stops it afterward.
Each browser worker and stock reproduction likewise gets its own cluster.
Temporary database directories remain in the OS temp folder for diagnosis.

For an explicitly operator-provided disposable database, set TEST_DATABASE_URL
to a local database whose name ends in _test, distinct from DATABASE_URL and
DIRECT_URL. Then run npm run db:test:migrate or npm run db:test:reset.
Reset deletes only that explicitly validated test database's vendora schema and
migration history, then deploys the committed migrations. It never reads an
application URL as a fallback. Windows PowerShell: $env:TEST_DATABASE_URL = '...';
bash: export TEST_DATABASE_URL='...'.

## Model overlap and conflicts

There is one Prisma definition for each model, not duplicate Product models.
The conflicts are between representations:

| Domain | Representations and mismatches |
| --- | --- |
| Business/profile | Business row, BusinessSnapshot.state, browser profile, legacy JSON trader. Names/settings can diverge; memberships are authoritative ownership. |
| Product | Prisma Product/products, snapshot inventory[], browser products[], legacy trader.inventory. Relational UUID vs browser string ID; kobo BIGINT vs naira Number; integer stock vs fractional browser quantities; browser unit/aliases are absent from Product. |
| Customer | Prisma Customer, snapshot/browser customers, legacy trader.customers. Browser stores a balance; relational debt derives from Sale.total minus amountPaid. IDs differ. |
| Sale/items | Prisma Sale/SaleItem vs snapshot sales[] and browser txns[type=sale]. Embedded line items vs relations; naira vs kobo; browser IDs vs UUIDs; browser reversal flags lack a relational counterpart. |
| Repayment | Prisma Payment vs browser txns[type=debtPayment] and snapshot customer balance changes. Payment rows represent subsequent repayments; checkout tender is Sale.amountPaid. |
| Expense/restock | Expense is relational; browser restock transactions carry purchase cost. They must not be blindly treated as the same accounting event during backfill. |
| Stock movements | Browser append-only ledger and restock/adjust/reversal entries; no dedicated relational StockMovement model yet. |
| Staff/identity | Browser staff/PIN records vs User/Membership. Local staff are convenience attribution, not server identities or authorization. |
| Auth compatibility | PreAuth, VerificationChallenge and Session.csrf remain from the earlier OTP/CSRF flow but current HTTP auth does not use them. |

BusinessSnapshot remains active storage. Legacy server JS adapters retain another
trader snapshot representation; src/app.js and src/index.js are excluded from
the TypeScript build. Do not add a second relational inventory model.

## Baseline

Before changes: server npm test: 29 passed, 0 failed; web npm test:
2 passed, 0 failed. Database integration and reproduction results will be
recorded after execution. New regression tests assert the desired correct
behavior, so they must fail before their corresponding fixes; no test.fail or
expected-failure masking is used.

The stock regression targets the current live /api/sales/sync acceptance path
rather than failing on a future missing POST /api/sales endpoint. It explicitly
marks sales online and expects five accepted sales, five 409s and zero remaining
stock. It will move to the authoritative sales API in M5.

## Executed checkpoint results

| Command | Actual result |
| --- | --- |
| server: npm test | 31 passed, 0 failed (29 original + 2 test-database safeguards) |
| web: npm test | 2 passed, 0 failed |
| server: tsc -p tsconfig.tests.json | Exit 0, no diagnostics |
| server: npm run test:integration:isolated | Reset probe and repeated migration passed; 7 tests passed, 0 failed, 1 optional Redis test skipped; database stopped successfully |
| server: npm run test:browser | 2 failed for the intended assertions below |
| server: npm run test:reproductions | 1 failed for the intended assertion below |

Actual diagnostic output from the reproductions:

```text
M0(a) {"identityWasA":true,"inventoryWasA":true}
M0(b) {"requestStatuses":[401,200],"sessionRevoked":true,"directMe":401}
M0(c) {"accepted":10,"rejected":0,"remaining":5}
```

M0(a) expected B's identity and empty inventory after A logged out. Both
assertions failed with A's cached data. M0(b) expected both requests to succeed,
an unrevoked session, and a direct /me response of 200. The database confirms
the refresh race revoked the session. M0(c) expected accepted=5, rejected=5,
remaining=0; all ten sales instead succeeded and stock stayed at five.

An initial browser run resolved src/app.js to stale dist/app.js. The harness
now explicitly imports src/app.ts, with allowImportingTsExtensions enabled only
in the no-emit test configuration. Endpoint-existence preconditions prevent a
missing route from masquerading as a reproduction. The results above are from
the corrected run, not the initial harness failure.

Assumptions/limits: browser auth is exercised through real fetch/cookies in a
minimal page, not through React form selectors; the production worker source is
used unchanged. The legacy online sync route is the stock test target until M5.
TEST_REDIS_URL is not set, so the optional existing Redis integration test was
not executed. No application behavior has been changed in this milestone.

Changed files: .gitignore; server/package.json; server/package-lock.json;
server/tsconfig.tests.json; server/playwright.config.ts;
server/scripts/test-database.ts; server/test/support/database.ts;
server/test/support/http.ts; server/test/test-database.test.ts;
server/test/browser/fixtures.ts; server/test/browser/auth-privacy.spec.ts;
server/test/reproductions/stock.test.ts; docs/milestone-0.md.
