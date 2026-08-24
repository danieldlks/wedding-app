# Wedding & Engagement RSVP — High-Level Design

## 1. Overview

The application is a **single self-contained HTML file** (`rsvp.html`) — HTML, CSS
and JavaScript all in one document, with no build step, framework, or server
required. It runs entirely in the guest's browser and talks to a small built-in
key-value storage service to save and retrieve RSVP data. This makes it easy to
host anywhere (see §6) and easy to hand off as a single file.

```
┌─────────────────────────────┐        ┌──────────────────────────┐
│   Guest's browser (phone     │  save  │   Persistent storage      │
│   or desktop)                │ ─────► │   (shared key-value)      │
│   rsvp.html                  │ ◄───── │   key: "rsvp-all"         │
│                               │  load  │   value: JSON of all      │
└───────────────┬───────────────┘        │   household RSVPs         │
                │                        └──────────────────────────┘
                │ same file, same storage
┌───────────────▼───────────────┐
│  Admin's browser               │
│  rsvp.html → Admin view        │
│  (password-gated)               │
└─────────────────────────────────┘
```

Guests and the admin use the **same file**; which view they see is just app
state (`landing`, `form`, `admin`, etc.) driven by what they click.

## 2. Application Flow (Guest Side)

1. **Landing** — couple's names + a "wax seal" button.
2. **Choice** — after opening the seal: *New RSVP* or *Edit a previous RSVP*.
   - Editing looks the record up by the email address originally used.
3. **Step 1 – Your details** — name, email (used as the record's unique key),
   optional phone.
4. **Step 2 – Who's coming** — add/remove guests in the household.
5. **Step 3 – Events & dietary** — for each guest, a Yes/No toggle per event
   (engagement party, wedding), dietary tags (Vegetarian, Vegan, Gluten-free,
   Dairy-free, Nut allergy, Other) and a free-text note.
6. **Step 4 – Review & send** — summary of everything entered, plus an optional
   message to the couple, then submit.
7. **Confirmation** — stamped "RSVP Confirmed" screen summarizing what was
   submitted, with a reminder that they can return and edit using the same email.

A numbered step indicator (1–4) tracks progress, since this is a genuine ordered
sequence the guest moves through.

## 3. Application Flow (Admin Side)

- A small "Admin" link (bottom-right corner, unobtrusive so guests aren't
  distracted by it) opens a password prompt.
- Once signed in, the dashboard shows:
  - Total RSVPs received and total guests
  - Attending totals per event
  - A dietary requirements summary (counts per tag, aggregated across all guests)
  - A searchable, expandable list of every household's response (guest-level
    detail: attendance per event, dietary tags/notes, household message)
  - A **CSV export** button (one row per guest, with household + attendance +
    dietary columns) for handing to a caterer or venue

## 4. Data Model

All RSVPs are stored as **one JSON object**, keyed by the guest's (lowercased,
trimmed) email address, under a single storage key: `rsvp-all`.

```json
{
  "jane@example.com": {
    "contactName": "Jane Smith",
    "email": "jane@example.com",
    "phone": "0412 345 678",
    "members": [
      {
        "name": "Jane Smith",
        "isPrimary": true,
        "attending": { "engagement": true, "wedding": true },
        "dietaryTags": ["Vegetarian"],
        "dietaryNote": ""
      },
      {
        "name": "Tom Smith",
        "isPrimary": false,
        "attending": { "engagement": false, "wedding": true },
        "dietaryTags": ["Gluten-free"],
        "dietaryNote": "Coeliac — needs to be prepared separately"
      }
    ],
    "notes": "So excited for you both!",
    "submittedAt": "2026-08-23T05:40:00.000Z"
  }
}
```

**Why one JSON blob instead of one record per key:** for a guest list of the size
typical of an engagement party / wedding (tens to low thousands of guests), a
single object comfortably fits well within the storage system's 5MB-per-key
limit, and it means:
- Loading the admin dashboard is **one** read, not one read per household.
- Saving an RSVP is a read-modify-write of a single key, avoiding the need to
  list and fetch many keys just to compute the totals shown on the dashboard.

**Trade-off:** because it's a single shared value, two people submitting in the
exact same instant could theoretically overwrite each other (last write wins).
For an RSVP form this risk is negligible in practice (submissions are infrequent
and each guest edits their own record, not someone else's), but it's worth
knowing about if the guest list becomes very large or submissions are expected
to be highly concurrent.

## 5. Design System (Visual)

Rather than a generic template look, the interface borrows from real invitation
stationery:

- **Palette:** deep forest ink (`#202B22`) for the hero, warm ivory "paper"
  (`#FBF7EF`) for the RSVP card, antique gold (`#A9814C`) hairlines and accents,
  muted sage (`#6E7F63`) for primary actions, dusty rose (`#C98F86`) for dietary
  tags.
- **Type:** Cormorant Garamond (serif, display) for headings and the couple's
  names; Work Sans (sans-serif) for body text and form labels.
- **Signature moments:** a wax-seal button the guest "breaks" to open the
  invitation, and a stamped "RSVP Confirmed" mark on submission.
- Fully responsive: single-column card layout that works from small phones up
  to desktop widths; respects `prefers-reduced-motion` for anyone sensitive to
  animation.

## 6. Hosting & Scalability Notes

- The file can be opened directly, shared as a Claude artifact link, or hosted
  on **any** static web host (e.g. Netlify, Vercel, GitHub Pages, S3 + CloudFront)
  since it has no server-side dependencies of its own.
- The storage layer is provided by the artifact platform and shared across
  anyone who opens the link, so no database setup is required.
- Scales comfortably to the guest-list sizes typical of an engagement party and
  wedding. If this were ever repurposed for a much larger public event (e.g.
  thousands of concurrent submissions, or a need for guaranteed no-conflict
  writes), the natural next step would be moving to a proper backend + database
  — happy to help with that migration if it's ever needed.

## 7. Security Notes

- The admin dashboard is protected by a single shared password set in the
  `CONFIG` object in `rsvp.html`. This keeps casual visitors out but is **not**
  strong authentication — don't reuse a sensitive password, and change it from
  the placeholder before sharing the guest link.
- Guests can only edit the record tied to the email they enter — there's no way
  to browse or edit anyone else's RSVP from the guest-facing views.

---

## 8. Version 2 — Personalized Invites (`RsvpApp.jsx`)

### 8.1 What's Different From v1

v1 was an open form anyone with the link could fill in. v2 is **invitation-gated**:
the admin creates each household ahead of time, and guests only ever see a form
that's already personalized to them.

```
Admin creates household  →  app generates invite code + QR  →  couple sends QR
        │                                                              │
        ▼                                                              ▼
  Guest List (admin)                                    Guest scans QR on their phone
        │                                                              │
        └──────────────── same storage record ──────────────► Pre-filled, personalized
                                                                  RSVP page (their events,
                                                                  their names, their note)
```

### 8.2 Guest Flow

1. Guest scans their QR code (or opens their link), which is their household's
   invite URL with a `?invite=CODE` query parameter.
2. The app reads that code on load, looks up the matching household record, and
   shows a personalized hero: the household's name, **only** the events they were
   invited to, and the couple's personal note to them (if one was written).
3. Tapping the wax seal opens the RSVP form, pre-filled with the guest names the
   admin entered. Guests can correct a misspelled name, and — if the admin
   enabled it for that household — add one extra guest (e.g. a plus-one).
4. Step 2 shows attendance toggles and dietary questions **only for the events
   that household was invited to** — a household invited to the wedding only
   never sees the engagement party as an option.
5. Step 3 is a review screen, then submit. A confirmation screen shows what was
   recorded.
6. If a guest reopens the same link later, the form is pre-filled with what they
   previously submitted, so revisiting the link *is* the "edit my RSVP" flow —
   there's no separate lookup step needed, since the link itself is the guest's
   identity.

### 8.3 Admin Flow — Guest List Tab (new)

- **Add household:** enter guest name(s), tick which event(s) they're invited to,
  optionally allow a plus-one, and write a personal note. Saving generates a
  unique invite code.
- Each household row can be expanded to: **show its QR code**, **copy its invite
  link**, **preview the invite exactly as that guest will see it** (without
  leaving the admin session or needing to fake a URL), **edit**, or **delete**.
- **Preview as guest** is important for a QR/invite-code system: since invite
  links only make sense once the app is hosted at a real, stable URL, this lets
  the couple check every household's personalized experience directly from the
  admin dashboard before printing/sending any QR codes.

### 8.4 Admin Flow — Responses & Stats Tab

Same purpose as the v1 dashboard, extended to reflect invitations:
- Totals now include **"Households invited"** vs **"Responded"**, so it's clear
  who hasn't replied yet (shown as an "Awaiting reply" status pill), not just who
  said yes/no.
- Per-event attending counts, dietary summary, search, and CSV export all carry
  over from v1.

### 8.5 Data Model

Still one JSON object under a single shared storage key (`wedding-guestlist`),
now keyed by **invite code** instead of email — the invite code is a household's
permanent identity, separate from whatever contact email they type in when they
RSVP.

```json
{
  "K3F9QZ": {
    "inviteCode": "K3F9QZ",
    "householdName": "Jane & Tom Smith",
    "members": [
      { "id": "a1b2c3d", "name": "Jane Smith" },
      { "id": "e4f5g6h", "name": "Tom Smith" }
    ],
    "invitedEvents": ["engagement", "wedding"],
    "allowPlusOne": false,
    "personalNote": "We're so excited to have you at the ceremony!",
    "createdAt": "2026-08-20T09:00:00.000Z",
    "response": {
      "members": [
        { "id": "a1b2c3d", "name": "Jane Smith", "attending": { "engagement": true, "wedding": true }, "dietaryTags": ["Vegetarian"], "dietaryNote": "" },
        { "id": "e4f5g6h", "name": "Tom Smith", "attending": { "engagement": false, "wedding": true }, "dietaryTags": [], "dietaryNote": "" }
      ],
      "contactEmail": "jane@example.com",
      "contactPhone": "0412 345 678",
      "notes": "So excited for you both!",
      "submittedAt": "2026-08-23T05:40:00.000Z"
    }
  }
}
```

`response` is `null` until the guest submits, which is how the dashboard
distinguishes "awaiting reply" from "responded."

### 8.6 QR Codes & Invite Links

- The invite link for a household is built from `CONFIG.siteBaseUrl` (set this
  once you know where the app will be hosted) plus `?invite=CODE`.
- The QR code image itself is generated by calling a free public QR-generation
  API (`api.qrserver.com`) with that link as the encoded data — no account, key,
  or extra dependency required. If you'd rather generate QR codes fully
  client-side (e.g. for offline use or stricter data-sharing preferences), that's
  a straightforward swap for a JavaScript QR library later.
- **Important:** the personalization only works once the app is hosted at a real,
  stable URL, since it depends on reading `?invite=CODE` from the browser's
  address bar. Inside a chat artifact preview, use **Preview as guest** in the
  admin dashboard instead of relying on the URL bar.

### 8.7 Why React (and What "Future-Proofing" Does and Doesn't Mean Here)

React gives this app real component state, predictable re-renders, and a
structure (clear data model, pure helper functions, presentational
sub-components) that's easier to extend or hand to another developer than the
vanilla-JS version. That's a genuine, if modest, step toward reusability.

What React **doesn't** solve is the bigger gap between "a nice RSVP app for one
wedding" and "a product other couples could sign up for": that needs real user
accounts, a production database (the artifact's built-in storage is shared and
has no per-tenant isolation or fine-grained permissions), authentication,
payments, and hosting infrastructure. None of that is in this version. If there's
appetite to pursue the business idea later, the natural next step is standing up
that infrastructure as a proper application (e.g. with Claude Code), reusing this
component's data model and UI as a starting point rather than a finished
foundation.

### 8.8 Hosting Note

Same as v1 (§6): this is a static frontend with no server-side code of its own,
so it can be hosted on any static host. Once hosted, set `CONFIG.siteBaseUrl` to
that URL so generated QR codes/links point to the right place.

---

## 9. Version 3 — Backend & Notifications

### 9.1 What's Different From v2

v2 ran entirely in the guest's browser against the artifact platform's built-in
storage — fine for a chat-artifact preview, but with no way to send email and no
path to a real deployed URL. v3 adds a small, real backend so the app can live at
a public URL and actively notify people, at zero recurring cost.

```
Guest submits RSVP  →  POST /api/rsvp  →  D1 (households.response)
                                              │
                                              ├──► Apps Script relay ──► Guest: confirmation email
                                              └──► Apps Script relay ──► Couple: "new RSVP" email

Admin action (list/save/delete/broadcast)  →  POST /api/admin  →  D1
                                                                     └──► Apps Script relay ──► Guests: broadcast update email
```

### 9.2 Architecture

- **Hosting**: Cloudflare Pages serves the built React app (`vite build` → `dist/`).
- **Compute**: Cloudflare Pages Functions, same-origin under `/api/*` (no CORS needed):
  - `functions/api/invite.js` — `GET ?code=` — public, returns one household's record.
  - `functions/api/rsvp.js` — `POST` — public but scoped to one invite code; upserts
    the response, then fires the guest-confirmation and admin-notify emails.
  - `functions/api/admin.js` — `POST` — password-checked on every call
    (`{ password, action, payload }`); actions: `list`, `save-household`,
    `delete-household`, `broadcast`.
  - `functions/_lib/` — shared helpers: `db.js` (row↔JSON conversion, invite code
    generation), `email.js` (calls the Apps Script relay), `templates.js` (email
    HTML), `config.js` (event id → name map, kept in sync with `CONFIG.events`).
- **Database**: Cloudflare D1 (SQLite), one `households` table (§9.3), bound
  directly into the Functions via `env.DB`.
- **Email**: a Google Apps Script Web App (`apps-script/Code.gs`) deployed under
  the couple's own Gmail, called over HTTPS with a shared secret. No domain, no
  third-party account, sends from a real recognizable address.

### 9.3 Data Model

One row per household, replacing the single-JSON-blob model from v1/v2 (which
risked last-write-wins on concurrent saves, per v1 §4):

```sql
CREATE TABLE households (
  invite_code TEXT PRIMARY KEY,
  household_name TEXT NOT NULL,
  members TEXT NOT NULL,        -- JSON array, same shape as before
  invited_events TEXT NOT NULL, -- JSON array
  allow_plus_one INTEGER NOT NULL DEFAULT 0,
  personal_note TEXT,
  created_at TEXT NOT NULL,
  response TEXT                 -- JSON object, or NULL until submitted
);
```

The JSON shape of `members`/`response` is unchanged from v2's data model, so the
app's existing rendering/validation logic needed no changes — only the load/save
plumbing did.

### 9.4 Notification Flows

1. **Guest RSVP confirmation** — on `POST /api/rsvp`, the guest's `contactEmail`
   gets an HTML summary of what they submitted.
2. **Admin "someone RSVP'd" alert** — the same request also emails
   `ADMIN_NOTIFY_EMAIL` (a server secret, not guessable/spoofable from the
   client) with the household's response.
3. **Admin broadcast** — a "Send an update" panel in the Responses & Stats tab
   lets the couple email everyone who's responded so far (venue changes,
   reminders, etc.); the dashboard reports back a sent/failed count per send.

All three are **best-effort**: if the email relay has a hiccup, the RSVP itself
still saves — a guest's submission is never blocked on email delivery succeeding.

### 9.5 Security Notes (Supersedes v1 §7)

- The admin password now lives only as a Cloudflare Pages secret
  (`ADMIN_PASSWORD`), checked inside `functions/api/admin.js` on every admin
  request — it no longer ships in the client JS bundle (v1/v2 had it in
  `CONFIG.adminPassword`, visible to anyone who opened dev tools).
- Guests now only ever receive their own household's JSON from the backend
  (`GET /api/invite?code=`) — v1/v2 loaded the entire guest list into the
  guest's browser on page load, meaning any guest could technically inspect
  network traffic and see every other household's names and dietary notes.
  That gap is closed in v3.
- The email relay is gated by a shared secret (`EMAIL_SHARED_SECRET`) known only
  to the Pages Functions and the Apps Script deployment, so it can't be used as
  an open mail relay by third parties who discover the `/exec` URL.

### 9.6 Hosting & Cost

- Cloudflare Pages/Functions/D1: free tier, no realistic limit at wedding scale
  (Functions: 100k requests/day; D1: millions of reads/writes/day).
- Email: **100 emails/day** free quota on a personal Gmail account via Apps
  Script, shared across all three notification flows — the one real constraint,
  worth knowing about before a large single-day broadcast.
- No custom domain required; a free `*.pages.dev` URL is used for
  `CONFIG.siteBaseUrl`, QR codes, and invite links.
- See `README.md` for one-time setup (Cloudflare account, D1 database, Apps
  Script deployment, secrets) and deploy commands (`npm run pages:deploy`).
