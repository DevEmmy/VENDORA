# Put Vendora (website + server) on Render

Login uses strict cookies, so the website and the server must share **one web address**:
the Render website forwards `/api`, `/wema` and `/whatsapp` to the Render server.
You need three free services: **Supabase** (database), **Render Key Value** (Redis) and **Render** (website + server).
Use the **same region** everywhere (this guide uses Frankfurt / Central EU).

## 1. Make the secrets (on your computer, 1 minute)
In the `server` folder: `npm ci` then `npm run secrets`.
Keep the output somewhere private. You get `AUTH_KEY_ID`, `AUTH_PRIVATE_KEY`, `AUTH_PUBLIC_KEY`,
`DELIVERY_ENCRYPTION_KEY` and a `RUNTIME_DB_PASSWORD`. Never commit or share these.

## 2. Database: Supabase
1. supabase.com → **New project**. Name `vendora`, choose a strong database password (save it), region **Central EU (Frankfurt)**.
2. Top bar **Connect** → **Session pooler** (port **5432**, not 6543). Copy the URI, e.g.
   `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with your password and add `?sslmode=require` at the end. This is **DIRECT_URL** (used only for migrations).
4. Make **DATABASE_URL** from the same address, with two changes: user `postgres.abcd1234` becomes `vendora_app.abcd1234`,
   and the password becomes your `RUNTIME_DB_PASSWORD`. No `?sslmode` on this one:
   `postgresql://vendora_app.abcd1234:RUNTIME_DB_PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
5. Project Settings → **Data API** → turn it off (Vendora doesn't use it).

## 3. Redis: Render Key Value
render.com → **New → Key Value** → name `vendora-redis`, region **Frankfurt**, plan **Free** → Create.
Copy the **Internal Key Value URL** (`redis://red-…:6379`). This is **REDIS_URL**.

## 4. Website + server: Render Blueprint
1. render.com → **New → Blueprint** → repo **DevEmmy/VENDORA**, branch `main`, path empty → it reads `render.yaml`.
2. Fill the values it asks for:

| Key | Value |
|---|---|
| DATABASE_URL | from step 2.4 |
| DIRECT_URL | from step 2.3 |
| REDIS_URL | from step 3 |
| AUTH_PRIVATE_KEY, AUTH_PUBLIC_KEY, AUTH_KEY_ID, DELIVERY_ENCRYPTION_KEY | from step 1 |
| AUTH_ISSUER, CORS_ORIGINS, PUBLIC_API_ORIGIN | `https://vendora-app.onrender.com` for now (fixed in step 6) |
| YARNGPT_API_KEY | your YarnGPT key (optional) |

3. Press **Apply**. The server build also creates the database tables. Its first start will fail with a database error. That's expected until step 5.

## 5. Give the server its database login (Supabase)
Supabase → **SQL Editor** → New query. Paste the whole of `server/prisma/runtime-grants.sql`, then add these two lines
(use your `RUNTIME_DB_PASSWORD`) and press **Run**:
```sql
create role vendora_app login password 'RUNTIME_DB_PASSWORD';
grant vendora_runtime to vendora_app;
```
Re-run `runtime-grants.sql` (only that file) whenever new migrations add tables.

## 6. Connect the website to the server (Render)
1. Open **vendora-server** and copy its address (e.g. `https://vendora-server-ab12.onrender.com`).
2. Open **vendora-app** and copy its address (e.g. `https://vendora-app-cd34.onrender.com`). This is **your Vendora link**.
3. vendora-app → **Redirects/Rewrites** → add three rules, Action **Rewrite**:

| Source | Destination |
|---|---|
| `/api/*` | `https://vendora-server-ab12.onrender.com/api/*` |
| `/wema/*` | `https://vendora-server-ab12.onrender.com/wema/*` |
| `/whatsapp/*` | `https://vendora-server-ab12.onrender.com/whatsapp/*` |

4. vendora-server → **Environment** → set `AUTH_ISSUER`, `CORS_ORIGINS` and `PUBLIC_API_ORIGIN` to the **vendora-app** address
   (exact, `https://`, no slash at the end) → **Save, rebuild and deploy**.

## 7. Check it
1. `https://vendora-server-ab12.onrender.com/health` shows `{"ok":true}` (the free server sleeps; the first visit can take a minute).
2. Open the vendora-app link → **Create account** → sign up → you land in your shop. Refresh: you stay signed in.
3. If sign-up says the origin isn't trusted, or you're signed out after refreshing, the rewrite isn't passing the login
   cookies or the `Origin` header through. The fallback is for the server to serve the website itself (one service), which needs a small code change.

The GitHub Pages copy (https://devemmy.github.io/VENDORA/) keeps working on the phone only, with no sign-in.

Free-plan notes: the Render server sleeps after 15 minutes idle, so open the `/health` link before a demo.
Supabase pauses a free project after a week without activity; press **Restore** in Supabase if that happens.
