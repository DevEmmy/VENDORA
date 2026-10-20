# Live multilingual inventory voice extension

Implemented against the existing React/Vite JSX frontend, Express TypeScript backend,
Prisma and PostgreSQL on 18 October 2026. The repository is not a Next.js app; no
framework replacement was introduced. Existing uncommitted work was retained.

## Architecture and safety

The browser captures a microphone through an AudioWorklet, mixes channels and
resamples to 16 kHz mono signed PCM16 little-endian. It posts 250 ms chunks through
the authenticated API client while reading a persistent fetch/SSE response. The
Express relay owns the persistent YarnGPT WebSocket, including its secret header.
The browser never receives that credential. The older recording/upload and manual
entry paths remain available.

The upstream protocol was checked against the provider's
[Live ASR documentation](https://yarngpt.ai/api-docs): `/api/v1/asr/stream`, `start`,
binary PCM, `partial`, `final`, `finalize` and `done`. Partials are provisional UI
captions. Only a new numbered final segment enters the serialized command queue.
Chunks have sequence numbers and duplicate-final segments are ignored. Short
utterances flush the worklet's remaining PCM before finalization.

The existing LLM first extracts Zod-validated intent without inventory context.
Each extracted product phrase queries at most 30 tenant-owned products, using the
existing pg_trgm extension and new expression indexes. Exact names and approved
aliases rank before fuzzy results. Matching retains Unicode, sizes, and decimal
size attributes. An ambiguous single-item result may ask the LLM for a suggestion
from three real candidates; schema and membership checks reject invented IDs.
Such suggestions still require the user to select and review the product.

Resolved changes produce the existing confirmation card. The live controller
accepts explicit “yes”/“confirm” or “no”/“cancel” only against the pending action
that was active when that utterance arrived. Premature confirmation cannot approve
a still-processing command. New commands during review request confirmation or
cancellation first. Clarification cards require a button review. A button-confirmed
or rejected action cannot later be spoken-confirmed again.

Pending proposals include `expires_at` and expire after five minutes by default.
The backend rechecks expiration, creator identity, business membership, permissions,
product ownership, quantities and units inside the existing locked transaction.
Stock movements, alerts, sync changes, optional explicitly approved aliases, and
the idempotent confirmation receipt commit together. Existing explicit negative
stock override rules are retained; speech confirmation never sets that override.
An already-committed receipt remains replayable after proposal expiration.

Stock queries use `check_stock` and finish as `completed`; they cannot be converted
to a mutation through the confirmation endpoint. Multi-item mutations retain the
existing all-or-nothing grouped transaction. Mixed actions must be clarified.
Canonical conversion supports a dozen to 12 pieces; arbitrary pack/carton/bag
conversion ratios are never inferred. Voice sales continue to write the existing
stock movement ledger, without creating priced checkout/payment records.

The UI displays state, partial/final transcripts, review cards, errors and committed
balances. Review cards are automatically scrolled into view and focused, including
after clip uploads; result and error messages are also brought into view. The
keyless mock UI uses device speech when available rather than the silent backend
audio fixture. Readback and device speech use the existing output abstraction, run
outside the stock transaction, and can be interrupted by subsequent speech.
Connection errors release tracks, audio contexts and streams. “Reconnect microphone”
starts a fresh provider stream and retains the displayed pending ID. Interrupted
audio is not replayed automatically; repeat that utterance and check history if a
response was lost.

## Files and migration

New files:

- `server/src/voice/live.ts`: provider interface, YarnGPT adapter, mock, session queue and confirmation handling.
- `server/src/voice/metrics.ts`: bounded stage distributions.
- `server/prisma/migrations/202610180001_voice_live/migration.sql`: completed query status, name/alias search indexes and immutable alias-key function. No additional table.
- `server/test/voice-live.test.ts`: transport, duplicate events, authorization, confirmation and local WebSocket tests.
- `server/eval/verified-languages.json`: attributed Yoruba/Igbo source examples with adaptation notes.
- `web/public/voice-pcm-worklet.js`: resampling and PCM framing, including final-buffer flush.
- `web/src/features/voice/{live.js,LiveRecorder.jsx,metrics.js}`: authenticated live client, UI and browser timing.
- `web/test/voice-live.test.js`: resampling continuity and fragmented Unicode SSE tests.

Modified files:

- `server/src/{app.ts,routes/voice.routes.ts}`: authenticated relay routes, optional streaming-provider injection and dedicated audio rate limits.
- `server/src/{config/voice.ts,voice/parser.ts,voice/service.ts}`: multilingual extraction, indexed candidates, queries, conversion, scoped confirmation, expiry and approved aliases.
- `server/{package.json,package-lock.json,.env.example}`: `ws`, its types and settings.
- `server/test/{voice-parser.test.ts,voice-providers.test.ts,integration/voice-api.test.ts,browser/voice.spec.ts}`: expanded regression coverage; adapter assertions retain the existing reasoning-model temperature behavior.
- `web/src/{lib/api/client.js,features/voice/VoiceWorkspace.jsx,features/voice/recorder.js}`: streaming responses, UI integration, receipt feedback and interruptible output.
- `eslint.config.mjs`, `docs/voice.md`, and this document.

The earlier uncommitted voice migration remains required. Run the normal
`npm run db:deploy` with the migration credential after reviewing both migrations.
Only disposable test databases were migrated during this implementation.

## API additions and changes

Every route uses existing session cookies, business authorization and `sales:write`.
POST requests retain trusted-Origin and JSON enforcement.

| Method and path | Contract |
| --- | --- |
| POST `/api/voice/streams` | `{pending_action_id?: UUID\|null}` → `{stream_id}`; optional pending ID must belong to the current user/business |
| GET `/api/voice/streams/:id/events` | Authenticated fetch/SSE: started, partial, final, state, command, receipt, feedback, cancelled, done, error |
| POST `/api/voice/streams/:id/audio` | `{sequence,pcm}` where PCM is base64 mono PCM16LE at 16 kHz; `{accepted:true}` acknowledgement |
| POST `/api/voice/streams/:id/finalize` | `{}`; drains final ASR and command events; `{accepted:true}` |
| GET `/api/voice/latency` | Authenticated process-wide stage counts, median and p95, with no transcript/product/user data |
| GET `/api/voice/config` | Adds `live` and `pending_ttl_ms` |
| POST `/api/voice/commands/:id/confirm` | Adds optional `learn_alias`; alias is learned only during explicit committed confirmation |

Command JSON adds `expires_at`. The existing upload, manual entry, history,
confirmation and rejection endpoints are preserved.

## Configuration and local use

Keep existing PostgreSQL, Redis, auth and cookie settings from `backend-auth.md`.
Only server environment variables contain provider credentials:

```dotenv
VOICE_MOCK_MODE=false
VOICE_STREAM_PROVIDER=yarngpt
VOICE_PENDING_TTL_MS=300000
YARNGPT_API_KEY=<server-only-key>
YARNGPT_BASE_URL=https://api.yarngpt.ai
YARNGPT_TTS_VOICE=<optional-catalog-voice-id>
LLM_PROVIDER=anthropic
LLM_API_KEY=<server-only-key>
LLM_MODEL=<model-supported-by-your-account>
LLM_BASE_URL=<optional-provider-api-root>
VOICE_ASR_TIMEOUT_MS=15000
VOICE_LLM_TIMEOUT_MS=10000
```

`VOICE_STREAM_PROVIDER=disabled` retains upload/manual entry. `VOICE_MOCK_MODE=true`
uses local mocks and sends no paid provider calls. The live mock returns its canned
rice transcript when Stop is clicked. It does not recognize real microphone speech.
For an existing seeded project, run `npm run dev` in server and web. For a fresh
keyless demo, run `npm run voice:demo` in server as described in `voice.md`.
To try the Coaster example in that demo, first add **Coaster Biscuit**, unit
**pack**, opening stock **30**, in Stock. The demo typed transcript
`I don sell five packs of Coastal biscuit` then produces a review card; confirming
leaves 25 packs. Live mock microphone input intentionally remains the canned rice
utterance, so this does not demonstrate real speech recognition.

Serve the worklet over HTTPS or localhost, disable reverse-proxy buffering on the
SSE route, and allow at least five-minute response timeouts. Stream handles live
in process memory: route a session's requests to the same instance, or supply a
shared relay before scaling. Sessions are capped at 64/process, two/user, and five
minutes. The browser stops its stream at four minutes. No microphone audio is
persisted by the relay.

The live provider interface is injectable via `AppDependencies.voiceStream`;
alternate provider adapters can be evaluated without modifying inventory logic.
The existing speech-to-text and text-to-speech interfaces also remain injectable.
Query YarnGPT's documented `GET /api/v1/asr/languages` using server credentials before
claiming language coverage. No supported-language list is hardcoded. Translation
is not requested, which avoids rewriting product names. English/Pidgin/Yoruba/Igbo
and mixed-language interpretation are requested in the LLM prompt; actual ASR and
model quality still require real recordings and native-speaker evaluation.

## Verification and observability

From server (use `npm.cmd`/`npx.cmd` on Windows where PowerShell blocks npm.ps1):

```text
npm run typecheck
npm test
npm run test:voice
node node_modules/tsx/dist/cli.mjs --test --test-force-exit test/integration/voice-api.test.ts
npm run lint
npm run build
npm --prefix ../web test
npm --prefix ../web run build
npx playwright test test/browser/voice.spec.ts
npm run voice:eval
```

The PostgreSQL suite covers read-only processing, concurrent repeated confirmation,
transaction rollback, insufficient stock/explicit override, unauthorized access,
Coastal/Coaster, approved and mixed-case aliases, expiration, read-only queries,
SSE relay and spoken confirmation/cancellation against the actual database.
Unit tests cover malformed model output, missing/ambiguous products, Pidgin,
quantities, units, duplicate final/audio events, premature/repeated confirmation,
PCM conversion, Unicode events and the documented upstream WebSocket messages.
The browser test uses a synthetic microphone with a real AudioWorklet and database,
while substituting mock ASR/TTS.

Verified results on 18 October 2026:

| Check | Result |
| --- | --- |
| Complete server unit suite | 77 passed, including 27 voice tests |
| Frontend unit suite | 42 passed |
| Voice PostgreSQL integration suite | 14 passed, including suite wrapper |
| Chromium voice workflow | 1 passed: stock query, review, confirmation, cancellation, upload and live PCM/SSE |
| Existing keyless evaluator | 25/25 fixtures; no live language-quality claim |
| Typecheck, lint, server build, frontend build, whitespace check | Passed |

The frontend retains its existing bundle-size advisory. The full unrelated
PostgreSQL/browser suites were not rerun; the voice integration/browser suites and
complete unit suites were run. No paid provider calls were made.

The attributed language fixture test stubs the LLM: it verifies Unicode input,
schema validation and product resolution, not the model's translation accuracy.
The Yoruba phrase is from [Okewande, example 25(b)](https://revue-sinzang.net/wp-content/uploads/journal/published_paper/volume-1/issue-1/mgZsK2Ay.pdf).
The Igbo example adapts the teaching orthography of [Welmers & Welmers, printed page 42](https://files.eric.ed.gov/fulltext/ED233567.pdf).
The code-switch case is authored from the sourced Yoruba example and labelled as
such in the test. Contemporary market phrasing needs native-speaker review.

Server telemetry retains 512 samples/stage for intent extraction, product matching,
confirmation readiness, database execution, speech synthesis and estimated final
detection lag. Final detection uses provider end time against server audio arrival,
so transport jitter affects it. Browser telemetry separately records capture to
first partial/final transcript and actual audio/device-speech start. Import
`voiceLatencySummary` from `web/src/features/voice/metrics.js` in development to
inspect browser summaries. Neither distribution is durable or a latency guarantee.

Real paid YarnGPT/LLM calls, real Nigerian-language microphone recordings, Safari
and multi-instance routing were not verified. Reconnection is user initiated and
does not recover an unfinished segment. TTS remains the existing streamed-response
download/readback fallback rather than a new incremental audio player. Full billing,
priced sales and arbitrary unit ratios remain outside this inventory extension.
