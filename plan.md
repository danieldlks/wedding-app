# Wedding & Engagement RSVP — Project Plan

## 1. Original Request

Build a web application for guests to personally RSVP to an engagement party and a
wedding invitation. Requirements:

- Must be user-friendly on **desktop** and on **mobile phones** (both Apple and
  Android — i.e. a responsive web app, not a native app).
- Guests should be able to **fill in their personal details**.
- Guests should be able to **respond to dietary requirements**.
- The solution should be **scalable** if the guest list grows.

## 2. Clarifying Decisions

Three open questions were resolved before building:

| Question | Decision |
|---|---|
| Do you need to see/manage all responses? | **Yes** — an admin dashboard is in scope. |
| One combined RSVP for both events, or separate per event? | **Separate per event** — each guest can be marked attending/not attending for the engagement party and the wedding independently, since not everyone is necessarily invited to both. |
| One person per RSVP, or a group/household RSVP? | **Group RSVP** — one submission can cover a household (e.g. a couple, a family), with each member's own attendance and dietary details. |

## 3. Scope

**In scope (v1, delivered):**
- Public-facing RSVP form (mobile + desktop responsive)
- Add multiple guests to a single household RSVP
- Per-guest, per-event attendance (yes/no)
- Per-guest dietary requirements (quick-select tags + free-text notes)
- Optional message/notes field per household
- Ability for a guest to look up and edit a previously submitted RSVP (by email)
- Password-protected admin dashboard: totals, per-event attending counts, dietary
  summary, searchable guest list, CSV export
- Persistent, centrally shared storage (no separate backend/server to host)

**Explicitly out of scope for v1 (flagged as possible next steps):**
- Personalized invite links / guest list import (pre-filled names, restricting a
  guest to only the events they were actually invited to)
- Email/SMS confirmation or reminder sending
- Multi-language support
- Strong authentication for the admin dashboard (current version uses a single
  shared password, which is convenience-level, not bank-grade security)

## 4. Deliverables

1. `plan.md` — this document
2. `design.md` — high-level design of how the application works
3. `rsvp.html` — the working application (single file, ready to open in a browser
   or host anywhere)

## 5. Suggested Next Steps (v1)

- Personalize `CONFIG` in `rsvp.html` (couple names, event details, RSVP deadline,
  dietary options, admin password) before sharing the link with guests.
- Decide on hosting (see `design.md` §6) and share the resulting URL.
- If a guarded guest list becomes important (e.g. preventing uninvited people from
  RSVPing, or splitting guests between engagement-only / wedding-only invite
  lists), revisit the "invite codes" option noted above.

---

## 6. Version 2 — Personalized Invites (Requested Follow-up)

**New request:** a personalized guest experience — each guest should only see the
events they were actually invited to, their names pre-filled, and a personal note
from the couple — delivered via a **QR code** unique to each household, rebuilt in
**React** with an eye toward future-proofing as a possible product.

### 6.1 Clarifying Decisions

| Question | Decision |
|---|---|
| Single wedding, or multi-tenant (multiple couples/events)? | **Single wedding for now.** Built cleanly enough to extend later, but no multi-account/multi-tenant layer in this version. |
| How do guests get their personal invite? | **QR code** that opens a link unique to their household and recognizes them automatically. |
| Where does the personal note appear? | **On the guest's own RSVP page** — a short message from the couple, shown before they open the form. |

### 6.2 What Changed From v1

- Guests no longer land on an open/anonymous form. Each household is created
  ahead of time in the admin **Guest List**, which generates a unique invite code,
  a shareable link, and a scannable QR code.
- Opening a personal link/QR pre-fills that household's guest names, shows **only**
  the events they were invited to (not the full event list), displays the
  couple's personal note to them, and lets them RSVP or come back later to update
  their response using the same link.
- The admin dashboard gained a **Guest List** tab (add/edit/delete households,
  generate and preview QR codes/links) alongside the existing **Responses & Stats**
  tab.
- Rebuilt in **React** (`RsvpApp.jsx`) rather than plain HTML/JS, for cleaner,
  more maintainable state and a codebase that's a more natural starting point if
  this is ever extended into a hosted product.

### 6.3 Note on "Future-Proofing as a Business Opportunity"

React is a reasonable technical choice here, but the bigger constraints on
turning this into a real product aren't about frontend framework — they're about
infrastructure: user accounts for multiple couples, a production database instead
of the artifact's built-in storage, authentication, billing, and real hosting.
This version is architected so that migration path stays open (see `design.md`
§7), but building that infrastructure is a separate, larger project best done
outside a chat artifact (e.g. with Claude Code) when/if there's appetite to
pursue it.

---

## 7. Version 3 — Notifications Backend (Requested Follow-up)

**New request:** notify the couple whenever a household RSVPs or updates their
response, auto-send the guest a confirmation, and let the couple broadcast update
emails to guests who've responded — all deployed at **zero recurring cost**, built
with Claude Code (the migration path v2 flagged as the natural next step).

### 7.1 Clarifying Decisions

| Question | Decision |
|---|---|
| Budget for hosting/DB/email? | **Zero cost**, willing to compromise only if no free option covers all three. |
| Deliverability vs. simplicity for email? | Skip domain-based transactional providers (Resend/SendGrid) — their free tiers only let you email *your own* address until you verify a custom domain, which normally costs money. Use a Gmail-based relay (Google Apps Script) instead: no domain needed, sends from a real address. |
| How many vendors/accounts? | Minimize: one platform (Cloudflare) for hosting + compute + database, one more (Google) for email. |

### 7.2 What Changed From v2

- The app moved off the Claude-artifact-only `window.storage` API onto a real
  backend, so it can now be deployed to a public URL outside a chat artifact.
- **Cloudflare Pages** hosts the built React app; **Cloudflare Pages Functions**
  (`functions/api/*.js`) provide the API; **Cloudflare D1** (SQLite) replaces the
  single JSON blob with one row per household, removing the "last write wins"
  risk noted in v1's design (§4).
- Three notification flows added, all sent through a small **Google Apps Script
  Web App** bound to the couple's own Gmail (free, no domain required): a guest
  RSVP confirmation email, an admin "someone RSVP'd" notification email, and an
  admin-triggered broadcast update email to guests who've responded.
- The admin password moved from the client bundle (`CONFIG.adminPassword`) to a
  server-side secret, checked inside `functions/api/admin.js` — closing the "not
  strong authentication" gap flagged as a known limitation in v1 (§3).
- Guests now only ever receive their own household's data from the backend
  (`GET /api/invite?code=`), rather than the full guest list v1/v2 loaded
  client-side for everyone — closing a latent privacy leak.
- Added: `src/`, `functions/`, `schema.sql`, `wrangler.toml`, `apps-script/Code.gs`,
  `README.md` (setup/deploy instructions), and a Vite build (the app previously
  had no build step at all).

### 7.3 Note on Zero-Cost Tradeoffs

Cloudflare's free tier (Pages, Pages Functions, D1) comfortably covers
wedding-scale traffic with no realistic limitation. The binding constraint is
email: a personal Gmail account sending through Apps Script is capped at **100
emails/day**, shared across guest confirmations, admin notifications, and
broadcasts — plenty for typical RSVP volume, but a broadcast to a very large
guest list in one go would need to be spread across days. If higher volume or
nicer deliverability (SPF/DKIM branding) is ever needed, the natural upgrade is a
transactional email provider (e.g. Resend) once a custom domain is available to
verify — a straightforward swap of `functions/_lib/email.js` without touching
the rest of the backend. See `design.md` §9 for the full architecture and
`README.md` for setup/deploy steps.
