# Changelog

Notable changes to the RSVP app, newest first. See `plan.md`/`design.md` for the
broader feature history (v1 → v3); this file tracks discrete fixes and changes
made along the way.

## 2026-09-06 — Upgrade seat map to per-seat assignment

**Feature:** The seat map from the previous entry assigned guests to a whole
table; this upgrades it to a specific chair. `seat_assignments` gains a
`seat_index` column (0-based, using the same layout formula the canvas draws
seats with — `getSeatPositions()` in `src/App.jsx` — so "seat 3" means the
same physical chair everywhere it's referenced). The admin table panel now
lists every seat individually ("Seat 1: empty", "Seat 2: Jane Smith · Unseat")
instead of one flat "seated here" list, and dragging/tapping a guest targets a
specific seat row rather than the table as a whole — deliberately kept off the
canvas itself, since tapping a 4px dot on a phone screen is a bad time; the
canvas now only handles table selection and dragging. The guest's own seat map
highlights the exact chair (enlarged, colored dot) rather than just ringing
the whole table.

**Real-time:** Both the admin Seating tab (every 5s) and the guest seat page
(every 20s) now poll in the background rather than only fetching once on
load — enough for a second admin editing from another device, or a
last-minute reassignment on the wedding day, to show up without a manual
refresh. Went with polling over a Durable Object + WebSocket push since
simultaneous multi-admin editing is rare at wedding scale and polling adds no
new infrastructure.

**Race safety:** `assign-seat` now checks for a same-table/same-seat clash
before writing and returns `409` if one exists, since two admins polling on a
5s cadence could otherwise both target an empty seat inside the same window.

**Verified:** Local smoke test confirmed the 409 on a deliberate seat clash,
and a real Chromium browser (Playwright, local-only) confirmed the tap-guest→
tap-seat flow assigns correctly, the admin per-seat list renders and updates
live, and the guest view highlights the exact assigned seat(s) with a
per-person "Table X, seat N" legend.

**Files:** `schema.sql`, `functions/_lib/db.js`, `functions/api/admin.js`,
`functions/api/seating.js`, `src/App.jsx`.

---

## 2026-09-05 — Add interactive Canvas seat map

**Feature:** Guests can now find their reception table from their invite link
("Find My Seat" on the guest menu), rendered as a hand-drawn Canvas floor plan
with their table highlighted, a legend, and pinch/wheel-free zoom via +/−
buttons and click-drag panning. The admin dashboard gets a new "Seating" tab:
a drag-and-drop floor-plan builder where tables (round or rectangular, with a
label/size/capacity) can be placed and repositioned by dragging on the canvas,
and unseated guests can be seated either by dragging their chip onto a table
or by tapping a guest then tapping a table (touch-friendly fallback).

**Data model:** Two new D1 tables — `seating_tables` (one row per table: id,
label, shape, x/y, size, capacity) and `seat_assignments` (one row per invited
guest: member_id → table_id). Assignment is table-level, not per-chair.
Deleting a household or a table cascades to remove the relevant assignments.

**Privacy:** The new guest-facing `/api/seating?code=` endpoint returns *only*
the table(s) that invite code's own household members are seated at — never
the full floor plan or other guests' names — since any invite code could
otherwise be used to see the whole room's seating.

**Verified:** Full local smoke test via `wrangler pages dev` — created tables
of both shapes via the admin API, assigned/unassigned/reassigned a guest,
confirmed the guest endpoint only exposes that household's own table(s), and
confirmed cascade deletes on both household and table removal. Also
click-tested in a real Chromium browser (Playwright, launched locally for this
session only): dragging a table on the admin canvas persists its new position
to D1, the tap-guest-then-tap-table assignment flow updates occupancy badges
live, and the guest seat-map page correctly highlights the assigned table with
a legend below it.

**Files:** `schema.sql`, `functions/_lib/db.js`, `functions/api/admin.js`,
`functions/api/seating.js` (new), `src/App.jsx`.

---

## 2026-08-29 — Fix: admin/guest text fields losing focus while typing

**Issue:** In the admin login screen (and, it turns out, every other text field
in the app — guest RSVP name/email/phone, household editor, admin search,
broadcast subject/message), typing a single character would drop focus out of
the field, requiring a re-click to keep typing.

**Root cause:** All ~20 view components (`AdminLogin`, `GuestFormStep1`,
`HouseholdEditor`, `AdminResponses`, etc.) were defined as `function`s *inside*
`App()`'s body, closing over `state`/`patch`/handlers. Every re-render of `App`
(triggered by `patch()` on each keystroke) redefined these functions, giving
React a brand-new component reference each time. React identifies components by
reference, so it tore down and remounted the entire DOM subtree on every
keystroke instead of updating it in place — destroying and recreating the
focused `<input>`.

This predates the backend work; it was already the structure of the original
`RsvpApp.jsx` artifact source, just not noticeable without typing quickly into
a field.

**Fix:** Moved all view components to module scope in `src/App.jsx` (stable
function references across renders), passing `state` and a bundled `actions`
object (all the handler functions from `App`) as props instead of relying on
closures.

**Verified:** `npm run build` compiles clean; confirmed via `grep` that no
component definitions remain nested inside `App()` (only plain event handlers,
which don't have this issue since they're never rendered as `<Component/>`
elements). Not click-tested in a live browser this session (no browser
extension connected) — the fix addresses a deterministic React reconciliation
mechanism, so structural verification is conclusive here.

**Files:** `src/App.jsx`

---

## 2026-08-24 — Add zero-cost backend for RSVP notifications (v3)

**Issue:** The app had no backend of its own — it read/wrote through
`window.storage`, a global only available inside a Claude-hosted artifact
preview. That meant it couldn't be deployed to a real URL, and there was no way
to notify the couple when a guest RSVP'd, auto-confirm to the guest, or let the
couple broadcast an update to guests.

**Fix:** Added a Cloudflare Pages + Pages Functions + D1 backend (zero
recurring cost, no custom domain required), with email sent through a Google
Apps Script Web App relaying via the couple's own Gmail (also zero cost, unlike
domain-gated providers like Resend/SendGrid on their free tiers). Three
endpoints (`/api/invite`, `/api/rsvp`, `/api/admin`) replace `window.storage`;
three notification flows added (guest confirmation, admin "new RSVP" alert,
admin broadcast). Also fixed two latent issues as a side effect: the admin
password moved from the client bundle to a server-side secret, and guests now
only receive their own household's data instead of the full guest list.

**Verified:** Full local smoke test via `wrangler pages dev` — wrong admin
password rejected (401), household create/edit/delete round-tripped correctly
through D1, guest invite lookup scoped to one household, RSVP submission saved
even when the email relay wasn't configured (best-effort, non-blocking), and
broadcast reported accurate sent/failed counts.

**Files:** `src/App.jsx` (formerly `RsvpApp.jsx`), `functions/`, `schema.sql`,
`wrangler.toml`, `apps-script/Code.gs`, `README.md`; `plan.md`/`design.md`
updated with the full v3 write-up.
