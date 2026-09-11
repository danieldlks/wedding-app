# Changelog

Notable changes to the RSVP app, newest first. See `plan.md`/`design.md` for the
broader feature history (v1 → v3); this file tracks discrete fixes and changes
made along the way.

## 2026-09-07 — Guest seat map shows the full floor plan, not just your own table

**Change:** `/api/seating` previously returned only the table(s) a household's
own members were seated at. It now returns every table on the floor plan (so
a guest can see the whole room — where the head table is, how their table
relates to the dance floor, etc.) while `mySeats` still only ever contains
that invite code's own household. Tables carry no guest-identifying data
themselves (position/shape/label/capacity are host-authored, not personal),
so returning all of them is safe — no household can see *who* is sitting
anywhere but their own seat.

**Frontend fix that had to go with it:** the guest view's default/recenter
zoom used to fit to `seating.tables`, which was fine when that list was just
the guest's own table(s). Now that it's every table in the room, fitting to
the full list would zoom out to the whole floor plan instead of the guest's
seat — undoing the "find your exact seat, zoomed in" point of the page. Fixed
by deriving `myTables` (the subset of tables the guest is actually seated at)
and fitting/recentering to that, while the canvas still renders the full
`seating.tables` list for room context.

**Verified:** confirmed via two real test households seated at two different
tables — both now see both tables in the response, but each one's `mySeats`
array contains only their own two members, never the other household's.

**Files:** `functions/api/seating.js`, `src/App.jsx`.

---

## 2026-09-07 — Fix: seat map "adding a shape crashes localhost"

**Issue reported:** after adding a shape (or a wall/barrier) in the admin
Seating tab, `wrangler pages dev` would sometimes die entirely, and further
add-shape attempts would then silently fail.

**Root cause (the crash):** NOT an application bug. `wrangler pages dev`'s
own DevTools-inspector connection (`InspectorProxyWorker`, a background
`Runtime.getIsolateId` heartbeat every 10s) intermittently loses its
WebSocket ("Network connection lost") and wrangler treats that as fatal,
killing the whole dev server. This is a known, still-open upstream bug —
see [cloudflare/workers-sdk#4562](https://github.com/cloudflare/workers-sdk/issues/4562)
and its more recent duplicates/regressions (#15317, #15421) — reproducible
independent of anything this app does; confirmed it also crashes with zero
shapes added, just sitting idle. Upgrading wrangler 4.125.0 → 4.129.0 did
not fix it (same crash, same stack, on the latest version). Mitigated with
a `pages:dev:resilient` npm script that auto-restarts wrangler when this
happens — local D1 state lives on disk, so a crash doesn't lose data, just
needs a page refresh.

**Root cause (the "can't add another shape after"):** a real bug, found
while investigating. The admin Seating tab polls in the background every
5s; that poll and a manual add/move/delete/assign call could resolve out of
order (e.g. a poll issued just before a click resolving just after it), and
since both just overwrote `seatingTables`/`seatingObjects`/`seatingAssignments`
unconditionally, the stale (older) response could silently revert a shape
that had just been added — which looks exactly like "I added it and it
didn't work." Fixed with a monotonic request-sequence guard
(`seatingMutate()` in `src/App.jsx`): a response is only applied if it's
still the most recently *issued* seating request by the time it comes back;
anything superseded by a newer request is dropped.

**Verified:** reproduced the actual wrangler crash directly (confirmed via
its own debug log, not just inferred), confirmed it's independent of the
app by hitting it during idle time with no shapes added, confirmed
upgrading wrangler doesn't fix it, and confirmed `pages:dev:resilient`
auto-recovers within ~1s of a kill -9 to the wrangler process, with D1 data
intact after. Also ran an extended 70+ second test adding six shapes across
multiple poll cycles with the sequence-guard fix in place — no data loss,
no reverted shapes.

**Files:** `src/App.jsx`, `package.json`, `README.md`.

---

## 2026-09-06 — Seat map polish: room texture, oval/banquet tables, grid-snap, PNG export

**Feature:** Four self-contained additions to the seat map, chosen because
they're all additive and don't change any existing behavior (unlike admin
pan/zoom or smart alignment guides, deliberately deferred — see the GitHub
issue filed alongside this).

- **Room background** — a soft radial gradient plus a faint dot grid instead
  of a flat fill, so the canvas reads as a floor rather than a blank canvas.
- **Oval and banquet table shapes** — alongside round/rect, for a head table
  or a long banquet-style table. Refactored the table-shape math (hit-testing,
  seat layout, drawing, badge placement) behind one `tableDims()` function
  first, so adding two more shapes was a small diff instead of four separate
  near-duplicate branches.
- **Grid-snap** — dragging a table, shape, or wall endpoint now snaps to a
  50-unit grid — the same spacing as the new background dots, so the grid
  visibly explains the snapping rather than it feeling arbitrary.
- **PNG export** — a "Download floor plan" button in the admin Seating tab
  renders the current floor plan (tables with capacity/occupancy, all
  landmarks, a title) to a downloadable PNG for handing to a venue or
  caterer. Extracted the shared drawing code into one `drawFloorPlan()`
  function used by both the live canvas and the export, so the two can't
  visually drift apart from each other over time.

**Deploy note:** while verifying this, found that production's
`seating_tables`/`seat_assignments` tables (created by an earlier deploy,
before per-seat assignment and now `size2` existed) are missing the
`seat_index` and `size2` columns added since — and already have a small
amount of real usage (1 table, 2 assignments), not just empty scaffolding.
`schema.sql`'s `CREATE TABLE IF NOT EXISTS` won't retrofit those columns onto
an existing table, so the two `ALTER TABLE ... ADD COLUMN` statements now
documented as comments in `schema.sql` need to run by hand once before the
next `db:migrate:remote`, rather than assuming the file is fully idempotent
against production's current state.

**Verified:** Local smoke test — created oval/banquet tables via the admin
API with valid geometry. Playwright (local-only): room texture and both new
shapes render correctly with capacity-appropriate seat layouts, dragging a
table snaps its position to exact grid multiples (confirmed via the API
response, not just visually), and the PNG export downloads a correctly
labeled, occupancy-annotated floor plan.

**Files:** `schema.sql`, `functions/_lib/db.js`, `functions/api/admin.js`, `src/App.jsx`.

---

## 2026-09-06 — Add floor plan landmarks (bar, doors, walls) to the seat map

**Feature:** The Seating tab now has a shape palette (+ Circle, + Square,
+ Triangle, + Wall/barrier) for placing non-seating landmarks on the floor
plan — a bar, DJ booth, entrance, dance floor, a wall segment — each with a
free-text label. These are a separate `floor_objects` table from
`seating_tables`, since they carry no capacity or guest assignment, just a
shape, position, and label. Walls/barriers are lines with two independently
draggable endpoints (drag either end to stretch or angle it; drag the middle
to move the whole segment) rather than a single draggable point, since a
wall's whole point is often *not* being axis-aligned.

**Guest-visible:** These landmarks now render on the guest's "Find My Seat"
map too, alongside their highlighted seat — "near the bar, away from the
door" is exactly the kind of context a static seat number can't give. Since
they carry no guest data, the `/api/seating` endpoint returns all of them
regardless of who's asking, unlike tables which stay scoped to the
requesting household.

**Verified:** Local smoke test — created one of each shape via the admin API,
confirmed the guest endpoint returns them alongside only the household's own
table. Playwright (local-only) confirmed the palette buttons render, dragging
a wall's endpoint reshapes it and persists the new coordinates to D1, and the
guest view renders all four landmark shapes correctly at their positions.

**Files:** `schema.sql`, `functions/_lib/db.js`, `functions/api/admin.js`,
`functions/api/seating.js`, `src/App.jsx`.

---

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
