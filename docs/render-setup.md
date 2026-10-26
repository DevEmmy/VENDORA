# Put Vendora on Render (short version)

One Render service is both the website and the server, so login works with no extra wiring.
Render also creates the Redis for you. The only outside service is a free Supabase database.

## 1. Database link (Supabase, 3 minutes)
1. supabase.com → **New project** → name `vendora`, pick a database password (save it), region **West US (Oregon)**.
2. **Connect** (top bar) → **Session pooler** → copy the link. Put your password in place of `[YOUR-PASSWORD]`.
   It looks like `postgresql://postgres.abcd1234:PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres`.

## 2. Secrets file
Run `npm run secrets` in `server/` (or use the `vendora-render.env` file you were given).
Put the Supabase link on the `DATABASE_URL` line. Never commit or share this file.

## 3. Render
1. Render → the **VENDORA** Blueprint → **Manual sync** (or New → Blueprint → repo DevEmmy/VENDORA). Approve the changes.
2. **vendora-server** → **Environment** → **Add from .env** → paste the whole file → **Save, rebuild and deploy**.
3. Open the vendora-server link. That is the app. Create an account to check it.

The old **vendora-app** static site is no longer used; you can delete it.
The free server sleeps after 15 idle minutes, so open the link a minute before a demo.
Supabase pauses free projects after a week without use; press **Restore** there if that happens.

Settings filled automatically: Redis address, and `AUTH_ISSUER`, `CORS_ORIGINS`, `PUBLIC_API_ORIGIN`
(the service's own address). Set them by hand only if you put Vendora on a custom domain.
