# Auth and inventory verification report

Date: 2026-10-17, Africa/Lagos. Branch: fix/auth-inventory-milestones.

## Implemented behavior and evidence

| Area | Current behavior | Evidence |
| --- | --- | --- |
| Private response caching | Public shell/hashed assets only; credential-free public fetches; all old caches purged on activation | Worker unit tests and real account-switch browser test |
| Refresh races | One HTTP client, in-tab promise, cross-tab lock/recheck, advisory fallback; immediate-previous-token grace | Frontend client tests, PostgreSQL grace/replay/logout-all tests, two-tab browser test |
| Authoritative stock | Business-scoped product CRUD, observed-count deltas, append-only stock movements, transactional row locks and receipts | Concurrent fractional movements, isolation, permissions, cursor/tombstone integration tests |
| Atomic sales | Sale/items/payment/movements in one transaction; exact kobo totals; UUID replay; one reversal | Ten concurrent sales against stock five, duplicate/batch/rollback/reversal tests |
| Stock policy | Online shortage returns 409 with available quantity; physical offline sales may oversell with alerts | PostgreSQL policy tests; visible sync rejection/explicit physical-sale confirmation UI |
| Local-first sync | Scoped IndexedDB domain/outbox commits, ordered batches, stable retries/backoff, per-operation results and cursor merge | Outbox/domain tests, batch integration, real offline and independent-device UI tests |
| Fresh-device history | Products and sales restored, including captured items, payments and reversals | Native replica test, production restore test, full signup-to-reversal story |
| Fractions and legacy IDs | Decimal(12,3) quantities, integer kobo, nullable per-business client/legacy mappings | Fresh/populated migration tests, conversion tests and exact half-bag UI totals |
| Backfill and cutover | Transactional dry-run/report/import; totals verified; snapshot immutable; stale array routes return 410 | Backfill fixtures, CLI dry-run, race/idempotency/trigger/WhatsApp tests |
| Session expiry | Authoritative idle/absolute expiry; local work retained; explicit flush/discard on logout | Session tests and offline sale surviving tab closure, expiry and re-login |
| Hardening | Trusted Origin/Fetch Metadata for cookie writes; existing throttles verified; stronger new passwords | Middleware, limiter-exhaustion and real password-change/attribution tests |
| Staff and deployment | PBKDF2 local convenience PINs; actual account is API author; same-site diagnostics and cookie smoke | PIN migration/action tests, actor integration test and headless browser smoke |

Milestone reports 0–8 contain the baseline, red/green reproductions, assumptions,
actual checkpoints and exact changed files. The initial requested 29 backend /
2 frontend tests were preserved and expanded; new-credential fixtures were
updated where the explicitly requested password policy changes their input.

## Final commands and actual results

Commands run from the named directory against this working tree:

```text
server npm test: 47 passed, 0 failed (12407.4473ms)
web npm test: 29 passed, 0 failed (5542.4476ms)
server npm run typecheck: exit 0
server npm run lint: exit 0, no errors/warnings
server npm run build: exit 0
web production build through test:browser: exit 0 (18.58s)
server npm run test:browser: 10 passed (1.8m)
server npm run test:integration:isolated: 54 passed, 0 failed, 1 optional skip
integration duration: 335163.0265ms; isolated PostgreSQL stopped cleanly
git diff --cached --check: exit 0
```

The browser suite serves the actual Vite production build and service worker.
The final suites contain 140 passing tests in total, with one optional shared
Redis test skipped because TEST_REDIS_URL is unset.
Its full story signs up through the UI, migrates the empty shop, adds Rice,
sells one bag, observes a low-stock alert, restocks 2.5 bags, restores on an
independent browser context, posts an offline half-bag sale and reverses the
original sale. Both devices converge to five bags, with one reversal retained.
The complete story passed in 14.2 seconds. Initial story failures were fixture
label/schema mistakes, corrected without inventing application fixes.

Lint covers repository-owned backend/frontend source, scripts and tests.
Generated Prisma code and vendored OCR artifacts are excluded. Babel parses
TypeScript syntax while the existing TypeScript 7 compiler performs strict
checks; the TypeScript ESLint parser's declared peer range does not support this
repository's compiler. Lint also rejects explicit any. It found an identical
duplicate parser alias and obsolete suppression comments, removed without
changing runtime behavior.

## Remaining limits

- The optional shared-Redis integration requires TEST_REDIS_URL and is skipped
  when unset. Route-level throttle exhaustion and fail-closed behavior pass.
- Production HTTPS/proxy ingress, real outbound delivery and live migration
  require operator checks. All automated database work used disposable local
  test databases; no live business or production deployment was changed.
- Legacy banking/balance summaries and incomplete device history require review.
  Original data is retained; inferred stock adjustments are explicitly reported.
  Historical standalone movements are restored as movements, not invented
  signed local restock cards. Imported server history carries honest local
  import evidence rather than claiming the original device signature.
- Staff PINs are not separate backend identities. Recovery enrollment/email
  verification and a hosted reset-token form are follow-up work. A phone number
  alone is insufficient for recovery.
- Browser records are unencrypted and depend on browser storage retention.
  The durability regression closes/reopens a tab; it does not restart the entire
  browser process. Device loss, storage clearing or eviction are not backups.
- Banking, loans, CAC/premium and marketplace examples remain prototype/mock
  features. Relational WhatsApp shops are directed to the app; no snapshot sale
  is recorded for them.
- Vite reports a large-chunk advisory. The pg dependency reports its concurrent
  query deprecation warning during transactional load tests; current tests pass.
- Server runtime-only npm audit reported zero advisories. Full server npm audit
  reported three development-only advisories through the existing nodemon /
  chokidar / braces chain. This is not a full frontend dependency audit.

## Manual release steps

1. Back up PostgreSQL and retain original snapshots/device data. Review existing
   stock counts, pending physical sales and financial summaries before cutover.
2. Configure a migration credential and run `npm run db:deploy` in server.
   Apply reviewed `server/prisma/runtime-grants.sql` as an administrator; the
   runtime login must not own the schema or have DDL/audit-rewrite privileges.
3. Configure runtime PostgreSQL/TLS, Redis, RSA keys and
   DELIVERY_ENCRYPTION_KEY. Set exact CORS_ORIGINS, COOKIE_SECURE=true and
   PUBLIC_API_ORIGIN for HTTPS. Prefer a frontend /api proxy; shared-parent API
   hosting also needs the declared registrable COOKIE_SITE_DOMAIN. Configure
   TRUST_PROXY only for the actual trusted ingress.
4. Keep INVENTORY_LAZY_BACKFILL=false while reviewing shops. For each business,
   run the dry-run and inspect every blocked/warning entry:

   ```text
   npm run inventory:backfill -- --business <business-UUID> --dry-run
   npm run inventory:backfill -- --business <business-UUID>
   ```

   A blocked report exits 2 and writes nothing. Live import is atomic and
   re-running after cutover is a no-op. The new app can itself request migration
   when it meets a SNAPSHOT shop; stage frontend rollout if you need exclusively
   operator-driven cutovers. The login feature flag does not disable this API.
5. Release the backend and new frontend together after migration review. Serve
   web/dist over HTTPS. Old array clients receive 410 after cutover and must
   upgrade. New worker activation purges all previous caches; do not clear whole
   browser site storage while there is unsent work.
6. Run `npm run smoke:cookies` with a disposable account as described in
   auth-deployment.md. Verify actual HTTPS cookies, proxy/CORS behavior, two-tab
   refresh, a second-device restore and visible sync/stock alerts in staging.
   Enable real delivery only with an independently verified recovery destination
   and a correctly implemented RECOVERY_ORIGIN reset page. WhatsApp stays off
   unless explicitly configured.
7. Retain backups and the immutable snapshot. It is a historical rollback copy,
   not the latest stock after new relational sales. Reconcile/export later
   operations before any rollback; changing inventoryMode alone loses context.

See inventory-backfill.md, auth-deployment.md, frontend-auth.md and
backend-auth.md for the exact API/configuration contracts.
