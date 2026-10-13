> Historical design plan. The hackathon implementation removes phone OTP, CSRF
> token exchange, external password screening and recent-auth checks for logout-all.
> See [backend-auth.md](backend-auth.md) for the current API and setup.

# Vendora backend authentication plan

Status: proposed design; no application code or dependencies changed.
Scope: Express backend authentication, session management, authorization, and the deployment controls required to make them secure.

## 1. Decisions

- Use TypeScript for the backend auth implementation. Enable `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. TypeScript catches mistakes in user records, session state, and service contracts; runtime schemas still validate every untrusted input.
- Migrate `server/src/app.js` and `server/src/index.js` to typed composition and startup files. Introduce typed auth modules and explicit adapters for existing CommonJS business modules; migrate those modules incrementally. Avoid broad `any` declarations. Keep Express 4 initially and explicitly forward asynchronous errors; an Express major upgrade is a separate change.
- Compile with `tsc` to `server/dist`; start with `node dist/index.js`. Add a development TS runner, type checking, and build scripts. Select a supported Node LTS and align package engines, deployment, and CI; the existing static deployment pins Node 20.
- Use **Prisma ORM with Supabase-hosted PostgreSQL** for database access. Repositories use Prisma Client; Prisma Migrate owns application schema changes. Supabase provides the database; Express owns the authentication/session flows described here. This choice does not add Supabase Auth or a second user/token system.
- Honor the requested JWT design: a short-lived access JWT in an HttpOnly cookie plus a rotating opaque refresh credential in a second HttpOnly cookie. Maintain server-side sessions so logout, account suspension, and permission changes take effect immediately.
- Prefer one public HTTPS origin, with `/api` and `/wema` reverse-proxied to Express. This avoids reliance on third-party cookies. Same-site custom web/API subdomains are an alternative, with exact credentialed CORS. GitHub Pages and a Render API are cross-site: `SameSite=Strict` will not work for that pairing; `None; Secure` still faces browser third-party-cookie restrictions.
- JWTs are a requested design choice, not a security requirement. For this single backend, an opaque server-side session cookie would be simpler and provide the same browser protections. The rest of this plan uses JWTs.

**Transport correction:** cookies still send credentials across the network in HTTP headers. HTTPS protects traffic in transit. HttpOnly prevents JavaScript from reading the credential, but does not prevent an XSS payload from sending authenticated requests. A signed JWT is readable, not encrypted; keep personal and financial information out of its payload. See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [JWT best practices](https://www.rfc-editor.org/rfc/rfc8725.html).

## 2. Existing risks to close

| Existing code | Risk | Required change |
| --- | --- | --- |
| `server/src/app.js`: optional `VENDORA_API_KEY` | No key means endpoints are open; a shared key does not identify an individual trader | Require authenticated sessions on private routes and remove the browser API-key bypass |
| `web/src/lib/config.js`: `VITE_API_KEY` | A value embedded in a browser build is public | Retire it as browser authentication; keep any service credentials server-only |
| `/api/sync`: caller supplies `phone` and arbitrary profile properties | Impersonation and overwriting protected fields | Derive trader identity from the session and explicitly allow profile fields |
| `/api/submissions`: optional phone filter; caller supplies account number | Access to other traders' submissions and false account associations | Always scope queries and writes to verified business ownership |
| `server/src/wema.js`: account, payment, loan identifiers | Knowing an identifier currently gives access under the shared key | Check membership, permission, and resource ownership in business services |
| `/whatsapp/webhook`: acknowledges POST before verifying provenance | Forged messages can mutate records | Verify provider signature using the raw body before parsing or processing |
| `/whatsapp/dev/*` and `/wema/simulate/credit` | Impersonation, message disclosure, and fabricated credits | Do not mount these routes in production; enable explicitly only in local/test environments |
| CORS defaults to `*`; deployment allows `https://*.onrender.com` | Untrusted origins can be allowed | Use exact trusted origins; never a wildcard with credentials |
| `server/src/store.js`: delayed JSON writes, read errors start fresh | No transactional refresh rotation or durable revocation | Store auth and ownership mappings in Supabase Postgres through Prisma; fail startup on database failure |
| Frontend staff PINs and default owner PIN | Local state is not proof of identity or authority | Issue server-side memberships and permissions; never accept client role flags or local PIN state |

The business JSON store can remain behind an adapter temporarily, but financial production release requires durable ownership associations and persistence. Do not automatically grant a newly registered phone number access to an existing trader snapshot. Backfill ownership through an audited claim process with additional proof for financial records.

## 3. Data and credentials

Planning assumption: phone number plus password is the initial login method because Vendora is phone-centered. Verify control of the phone before enabling trader data access. Phone possession alone is not sufficient for high-risk account recovery or bank-account changes; plan an independent recovery/second factor. Delivery-provider selection is an implementation prerequisite.

Define the following Prisma models with mapped table names, unique constraints, foreign keys, and appropriate lookup/expiry indexes. Commit reviewed Prisma SQL migrations and use transactional updates:

| Record | Essential fields |
| --- | --- |
| `users` | Immutable UUID, normalized unique phone, password hash, phone verification time, status, auth version, timestamps |
| `business_memberships` | User UUID, business UUID, server-assigned role/permissions, status; unique membership |
| `sessions` | Random session UUID, user UUID, CSRF binding, authentication time, last activity, idle/absolute expiry, revocation time, MFA level |
| `refresh_tokens` | SHA-256 digest, session UUID, parent/replacement reference, expiry, consumption time; retain consumed digests through their replay-detection window |
| `verification_challenges` | User/destination binding, purpose, keyed OTP digest, attempt count, expiry, consumption time |
| `recovery_tokens` | High-entropy token digest, user UUID, purpose, expiry, consumption time |
| Ownership mappings | Business UUID on trader, bank account, submission, payment request, and loan records |
| `auth_audit_events` | Action, outcome, user/session identifiers where known, timestamp, request ID, limited metadata |

Use asynchronous Argon2id hashing. OWASP's minimum is 19 MiB memory, two iterations, and parallelism one; benchmark on production hardware and bound concurrent hashing work. The configured password policy accepts 8–128 Unicode code points; support spaces and Unicode, reject common/breached passwords, and never truncate or silently trim passwords. Do not require arbitrary composition rules or routine password expiration. See [password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

Store only digests of random refresh and recovery credentials. Short numeric OTPs need a keyed digest with a separate server secret because they have low entropy. Bind challenges to their purpose and destination, expire them quickly, limit attempts, invalidate superseded challenges, and consume atomically. Never use security questions, BVN/NIN values, or the local four-digit staff PIN as login credentials.

### Prisma and Supabase connection/security policy

Database flow: **Express service → repository → Prisma Client → Supabase Postgres**. Prisma connects using a PostgreSQL role/password, not a Supabase publishable or service-role API key. Pin compatible Prisma CLI/client/adapter versions and verify their Node/module requirements before implementation. The proposed config layout follows the documented Prisma 7-style `prisma.config.ts` and `@prisma/adapter-pg` setup; use the selected version's syntax consistently. See [Supabase's Prisma integration](https://supabase.com/docs/guides/database/prisma).

Keep connection configuration separate by purpose:

| Variable | Purpose and connection |
| --- | --- |
| `DATABASE_URL` | Runtime role. For the persistent Express server, use direct Postgres when reachable, or Supavisor **session mode on port 5432** for IPv4-only hosting |
| `DIRECT_URL` | Migration role. Prefer direct Postgres; Supabase's Prisma guide also supports session mode when direct connectivity is unavailable. Never use transaction pooling for migrations |
| `SHADOW_DATABASE_URL` | Separate disposable development database for `migrate dev`; never point it at production or a database containing valuable data |

Copy endpoints/usernames from the Supabase Connect dialog rather than constructing them. If deployment later becomes serverless, evaluate transaction mode on port 6543 and its prepared-statement/session-state restrictions. Bound the driver's pool per process and budget total connections across replicas, jobs, and migrations. See [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

- Create one Prisma Client per backend process, inject it into repositories, and use the PostgreSQL driver adapter. Configure bounded connection/query timeouts and TLS with certificate verification using the provider's CA where required; never disable certificate verification to resolve a connection error. Connect/check readiness before listening and disconnect only on process shutdown, not after each request. See [Prisma connection management](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections).
- Keep auth/application tables in a private `vendora` schema that is not listed in exposed Data API schemas. Grant no access to `anon` or `authenticated`; disable the Data API if the project uses only Prisma. If other features need the Data API, expose only their intended schemas and protect exposed tables with reviewed RLS policies. See [Supabase data security](https://supabase.com/docs/guides/database/secure-data) and [schema exposure](https://supabase.com/docs/guides/api/using-custom-schemas).
- Use separate migration and runtime database roles. The migration role owns managed schema objects; the runtime role receives only required schema usage and table/sequence permissions, with no DDL, `CREATEDB`, superuser, or `BYPASSRLS`. Limit audit-table writes to insertion where practical. Review default grants so newly migrated tables receive the intended permissions. The integration quickstart's broad development role is not the production runtime policy.
- Prisma queries run as the database role; they do not automatically attach the Express user's JWT or populate Supabase `auth.uid()`. Enforce tenant ownership in services and repository query scopes. Any database RLS added for backend access needs an explicit, tested identity-context design and transaction-local context; do not assume Supabase Auth policies protect custom Express sessions.
- Use Prisma `$transaction` with an explicit concurrency strategy for refresh rotation and challenge/recovery redemption: conditional consumption with checked affected-row counts or parameterized row locks. Keep network delivery and password hashing outside short database transactions. Commit replay-triggered session revocation before returning an authentication error so it cannot be rolled back accidentally.
- Use typed Prisma queries and explicit safe field selections; never spread untrusted bodies into Prisma create/update data. Any raw SQL must use parameterized tagged templates, not unsafe interpolation.
- Generate the client during the build. Create migrations only against development using `prisma migrate dev`; review/commit SQL and apply with `prisma migrate deploy` in a single controlled release step. Do not run development migrations, resets, or `db push` in production. Keep Supabase-managed `auth`/`storage` schemas outside Prisma's migration scope. Baseline an existing populated database before introducing migration history.
- Store database URLs only in server/CI secrets, redact them from logs, and keep migration credentials out of runtime deployment. Use separate development/test/production databases and configure appropriate backups with a tested restore process.

## 4. Files and responsibilities

```text
server/
  prisma.config.ts                    # CLI connection, migration and shadow-db configuration
  prisma/
    schema.prisma                     # Models mapped to private vendora schema
    migrations/                       # Reviewed SQL, grants and ownership migration
  src/
    generated/prisma/                 # Generated Prisma Client; regenerate during build
    index.ts                          # Process startup and shutdown
    app.ts                            # Express composition; exports createApp(deps)
    config/
      env.ts                          # Runtime-validated configuration
      cookies.ts                      # Cookie names/options/clearing policy
    db/
      prisma.ts                       # Shared Prisma Client, adapter, pool and lifecycle
    repositories/
      user.repository.ts
      membership.repository.ts
      session.repository.ts
      challenge.repository.ts
    services/
      auth.service.ts
      session.service.ts
      password.service.ts
      token.service.ts
      verification.service.ts
      recovery.service.ts
      authorization.service.ts
      audit.service.ts
    controllers/
      auth.controller.ts
    routes/
      auth.routes.ts
      business.routes.ts              # Protected existing app routes
      webhook.routes.ts               # Provider authentication, separate from browser auth
    middleware/
      authenticate.ts
      authorize.ts
      csrf.ts
      rate-limit.ts
      validate.ts
      error-handler.ts
    schemas/
      auth.schemas.ts
    types/
      auth.ts                         # AuthContext and safe response DTOs
    adapters/                         # Typed wrappers for existing business/provider modules
  test/
    auth.test.ts
    authorization.test.ts
    session.test.ts
```

Request flow: **route → request guards/schema validation → controller → service → repository → Prisma Client → Supabase Postgres**. Services enforce security rules and can be called without Express. Controllers translate HTTP input/output and set cookies; repositories do persistence only and accept a Prisma transaction client when operations must be atomic.

| Component | Responsibility |
| --- | --- |
| `auth.service` | Register pending users, authenticate credentials, enforce account status/verification, return a safe user DTO and session result |
| `password.service` | Hash, verify, benchmark-compatible rehash; use a dummy hash check for unknown users to reduce timing differences |
| `token.service` | Sign/verify access JWTs, require expected algorithm/type/issuer/audience/claims, generate cryptographically random opaque credentials |
| `session.service` | Create sessions, rotate refresh credentials transactionally, detect replay, enforce expiry, revoke one/all sessions |
| `verification.service` | Issue and atomically verify phone challenges; send through a provider adapter with resend limits |
| `recovery.service` | Generic recovery responses, single-use credential redemption, password update and session revocation in one transaction |
| `authorization.service` | Resolve active memberships and permissions; authorize each target resource; require recent authentication/second factor for sensitive actions |
| `audit.service` | Record login failures, replay, recovery, revocation, and permission changes without passwords, tokens, cookies, or KYC data |
| `auth.controller` | Read validated input, call services, set/clear cookies, return safe status/body; never return access/refresh credentials in JSON |
| `auth.routes` | Declare endpoint-specific validation, throttling, CSRF and authentication guards; contain no password or database logic |
| `authenticate` | Verify access JWT and active session/user; attach typed `AuthContext`; reject revoked, suspended, or expired identities |

Dependency candidates: Prisma CLI (`prisma`, development dependency), Prisma Client (`@prisma/client`), PostgreSQL driver adapter (`@prisma/adapter-pg`, `pg`), runtime schemas (`zod`), password hashing (`argon2`), JWT signing/verification (`jose`), headers (`helmet`), cookies (`cookie-parser`), optional cross-origin handling (`cors`), structured logging, and a Redis-backed limiter. Add compatible TypeScript/driver types and environment loading as needed. Select maintained compatible versions and commit the lockfile. Use built-in `crypto` for random tokens/digests; no custom cryptographic primitives. Dependency selection does not replace security review.

## 5. Cookies, JWTs, and session lifecycle

Proposed starting policy, subject to product review: access lifetime five minutes, authenticated session idle timeout 30 minutes, absolute lifetime seven days. Server expiry is authoritative. Background refresh must not extend the session indefinitely or reset idle expiry without meaningful user activity.

```http
Set-Cookie: __Host-vendora-access=<jwt>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300
Set-Cookie: __Host-vendora-refresh=<opaque-random-token>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=<remaining-session-lifetime>
```

No `Domain` attribute. The `__Host-` prefix requires `Secure` and `Path=/`; that path is deliberate for both cookies. Rotate/clear cookies using the same name/path/domain scope. Use local HTTPS to exercise production settings; any plain-HTTP development cookie exception must have a different name and be impossible in production.

JWT claims: `sub` (immutable user ID), `sid` (session ID), `iss`, `aud`, `iat`, `exp`, and `jti`; an explicit access-token type. Use one configured asymmetric algorithm such as RS256, protected signing keys, and controlled key rotation. Resolve `kid` only against a configured key set; never fetch a key from a token-supplied URL. Require all expected claims and reject malformed, unsigned, wrong-algorithm, wrong-type, wrong-issuer/audience, or expired tokens. Do not use JWT role claims as the authoritative permission source. See [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html).

1. Registration creates a pending user; phone verification enables the account. Neither flow gives unverified users access to trader records.
2. Successful login creates a fresh session, replacing any pre-authentication session, and sets both cookies. Return only a safe user response and noncredential CSRF token.
3. Protected requests verify the JWT, load the current session/user, check idle/absolute expiry and current permissions, then scope the requested resource to the business. Initially check database state on every request so revocation has no cache delay.
4. Refresh validates the refresh credential and its session independently of the expired access JWT, including CSRF. Lock the relevant record and atomically consume the old credential and persist its replacement. Commit before setting new cookies. Do not extend absolute expiry.
5. Reusing a consumed refresh credential revokes its session/token family and emits an audit event. Never accept it again merely because the JWT is valid. The client must serialize refresh across requests/tabs; test concurrent calls because strict replay handling can intentionally force re-login.
6. Logout revokes the session and then clears cookies. Logout-all, password recovery, suspension, and suspected compromise invalidate affected sessions immediately. A stolen access JWT then fails the active-session check.
7. If the database or revocation lookup fails, deny private operations with a controlled availability error; never fall back to JWT-only authorization.

## 6. Endpoint contract

All routes below live under `/api/auth`. Apply exact origin checks and CSRF protection to every browser mutation, including login, registration, verification, recovery, refresh, and logout. Auth responses use `Cache-Control: no-store`.

| Method/path | Authentication | Behavior |
| --- | --- | --- |
| `GET /csrf` | Pre-auth or active session binding | Issue bounded, short-lived pre-auth state if needed and return its synchronizer token; for existing auth use the active session binding |
| `POST /register` | Pre-auth CSRF | Validate phone/password; generic `202` response for new/existing accounts; create pending account and enqueue verification where appropriate |
| `POST /verification/request` | Pre-auth CSRF | Generic `202`; strict destination/IP/resend limits |
| `POST /verification/confirm` | Pre-auth CSRF | Consume purpose-bound challenge; verify phone; do not claim legacy trader records automatically |
| `POST /login` | Pre-auth CSRF | Verify credentials/status; `200` and cookies on success; generic `401` on credential/account failures |
| `POST /refresh` | Refresh cookie + bound CSRF | Rotate atomically; `204` and replacement cookies; `401` for invalid/expired/replayed credentials |
| `GET /me` | Access cookie | Return current safe identity and membership/permissions; `401` if unauthenticated |
| `POST /logout` | Session/refresh binding + CSRF | Revoke current session even if access JWT expired; idempotently clear cookies |
| `POST /logout-all` | Access cookie + recent authentication + CSRF | Revoke every session for current user |
| `POST /password/forgot` | Pre-auth CSRF | Generic `202`; deliver only to a verified recovery channel |
| `POST /password/reset` | Single-use recovery proof + pre-auth CSRF | Atomically consume token, update hash, revoke sessions; no automatic login |
| `POST /password/change` | Access cookie + current credential + CSRF | Update hash and revoke sessions; require fresh login |
| `POST /reauthenticate` | Access cookie + CSRF | Recheck credentials/second factor; record short-lived assurance for sensitive actions |

The CSRF endpoint must support access-token expiry by validating an existing refresh/session binding without performing a refresh. Rate-limit anonymous pre-auth state creation and expire unused state. Rotate the pre-auth binding on login and expose the new CSRF token safely. CSRF tokens can be returned in JSON; they are not authentication credentials. Require `X-CSRF-Token` on mutations and compare it against the appropriate server-side binding. Missing/invalid CSRF yields `403`. Require JSON on JSON endpoints and reject unexpected properties. CORS is not an authorization or CSRF mechanism. See [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Recovery needs an independently verified channel and stronger proof for financial access. Use random, purpose-bound, hashed, short-lived, single-use recovery tokens; use fixed configured link origins, redact query strings, and prevent referrer leakage from recovery pages. Notify users of credential/security changes. See [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## 7. Express app and entry file

`app.ts` exports `createApp(deps)` and does not listen or start timers. Compose in this order:

1. Explicit trusted proxy configuration matching actual infrastructure, disable `X-Powered-By`, request IDs, redacted logging, Helmet/security headers, and coarse shared rate limits.
2. Mount provider webhook routes with their own bounded raw-body parser and provider authentication **before** the JSON parser. Verify signatures before mutation; persist/deduplicate events before successful acknowledgment. Browser cookies and CSRF do not authenticate providers. The existing GET verification token does not authenticate POST events. Confirm the live Wema provider's webhook scheme against its official contract during adapter implementation.
3. Configure exact credentialed CORS only if cross-origin browser access is needed. Allow the required methods plus `Content-Type` and `X-CSRF-Token`; set `Vary: Origin`. Reject untrusted origins on browser mutations. Preserve non-browser provider traffic in its separately authenticated routes.
4. Parse cookies; use small JSON limits on auth routes, for example 16 KiB. Keep larger limits only on separately validated submission/upload endpoints, after cheap request guards where practical.
5. Mount auth routes with their endpoint guards. Use a shared limiter for IP and account-based failures and stricter challenge/recovery limits; protect hashing concurrency and delivery-provider quotas. Do not create permanent account-lockout denial of service.
6. Mount private `/api` business routes and user-facing `/wema` routes with required authentication, CSRF for mutations, and server-side authorization. Keep `/health` minimal and public; expose dependency readiness only where appropriate.
7. Add a JSON 404 handler, then a central error handler. Return generic production errors with request IDs; map safe validation/auth errors to `400/401/403/404/429`, suppress stack traces and provider internals, and handle Express 4 async rejection explicitly.

`index.ts`:

- Validate configuration before startup: runtime `DATABASE_URL`, driver TLS/pool limits, Redis limiter store, signing keys, issuer/audience, trusted origins/proxies, provider credentials, cookie policy, and explicit environment. Migration/shadow credentials belong to tooling, not runtime startup requirements.
- Initialize the shared Prisma Client, connect/check database readiness, and refuse startup on missing security configuration. Never use development signing keys or default webhook secrets in production.
- Create app with injected dependencies, listen on configured port, then start managed WhatsApp flush jobs. Ensure jobs are coordinated across instances or owned by a worker.
- On SIGTERM/SIGINT, stop accepting requests, stop jobs, drain connections with a deadline, call Prisma `$disconnect()`, and close Redis/logging resources. Unexpected fatal errors terminate for a supervisor restart.
- Enforce HTTPS at the edge, HSTS for the production domain, restricted backend ingress, secrets outside source control, key rotation, dependency updates, and access-controlled monitoring. See [Express production security](https://expressjs.com/en/advanced/best-practice-security.html).

## 8. Authorization rules for existing functionality

- Derive `userId` and business membership from server state. Use the verified phone associated with that business for legacy WhatsApp lookup; the request's `phone` is never the authority.
- Scope submissions, accounts, credits, payment requests, and loans by the authenticated business. Prefer `404` for inaccessible resource identifiers where existence is sensitive. Reject mismatched supplied identities instead of silently accepting them.
- Owner/staff access comes from backend memberships. Define explicit permissions for sales, submissions, bank access, staff administration, and borrowing; do not infer them from a client `isOwner` flag.
- Require recent authentication and an independent second factor for account changes, staff privilege changes, sensitive export, and loan/disbursement actions. MFA/step-up endpoints and provider support are a prerequisite for enabling these production actions; fail closed until present.
- Recompute financial eligibility from authorized server records; authentication alone does not make caller-supplied scores or a local consent flag trustworthy. Bind high-risk approvals to the exact transaction and record the approval.
- Authenticate WhatsApp provider events, verify the user-to-phone link through a bounded linking flow, deduplicate events, and restrict channel permissions. A signed provider event is not authorization to perform high-risk banking actions.
- Offline local state remains useful for drafts. Replay/sync must reauthenticate and reauthorize each operation; local PINs, cached roles, ledger signatures, and queued payloads do not grant server authority.

## 9. Implementation order and acceptance criteria

1. **Contain exposure and establish typed foundations.** Disable production demo routes, validate configuration, remove permissive browser-key access, fix origins, create TS build/adapters, preserve existing app-factory tests. Choose hosting topology and verified delivery/recovery providers.
2. **Persist identities and ownership.** Configure Supabase environments/roles/private schema and Prisma Client, add Prisma models/migrations/repositories and ownership backfill; test unique registration, permission scope, transactional writes, and startup failure. Verify runtime permissions and migration connectivity separately. Do not deploy private routes before ownership enforcement is ready.
3. **Build services.** Implement password, verification, login, JWT, sessions, rotation/replay handling, and recovery. Test Prisma repositories with a real isolated PostgreSQL database, including concurrent refresh/credential redemption, plus a staging Supabase connection/access-control smoke check.
4. **Connect HTTP.** Add schemas, controllers, routes, cookies, pre-auth/session CSRF, shared throttling, audit redaction, error handling, and lifecycle startup/shutdown.
5. **Protect the whole backend.** Replace API-key-based tests with owner/staff sessions; cover every private app/Wema route and provider webhook. Implement step-up protection before enabling financial mutations.
6. **Verify deployment.** Generate Prisma Client, apply reviewed migrations through the controlled release step, and test browser cookies through the real HTTPS proxy and chosen origin topology; confirm development routes cannot be mounted in production. Verify database TLS/pool budgets and Supabase Data API isolation. Update deployment/build docs and secrets configuration.

Required security tests:

- Anonymous/private access and all cross-user/business identifier substitutions fail, including sync/submissions and Wema account/payment/loan routes.
- Modified, expired, unsigned, wrong-algorithm/type/issuer/audience JWTs fail; disabled users and revoked sessions fail immediately despite otherwise valid JWTs.
- Correct cookie flags, no browser-readable auth credentials, no access/refresh token in response bodies/logs, and correct cookie clearing.
- Missing/wrong CSRF and malicious Origin fail on login, refresh, logout, recovery, and business mutations; permitted browser preflight works. Refresh/logout still work safely when access JWT has expired.
- Refresh rotation, replay detection, two concurrent refreshes, absolute/idle expiry, logout-all, and password recovery cannot retain unauthorized access.
- Challenge brute force/resends, replay, purpose substitution, expired proofs, generic account-discovery responses, and shared rate limits across two server instances.
- Forged webhook payloads cannot mutate state; duplicate valid events apply once; production demo routes return `404`.
- Database/limiter/security-config failure denies affected operations; no JWT-only or shared-key fallback.
- Prisma migrations reproduce the application schema on an isolated database; runtime role cannot alter schema or access Supabase-managed schemas; auth tables are inaccessible through the Data API; shutdown releases connections and replicas stay within the connection budget.

Backend delivery is complete when these controls and tests pass. End-to-end login remains a later frontend integration: credentialed requests when cross-origin, CSRF header handling, serialized refresh across tabs, safe offline-account separation, and no auth credentials in local/session storage or service-worker caches. The current browser API-key client will need that integration before it can call the secured backend.
