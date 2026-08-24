# Wedding & Engagement RSVP

See `plan.md` and `design.md` for the app's history and design. This README covers
setting up and deploying the backend (Cloudflare Pages + D1 + a Gmail-based email
relay) — see the plan file used to build it at implementation time for the full
architecture rationale.

## One-time setup

1. **Cloudflare**
   ```
   npx wrangler login
   npx wrangler d1 create wedding-rsvp
   ```
   Copy the `database_id` it prints into `wrangler.toml`.

   ```
   npx wrangler pages project create wedding-rsvp
   ```

2. **Database schema**
   ```
   npm run db:migrate:remote   # applies schema.sql to the real D1 database
   npm run db:migrate:local    # applies it to the local dev D1 (for `wrangler pages dev`)
   ```

3. **Email relay (Google Apps Script)**
   - Go to [script.google.com](https://script.google.com), create a new project under
     the Gmail account you want RSVP emails to come from.
   - Paste the contents of `apps-script/Code.gs` in as `Code.gs`.
   - Replace `SHARED_SECRET` with a long random string (e.g. `openssl rand -hex 32`).
   - Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access
     **Anyone** → Deploy. Copy the `/exec` URL it gives you.

4. **Secrets** — set these for the deployed Pages project:
   ```
   npx wrangler pages secret put ADMIN_PASSWORD
   npx wrangler pages secret put ADMIN_NOTIFY_EMAIL      # where "someone RSVP'd" alerts go
   npx wrangler pages secret put EMAIL_WEBAPP_URL         # the Apps Script /exec URL
   npx wrangler pages secret put EMAIL_SHARED_SECRET      # must match SHARED_SECRET in Code.gs
   ```
   For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the
   same values (this file is gitignored).

5. Once deployed (step below), set `CONFIG.siteBaseUrl` in `src/App.jsx` to the
   real `https://your-project.pages.dev` URL so generated QR codes/invite links
   point to the right place, then redeploy.

## Local development

```
npm install
npm run pages:dev     # builds + runs the full stack (frontend + /api + D1) at http://127.0.0.1:8788
```

(`npm run dev` alone runs just the Vite dev server and proxies `/api` to a
`wrangler pages dev` instance on port 8788 — handy for fast frontend iteration
while a `wrangler pages dev` is running in another terminal.)

## Deploy

```
npm run pages:deploy
```

This builds the frontend (`vite build` → `dist/`) and uploads it, along with
`functions/`, via `wrangler pages deploy`.

## Notes

- Admin dashboard: the small "Admin" link bottom-right of the guest-facing pages.
  The password is checked server-side (`functions/api/admin.js`) — it is never
  shipped in the client bundle.
- Emails (guest confirmation, admin notify-on-RSVP, admin broadcast updates) send
  via the Gmail account behind the Apps Script deployment. Free quota is 100
  emails/day on a personal Gmail account.
