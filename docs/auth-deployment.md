# Cookie deployment and account hardening

Deploy the frontend and API on HTTPS under the same site. Cookies remain
HttpOnly, SameSite=Strict, Secure, host-only and Path=/; production names use
the __Host- prefix. Do not add a broad cookie Domain to share credentials.

Recommended: serve the frontend at https://shop.example.com and proxy /api,
/wema and /whatsapp to Express. Leave VITE_SERVER_URL empty, set CORS_ORIGINS
and PUBLIC_API_ORIGIN to https://shop.example.com, and COOKIE_SECURE=true.
Vite already supplies the local development proxy; production hosting must
supply its own proxy. Do not expose signing or delivery credentials to Vite.

Alternatively, app.example.com can call api.example.com: build with
VITE_SERVER_URL=https://api.example.com, set CORS_ORIGINS=https://app.example.com,
PUBLIC_API_ORIGIN=https://api.example.com and COOKIE_SITE_DOMAIN=example.com.
The last setting declares the operator-verified registrable parent for startup
diagnostics; it does not set a cookie Domain or replace public-suffix validation
by your deployment operator. Schemes must match. Unrelated hosting domains
(for example a pages host and an API host under different sites) do not work
with this cookie policy. Startup prints warnings for an unverified or
incompatible topology. CORS permission alone cannot make cross-site Strict
cookies work.

Cookie-authenticated JSON mutations require a trusted Origin, or absent Origin
with Sec-Fetch-Site=same-origin/same-site. An explicit untrusted/null Origin
always fails, even with a same-site header. Non-browser test clients carrying
cookies must send the configured Origin. Anonymous requests still use JSON and
reject supplied untrusted origins; anonymous idempotent logout is preserved.

Redis limits already covered these routes; verification did not find a missing
refresh limiter. Every auth route has 60 requests/minute/IP, including refresh.
Login additionally has 10/15 minutes/account, registration 5/15 minutes/account,
recovery requests 3/15 minutes/account and reset attempts 5/15 minutes/IP.
Limiter unavailability fails closed. Shared Redis integration remains an
optional environment-dependent test; route-exhaustion tests run without Redis.

New registration, password change and reset require 8–128 Unicode characters
and reject a local common-password denylist. Existing short credentials still
log in. Password change verifies the current password, rotates authVersion and
revokes all sessions. Profile exposes the change-password screen; sign-in
exposes recovery instructions and a generic recovery request. Recovery requires
a previously verified destination. Enrollment/email verification and a hosted
reset-token form remain follow-up work; RECOVERY_ORIGIN must point at a separately
implemented reset page if recovery delivery is enabled. Signup does not verify
the submitted phone number.

Staff PINs are a convenience lock, not backend identities or authorization.
They use PBKDF2-SHA256 (210,000 iterations, 32-byte random device salt) through
WebCrypto. Account activation and staff-screen access migrate legacy plaintext
PINs; new demo/setup records have no default persisted PIN. Owner setup is
required before adding assistants. Every API write uses the actual account ID;
recordedBy labels are untrusted metadata. Backend staff membership provisioning
and quick sign-in as separate identities are not implemented by this milestone.

## Browser smoke script

Use a disposable account with no important pending work. The script launches
headless Chromium, signs in through the configured frontend, checks /me,
private headers and browser cookie attributes, then logs out. It prints no
phone number, password or cookie values. Install Playwright Chromium during
tooling setup if absent.

PowerShell, from server:

```powershell
$env:SMOKE_FRONTEND_ORIGIN = 'https://shop.example.com'
$env:PUBLIC_API_ORIGIN = 'https://shop.example.com'
$env:SMOKE_PHONE = '<disposable account phone>'
$env:SMOKE_PASSWORD = '<account password>'
npm run smoke:cookies
```

Bash:

```bash
export SMOKE_FRONTEND_ORIGIN=https://shop.example.com
export PUBLIC_API_ORIGIN=https://shop.example.com
export SMOKE_PHONE='<disposable account phone>'
export SMOKE_PASSWORD='<account password>'
npm run smoke:cookies
```

The automated browser suite runs this function against the disposable local
test server. Live HTTPS, ingress/proxy behavior and real delivery are operator
deployment checks; no production deployment is performed by the tests.
