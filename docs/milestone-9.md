# Milestone 9: full verification and accurate documentation

Date: 2026-10-17, Africa/Lagos.

The complete production story now runs in Playwright: UI signup, empty-shop
cutover, product creation, manual sale, low-stock alert, fractional restock,
second-device stock/history restore, offline sale/reconnect and reversal.
It checks exact database totals and both devices, with the real service worker.

```text
Backend unit tests: 47 passed, 0 failed
Frontend unit tests: 29 passed, 0 failed
Database integration: 54 passed, 0 failed, 1 optional Redis skip (335163.0265ms)
Browser: 10 passed (1.8m), including full story (14.2s)
Typecheck, lint, backend build, frontend production build: exit 0
git diff --cached --check: exit 0
```

Actual final results and deployment instructions are in
[final-auth-inventory-report.md](final-auth-inventory-report.md). README and
frontend/backend authentication docs now describe the implemented client,
refresh/CSRF/cookie rules, operation sync, staff PINs, cutover and limits. Removed
claims include automatic live banking/receipt verification, unrestricted
WhatsApp relational writes and missing password-management behavior.

Added cross-platform lint tooling covers both apps and tests without changing
the TypeScript compiler. Existing duplicate identical parser keys and obsolete
suppression comments were cleaned up. The pre-existing web/package.json edit
remains excluded. No production database, hosting or external messages were used.

Assumptions/limits: optional Redis integration needs its own test URL; live HTTPS
and delivery are deployment checks; prototype banking, incomplete historical
financial migration, recovery enrollment and backend staff provisioning remain
as explicitly documented. Vite's chunk advisory and pg's dependency deprecation
warning do not fail the passing checks.

Exact changed files:

- README.md
- docs/backend-auth.md
- docs/final-auth-inventory-report.md
- docs/frontend-auth.md
- docs/milestone-9.md
- eslint.config.mjs
- server/package-lock.json
- server/package.json
- server/scripts/lint.mjs
- server/src/parser.js
- server/test/browser/full-story.spec.ts
- web/src/components/ui.jsx
- web/src/lib/parser.js
- web/src/screens/Assistant.jsx
- web/src/screens/GetPaid.jsx
- web/src/screens/Hub.jsx
- web/src/screens/Invoices.jsx
- web/src/screens/Records.jsx
