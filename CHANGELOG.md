# Changelog

Notable changes to the RSVP app, newest first. See `plan.md`/`design.md` for the
broader feature history (v1 → v3); this file tracks discrete fixes and changes
made along the way.

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
