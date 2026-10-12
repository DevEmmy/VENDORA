# Vendora MVP: Wema Hackaholics 7.0 (Confidential)

Voice-first business assistant for Nigerian traders, built on Wema Bank / ALAT.

```
vendora/
├── web/      ← The app (web version). Works on any phone or laptop browser, even offline.
├── server/   ← Vendora server: WhatsApp channel + Wema/ALAT connection + app sync.
└── app/      ← Flutter version (started, paused). Will become the Play Store app later.
```

---

## 1. Quickest way to see the app (no setup)

Open **`Vendora.html`** in Chrome (phone or laptop). Tap **"Explore a sample shop"**, or **"Set up my shop"** to start empty.

Everything runs on the phone: the bank is simulated, and data is saved in the browser.

> **Voice needs the app to be opened from an `https://` web address** (or `http://localhost`). Phones block the microphone for files opened from storage, WhatsApp or a file viewer. Host the `web/dist` folder on any HTTPS host (Netlify, Vercel, GitHub Pages, Firebase Hosting) and open that link in **Chrome**. Typing and tapping work everywhere.

## 2. Run the web app for development

Needs Node.js 20+.

```bash
cd web
npm install
npm run dev          # open the address it prints, e.g. http://localhost:5173
npm run build        # production build in web/dist (installable app, works offline)
npm run build:single # one-file version in web/dist-single/index.html
```

To open it on your phone during development, connect the phone to the same Wi-Fi and open the "Network" address `npm run dev` prints.

## 3. Run the server (WhatsApp + Wema connection)

```bash
cd server
npm install
npm test                                   # 24 tests: parser, Wema, loans, WhatsApp, sync, seals, submissions
VENDORA_API_KEY=choose-a-key npm start     # http://localhost:8080
```

Then build the app pointing at it (traders never see these settings):

```bash
cd web
VITE_SERVER_URL=https://your-server.example VITE_API_KEY=choose-a-key npm run build
```

Without `VITE_SERVER_URL`, the app runs fully on the phone with Wema simulated.

| Setting (environment variable) | What it does |
|---|---|
| `PORT` | Server port (default 8080) |
| `VENDORA_API_KEY` | Key the app must send. Leave empty only for local testing |
| `DATA_FILE` | Where data is saved (default `server/data/db.json`) |
| `WA_TOKEN`, `WA_PHONE_NUMBER_ID` | Meta WhatsApp Cloud API credentials. Without them, replies are kept in a dev outbox |
| `WA_VERIFY_TOKEN` | Token Meta uses to verify the webhook (`/whatsapp/webhook`) |
| `WA_BATCH_SIZE`, `WA_BATCH_WINDOW_MS` | Grouped confirmations: reply once per 5 entries or every 15 min (keeps WhatsApp cost low) |
| `STT_URL`, `STT_API_KEY`, `STT_MODEL` | Speech-to-text service for WhatsApp voice notes (OpenAI-compatible `/audio/transcriptions`) |
| `CORS_ORIGINS` | Comma-separated web origins allowed to call the server (default: all) |

**Testing WhatsApp without Meta:** `POST /whatsapp/dev/inbound {"phone":"0803...","text":"I sold 2 bags rice"}`, then see replies at `GET /whatsapp/dev/outbox?phone=0803...`. In the app, **WhatsApp** screen sends test messages through the server automatically.

## What works in this MVP

| Feature | Where in the app | Status |
|---|---|---|
| Talk orb in the middle of the menu: record sales, stock and debts by voice or text, ask questions, undo | Talk | ✅ |
| Tap-to-sell till: tap items, Cash / Transfer / Owe me / Part pay, WhatsApp receipt | Sell | ✅ |
| Restock without typing: + / − steppers and one Save; add items from a common-items list | Stock | ✅ |
| **Vendors Hub**: verified bulk sellers (Wema account, CAC, delivery record), price comparison, order, confirm delivery | Stock → Vendors Hub | ✅ sample sellers |
| **Wema Restock Loan**: limit from Business Score, Wema pays the seller, daily auto-repayment | Home tile, Wallet → Loans | ✅ simulated |
| Debts: who owes, record payments with one tap, WhatsApp reminders | Home tile, Wallet → Debts | ✅ |
| Collect transfer: one-time Wema account + QR, sale confirms itself | Home tile, Sell | ✅ simulated |
| **Check a receipt**: scan (camera / screenshot, read on the phone) or type, verified with Wema; a receipt can only be used once | Home tile | ✅ |
| **Secured records**: sealed chain, phone signature, clock check, cancellations kept visible, proof level per sale, CSV statement | Home "Records secured" | ✅ |
| Business Score with the quickest way to improve | Home, Wallet | ✅ |
| Savings, shop assistants with PINs, WhatsApp channel, Premium | Wallet, Profile | ✅ |
| **Vendors Hub tab** with working search (items, sellers, markets), featured shops, directions to each seller | Hub (bottom menu) | ✅ |
| **Shop adverts**: photos (camera or gallery) and a video up to 60 s, headline, prices, go-live checklist | Hub → Advertise your shop | ✅ stored on the phone |
| **Invoices**: every sale gets a number (INV-00001), share on WhatsApp, print or save as PDF | Home → Invoices, after each sale | ✅ |
| **Send records to Wema**: Excel file with invoices, items, money in, deliveries, debts, loans and the sealed record; fingerprint saved so it can't be changed after sending | Home → Send records to Wema | ✅ |
| **Permissions screen**: Allow microphone, test sound, precise shop location (GPS), camera | Onboarding step 2, Profile → Permissions | ✅ |
| **CAC through Wema**: plain explanation of why, save a small amount daily, one short form when complete, status tracking, CAC badge on adverts and invoices | Home → Get CAC | ✅ simulated filing |
| Works offline, syncs with the server when online | everywhere | ✅ |

### How sales data is protected from lying

- Every sale, restock, payment and correction is **appended** to a sealed chain (each entry carries the SHA-256 fingerprint of the one before). Changing or deleting any old record breaks the seal; the app shows "Records need attention", caps the score at 25 and pauses loans.
- Entries are **signed on the phone** with a key that cannot be copied out (WebCrypto, non-extractable).
- Mistakes are **cancelled, never deleted**; the cancellation is visible to the owner and to Wema.
- Each sale carries its **proof level**: confirmed by Wema, receipt checked with Wema, verified seller delivery, recorded live (voice, till, WhatsApp), or typed. Only money or goods that actually moved count as "confirmed", and that share feeds the score.
- A receipt (same reference or same picture) can only be used once. Failed receipt checks are recorded.
- Backdating is flagged. The server keeps the latest seal on each sync, so the history on the phone can be checked against it.

### Going live with Wema

`server/src/wema.js` simulates Wema today. Once Wema grants API access, replace the inside of these functions with the real calls; the app does not change:
`openAccount`, `createPaymentRequest` (virtual accounts), credit notifications (`receiveCredit` becomes Wema's webhook), `verifyTransfer`, `offer`, `takeLoan`, `repay`.

### Known limits (be ready for judges' questions)

- Yoruba, Igbo and Hausa **replies** were written without a native-speaker review. Get them checked before the pitch.
- Browser voice recognition for Yoruba/Igbo/Hausa depends on the phone. If a language isn't available, Vendora falls back to Nigerian English, and typing always works.
- The parser is rule-based (fast, works offline). Real market recordings from the pilot should be used to extend its vocabulary.
- Premium payments and real insurance are not connected yet.
- CAC filing is simulated. In production Wema files through CAC's registration service; the ₦25,000 target is an estimate and should be confirmed with Wema and CAC before the pitch.
- Advert photos and videos are kept on the phone (IndexedDB). In production they upload to the server with the advert.
- Precise location, microphone and camera only work when the app is opened from an https link.

## Tests

```bash
cd server && npm test                      # 24 unit/integration tests
cd web && npm run build && npx vite preview --port 4173
python3 web/test/e2e.py                    # full browser walkthrough (needs Playwright), screenshots in web/test/shots
```
