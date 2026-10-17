# Frontend authentication and inventory sync

`web/src/lib/api/client.js` is the single credentialed HTTP client. All private
inventory, sales, banking and server speech calls use it. `lib/api.js` and the
old inventory/sales upload loops were removed. External voice providers have
separate transports and do not receive Vendora session credentials.

## Identity and refresh

`features/auth/authStore.js` holds verified identity, memberships, selection and
session state in Zustand. `/api/auth/me` supplies identity and business access.
A selected business must appear in the server memberships. Requests capture
`X-Business-ID` before refresh, so changing selection cannot redirect a retry.
Signup requires name, businessName, phone and password; businessType/city are
optional at the API. It then logs in and verifies `/me`. Phone ownership is not
verified during registration.

One in-tab promise coordinates refresh. Across tabs, a `vendora-refresh` Web
Lock is followed by a `/me` recheck before another rotation. Without Web Locks,
a localStorage lease plus BroadcastChannel/polling is advisory; the backend's
short immediate-previous-token grace absorbs residual races. Messages contain
no credentials. Requests retry once, preserve their body/business and propagate
typed status/code/details errors. Credential entry uses `auth:false` to prevent
an incorrect password from starting refresh or expiring a valid session.

Final authentication failure shows re-login and retains account/business data.
Network failures do not mean logout. Protected screens wait for verified
restoration; a failed network restore does not expose an unverified account.
Password change is under Profile and revokes all backend sessions. Recovery
explains the verified-destination requirement and sends a generic request;
self-service recovery enrollment and a reset-token form are not implemented.

## Durable local-first operations

`features/sync/replicaRepository.js` owns IndexedDB `vendora-replicas`, with one
record per encoded user/business scope. A readwrite transaction stores canonical
products/sales/movements, mappings, cursor, local projection and UUID outbox
atomically. `store.js` awaits that commit before confirming core actions. The
older account-scoped localStorage remains for non-domain preferences, staff and
legacy initialization; unscoped `vendora:v2` data is never assigned automatically.

`domain.js` captures product/create/update/delete, stock/restock/count,
sale/create/reverse and repayment intentions. Money converts from naira to kobo;
quantities support three decimals. Captured sale prices and offline policy are
persisted before transmission. Ledger facts keep their local IDs and signatures;
server IDs live in mapping tables rather than rewriting those facts.

`outbox.js` and `accountSync.js` provide one scoped engine. It restores cursor
pages, bootstraps legacy mappings, pushes ordered batches up to 25 operations /
1000 sale lines and pulls again. Each operation has a separate server transaction
and receipt; the dedicated sales batch API has all-or-nothing semantics. Known
rejections stay visible while unrelated physical operations can continue.
Temporary failures back off exponentially (up to five minutes); reconnect/manual
sync resets pending deadlines. Uncertain results retry identical bodies/UUIDs.
Tabs coordinate scope work with Web Locks where available and native IndexedDB
transactions. Five-second polling and focus/online events restore peers' changes.

Cursor and canonical page writes commit together; projection waits for the last
page. Acknowledgment receipts only map IDs and mark success, never overwrite
newer canonical quantities. Pending local effects are projected once over server
values; a pulled sale with the same clientId prevents a lost-response double
application. Count corrections send observed/count deltas. Empty devices restore
products and sales, including captured items, repayments and reversals; historical
standalone restocks are available as movements, not recreated as signed local
restock transaction cards.

`bootstrap.js` matches backend legacy IDs and archives original device data.
Already backfilled products/sales/restocks do not apply twice. Ambiguous old
financial summaries or inferred openings show a migration-review warning.
SNAPSHOT businesses can request transactional migration through the verified API;
malformed snapshots block with a visible error and retain local work.

## User-visible behavior

`SyncStatus.jsx` shows synced, pending N, offline, needs attention or expired,
with rejected-operation details and retry/review actions. An online stock 409
shows the available quantity. Only an explicit confirmation that goods were
already delivered permits a new physical-sale UUID with offline oversell policy.
Dashboard `StockAlerts.jsx` shows unread low-stock and oversold alerts.

Expiry, tab closure and re-login keep the outbox. Explicit logout flushes first;
if operations remain it offers keep working, retry flush or confirmed discard.
Discard/rejection history is archived locally. Account switches use distinct
replicas. Browser storage is unencrypted and can be erased by the device owner
or browser; durability is not protection from storage eviction or device loss.

`staffPins.js` uses WebCrypto PBKDF2-SHA256 with a random device salt and migrates
legacy PINs on account activation/staff access. PINs switch a local recorded-by
label; all writes are attributed to the real account with server permissions.
The app explicitly labels this as a convenience lock.

## Worker and deployment

`web/public/sw.js` caches the public shell and hashed build assets only, with
credential-free public fetches and network-first navigation. API/banking paths,
non-GET, private/no-store, Set-Cookie and credential-varying responses are
excluded. Activation deletes all old cache names, calls skipWaiting/claim, and
account transitions purge response/query caches. This purge preserves IndexedDB
and account records. Old private caches disappear when the new worker activates.

Vite proxies `/api`, `/wema` and `/whatsapp` locally. Empty VITE_SERVER_URL uses
the frontend origin in both development and production; authenticated data still
requires the server. Production hosting needs its own proxy or a same-site API
origin. See [cookie topology and smoke testing](auth-deployment.md).

Run `npm test` and `npm run build` in web, and `npm run test:browser` in server
for the production frontend, actual cookies and service worker. PostgreSQL
transaction tests use `npm run test:integration:isolated` in server. Live HTTPS,
real delivery providers and bank integrations are not covered by local tests.
