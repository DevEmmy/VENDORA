# Backend authentication setup

The server uses strict TypeScript, Prisma 7/PostgreSQL, Redis throttling,
Argon2id passwords, RS256 access cookies, rotating opaque refresh cookies,
database sessions and server-issued memberships. Signup creates an active account
immediately; phone OTP and CSRF token exchange are removed for the hackathon.
Credentials never appear in response JSON. The frontend signup/login integration
is described in [frontend-auth.md](frontend-auth.md).

## Configure and run

For local development, run `npm run dev` in `server`. Nodemon watches source files
and `.env`, and runs the TypeScript entrypoint using `tsx`. Generated Prisma files
are ignored by the watcher. Use `npm start` for the compiled production server.

Background failures include an `operation` and a diagnostic `hint`.
`worker-unavailable` covers WhatsApp processing and outbound delivery;
`maintenance-unavailable` covers expired delivery-job and session cleanup.
Check the hint for database connectivity, missing migrations/runtime grants, or
delivery configuration. Logs do not include raw errors or connection secrets.

WhatsApp is disabled by default (`ENABLE_WHATSAPP=false`). Its webhook/link/demo
routes return 404, the webhook worker does not poll, and queued WhatsApp replies
are not sent. Set `ENABLE_WHATSAPP=true` to restore the integration later.
Password-recovery delivery and expired-session/job cleanup remain enabled.

Use Node 22.12+ or Node 24 LTS. In `server`, run `npm ci`, copy `.env.example` to
`.env`, and supply the required settings. Generate a PKCS8 RSA private key and
SPKI public key of at least 2048 bits. PEM settings may contain escaped newlines.
`AUTH_KEY_ID` identifies the pair. Rotate both keys and the ID together: existing
access tokens reject, while valid refresh credentials obtain newly signed access.
Generate `DELIVERY_ENCRYPTION_KEY` using 32 random bytes encoded as base64. Keep all secrets
outside source control. Drain/reissue delivery jobs before changing their key.

`DATABASE_URL` is the restricted runtime login. `DIRECT_URL` is used only by Prisma
migration commands, not generation or runtime startup. Copy the direct/session
pool endpoint from Supabase Connect. Port 6543 transaction pooling is rejected.
`DATABASE_TLS=true` verifies certificates; supply `DATABASE_CA` when needed.
Alternatively set `DATABASE_CA_FILE=certs/prod-ca-2021.crt` to load a downloaded
provider CA from disk. Paths are relative to the server working directory. Use
one CA setting at a time; TLS certificate verification remains enabled.
Connection-URL TLS overrides are rejected. Plain database connections and
development cookie names are permitted only outside production. The pool defaults
to five connections per process with bounded connection/query timeouts.

Run `npm run build`, apply committed migrations with `npm run db:deploy` as a
controlled release step using the migration role, then `npm start`. Startup checks
PostgreSQL, Redis and the signing pair before listening. Never run development
migrations/reset/`db push` against production; baseline populated databases first.

Keep `vendora` out of Supabase's exposed Data API schemas and disable the Data API
when unused. The migration revokes public/anonymous access. An administrator
applies `prisma/runtime-grants.sql`, then grants `vendora_runtime` membership to a
dedicated runtime login with normal role inheritance, no schema ownership, DDL or
`BYPASSRLS`. Reapply reviewed grants after schema changes. The migration owner
must never be the runtime login. Express identity is enforced in repository
ownership scopes; Supabase `auth.uid()` does not apply to these sessions.

Use one public HTTPS origin with `/api`, `/wema` and `/whatsapp` proxied to Express.
`CORS_ORIGINS` requires exact origins without paths or wildcards. `TRUST_PROXY`
must identify the actual trusted proxy addresses/subnets. Enforce HTTPS/HSTS and
restricted backend ingress. GitHub Pages plus a Render API is cross-site and
cannot use these Strict cookies. `render.yaml` builds the server and requires its
security secrets; it does not provision Supabase, Redis or the proxy topology.

## Delivery and recovery

`DELIVERY_URL` identifies a trusted HTTPS delivery gateway; `DELIVERY_TOKEN` is
its server-only bearer credential. Signup and login do not require a delivery
provider. Recovery and WhatsApp delivery require one. The
gateway accepts JSON with `purpose` and `destination`, plus `code` for
`phone-verification`, `url` for `password-recovery`, or `text` for `whatsapp-reply`.
`credential-change` is a security notification. A 2xx response acknowledges
acceptance. The gateway must authenticate Vendora, redact proofs, apply quotas
and implement the chosen SMS/independent recovery/WhatsApp provider.

Delivery payloads are encrypted in PostgreSQL. Workers claim jobs with expiring
leases and `SKIP LOCKED`. Outbound delivery may be retried; the gateway must
tolerate duplicate notifications. Registration returns the active user immediately,
without sending any OTP. It does not claim existing business records.


Recovery sends only to `recoveryDestination` with `recoveryVerifiedAt`, enrolled
by an operator after independently verifying the channel. There is no phone-only
recovery shortcut. `RECOVERY_ORIGIN` is an exact HTTPS origin. Links carry the
proof in the fragment; the future recovery UI must avoid third-party scripts,
set `Referrer-Policy: no-referrer`, and submit the proof in the POST body. Reset
consumes one digest, changes the password/auth version and revokes sessions in
one transaction, without automatic login. Passwords preserve spaces and Unicode,
accept 6-128 code points, and require no external password screening service.
Benchmark Argon2id and its
concurrency budget on deployment hardware.

## HTTP and ownership

Register with `POST /api/auth/register { "phone": "08012345678", "password": "secret" }`.
It returns `201 { user }`; an existing phone returns `409`. Then call
`POST /api/auth/login` with the same body. Login returns `200 { user }` and sets
HttpOnly access/refresh cookies. Existing pending accounts activate on a successful
password login. Phone verification status remains false unless previously verified.

Use `GET /api/auth/me` to read your identity, `POST /api/auth/refresh {}` to refresh,
and `POST /api/auth/logout {}` to log out. Browser fetch calls need
`credentials: "include"`; Postman needs its cookie jar enabled. No CSRF endpoint,
pre-auth cookie, OTP request or `X-CSRF-Token` header is needed. Mutations accept
JSON, allow API clients without `Origin`, and reject supplied untrusted origins.
The `/logout-all`, `/password/forgot`, `/password/reset`, `/password/change` and
`/reauthenticate` endpoints remain available. Password recovery still requires an
enrolled recovery channel; it does not reset accounts using a phone number alone.

Production cookies use `__Host-`, Secure, HttpOnly, Strict, Path=/, no Domain.
Explicit local `COOKIE_SECURE=false` uses different development names.

Access lasts five minutes, idle sessions 30 minutes, and absolute sessions seven
days. Refresh does not extend idle/absolute expiry. Meaningful private activity
extends idle expiry up to the absolute deadline. Logout can use the refresh cookie after access expiry, and anonymous logout
is idempotent. Concurrent refresh has one winner and
revokes the family on reuse; serialize refresh across requests/tabs. Logout-all requires an active session. Reauthenticate checks the password
and does not grant a second factor. Password change requires the current password
and forces fresh login. Auth/private responses are not cacheable.

`GET /me` returns safe identity and current memberships/permissions. For multiple
memberships supply `X-Business-ID`. Sync accepts only named profile fields; client
phone/role/account substitutions cannot change ownership. Snapshots, channel
entries, evidence files and submission ownership persist transactionally in
PostgreSQL. Listing returns only the business's latest 100 submissions.

After independently checking business ownership evidence, an operator runs:

```sh
npx tsx scripts/provision-business.ts --user-id <uuid> --phone <normalized-phone> --evidence-ref <approved-reference>
```

Optional `--legacy-file` imports the claimed snapshot and ownership for existing
accounts, payment requests and loans. The evidence reference is audited. This is
an offline administrator operation and fails on ownership conflicts. Registration
never invokes it. Existing legacy evidence needs a separately reviewed import
into the new submission table. Staff memberships and recovery channel enrollment
also require an audited administrator workflow.

The verified owner enables WhatsApp with `POST /api/whatsapp/link {}` and
recent authentication. Meta POST authentication verifies `X-Hub-Signature-256`
over the raw body using `WA_APP_SECRET`; GET verification uses `WA_VERIFY_TOKEN`.
Configure both together. Events are durably deduplicated by message ID before
acknowledgment. Workers update the snapshot, create the sync entry, enqueue a
reply and mark the event processed transactionally. Suspended users/inactive
memberships cannot write through the channel. Audio is saved as `voice_pending`
for confirmation; production transcription is not enabled.

Financial data still has a legacy JSON adapter. Account/loan mutations remain
closed pending an independent second factor. Payment creation, financial
scoring/offers and production banking mutations remain closed pending durable
financial services, verified records and transaction-bound step-up. Reads require
durable ownership mappings. Wema's live API/webhook adapter is not implemented;
no unauthenticated banking webhook is mounted. Demo routes are absent in
production and disabled by default locally. An enabled local inbound route still
requires a session, membership and a body containing only `text`.

## Validation and release gates

`npm test` runs HTTP/JWT/password security checks and parser/finance tests.
`npm run test:integration` starts isolated native PostgreSQL, applies the committed
Prisma migration, and checks immediate signup/login, duplicate signup, refresh concurrency/replay,
recovery, cookies, durable business storage, webhook deduplication and runtime
permissions. Alternatively supply a disposable `TEST_DATABASE_URL` whose database
name ends in `_test`. Set `TEST_REDIS_URL` for the shared two-client limiter check.
CI provisions both services. Embedded PostgreSQL retains its generated temporary
directory for diagnosis and stops its process after testing.
The integration command uses Node's `--test-force-exit` after completed tests
because the embedded runner installs shutdown listeners that keep Windows test
workers alive; explicit database/server shutdown still runs in `finally`.

Before release, smoke-test Supabase connection/role/Data API isolation, delivery,
Redis failure behavior and real HTTPS browser cookies; test backup restores and
set up alerts and key rotation. Monitor exhausted/failed delivery jobs. Complete
live frontend cookie validation and financial step-up before enabling those product flows. This
implementation does not deploy, run production migrations, configure providers,
or claim user accounts.

The original OTP/pre-auth tables and session CSRF column remain in the database
for compatibility with existing installations; they are unused by the current
HTTP authentication flow. No database reset is needed for this change.
