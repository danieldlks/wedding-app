import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { SEAT_LW, SEAT_LH, clamp, tableDims, triangleVertices, getSeatPositions } from "./seatingGeometry.js";
// The 3D venue view (and three.js) is split into its own file and only
// downloaded the first time someone switches to 3D.
const FloorPlan3D = lazy(() => import("./FloorPlan3D.jsx"));

/* =========================================================
   CONFIG — edit this block to personalise the invitation
   ========================================================= */
const CONFIG = {
  coupleNames: "Daniel & Faith",
  // DEFAULTS only: the admin edits each event's name, date, start time, time
  // zone, venue and address in Settings → Event details (saved in the
  // database, no redeploy). Read events via eventsList()/eventById(), never
  // CONFIG.events directly. The ids are linked to every invitation/RSVP, so
  // adding or removing an event is still a code change (also update EVENTS in
  // functions/_lib/config.js). date = 'YYYY-MM-DD', time = 24h 'HH:MM', both
  // local to timeZone; display text and the countdown are derived from them.
  events: [
    { id: "engagement", name: "Engagement Party", date: "2027-02-20", time: "14:30", timeZone: "Australia/Adelaide", venue: "SUNDAY", address: "" },
    // seated: true = this event has the reception seating plan (Find My Seat, and its
    // capacity in admin Settings is the total of the seating tables' capacities).
    { id: "wedding", seated: true, name: "Wedding Ceremony & Reception", date: "2027-08-06", time: "15:30", timeZone: "Australia/Adelaide", venue: "Longview Vineyard", address: "" }
  ],
  // The site's usual time zone. An event in a different zone shows its time
  // with a label, e.g. "3:30 PM (Perth time)". Keep in sync with TIME_ZONE in functions/_lib/config.js.
  timeZone: "Australia/Adelaide",
  // RSVP deadlines are set per event by the admin (Settings tab), not here — see design.md §11.
  dietaryOptions: ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Nut allergy", "Other"],
  // Admin password now lives server-side only (a Cloudflare Pages secret) — see functions/api/admin.js.
  // Where this app will live once hosted (used to build QR codes / invite links).
  // Leave blank to fall back to the current browser URL.
  siteBaseUrl: "https://daniel-and-faith.com",
  // DEFAULT guest information items for the Details page; the admin edits them in Settings → Guest information.
  details: [
    { title: "Dress Code", body: "Cocktail / semi-formal attire." },
    { title: "Gifts", body: "Your presence is the only present we need — details will follow closer to the date if you'd still like to contribute." }
  ]
};

/* =========================================================
   PURE HELPERS
   ========================================================= */
function genId() { return Math.random().toString(36).slice(2, 9); }
function defaultAttending(invitedEvents) {
  const o = {};
  (invitedEvents || []).forEach(id => (o[id] = true));
  return o;
}
// The effective events and guest-information items: the admin's saved
// settings over the CONFIG defaults. App() refreshes these from
// state.siteSettings at the top of every render (applySiteSettings), so every
// component below reads current values without threading them through props.
let currentEvents = CONFIG.events;
let currentGuestInfo = CONFIG.details;
function applySiteSettings(site) {
  currentEvents = CONFIG.events.map(e => ({ ...e, ...(site?.events?.[e.id] || {}), id: e.id, seated: e.seated }));
  currentGuestInfo = Array.isArray(site?.guestInfo) ? site.guestInfo : CONFIG.details;
}
function eventsList() { return currentEvents; }
function guestInfoList() { return currentGuestInfo; }
function eventById(id) { return currentEvents.find(e => e.id === id); }
// A shorter label for tight spots (dropdowns): "Wedding Ceremony & Reception" -> "Wedding Ceremony".
function eventShortName(ev) { return ev.name.split(/ & | and | — | - /)[0]; }
// Only households invited to the seated event (the reception) have a seat to find or be given.
function invitedToSeatedEvent(rec) { return rec.invitedEvents.some(id => eventById(id)?.seated); }

// Dates are plain 'YYYY-MM-DD' strings and times 24h 'HH:MM', always local to
// a named IANA time zone. The weekday and display text are derived, never
// typed, so they can't drift out of sync. Uses only the browser's built-in
// Intl time-zone data (no library).
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function parseYmd(ymd) { const [y, m, d] = ymd.split("-").map(Number); return { y, m, d }; }
function formatYmd(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}
function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
// Minutes the zone is ahead of UTC at a given instant (e.g. +630 for Adelaide in summer).
function tzOffsetMinutes(utcMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}
// The exact instant of a local date + time in a zone (handles daylight saving).
function zonedToUtcMs(ymd, hm, tz) {
  const { y, m, d } = parseYmd(ymd);
  const [h, mi] = (hm || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess - tzOffsetMinutes(guess, tz) * 60000;
  ms = guess - tzOffsetMinutes(ms, tz) * 60000; // second pass for dates that straddle a DST change
  return ms;
}
function todayYmdIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
// Whole days from "today in tz" to ymd (0 = today, negative = past). A reply-by
// date therefore passes at the end of that day in the event's own time zone,
// wherever the guest is.
function daysUntilYmd(ymd, tz = CONFIG.timeZone) {
  const a = parseYmd(ymd), b = parseYmd(todayYmdIn(tz));
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}
// 'YYYY-MM-DD' -> "20 Jan" (or "Sat 20 Feb 2027" with long = true), for compact summaries.
function formatYmdShort(ymd, long = false) {
  const { y, m, d } = parseYmd(ymd);
  return long ? `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3)} ${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` : `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}
function formatTime12(hm) {
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
// "Australia/Adelaide" -> "Adelaide", "America/Los_Angeles" -> "Los Angeles"
function tzCity(tz) { return tz.split("/").pop().replace(/_/g, " "); }
// e.g. "UTC+10:30" and "ACDT" for a zone on a particular date (for the admin's time zone picker).
function tzOffsetLabel(ymd, hm, tz) {
  const ms = zonedToUtcMs(ymd, hm, tz);
  const off = tzOffsetMinutes(ms, tz), sign = off < 0 ? "-" : "+", a = Math.abs(off);
  const abbr = new Intl.DateTimeFormat("en-AU", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find(p => p.type === "timeZoneName")?.value || "";
  const utc = `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
  return abbr && !abbr.startsWith("GMT") && !abbr.startsWith("UTC") ? `${abbr}, ${utc}` : utc;
}
// Guest-facing text for an event, derived from its saved fields.
function eventDateText(ev) { return formatYmd(ev.date); }
function eventTimeText(ev) {
  const t = formatTime12(ev.time);
  return ev.timeZone && ev.timeZone !== CONFIG.timeZone ? `${t} (${tzCity(ev.timeZone)} time)` : t;
}
function eventStartMs(ev) { return zonedToUtcMs(ev.date, ev.time, ev.timeZone || CONFIG.timeZone); }
// The event's own local calendar date.
function eventYmd(ev) { return ev.date || null; }
function eventTz(id) { return eventById(id)?.timeZone || CONFIG.timeZone; }
// Maps search: the address when the admin has entered one (a venue name alone, e.g. "SUNDAY", may not find the place).
function mapQuery(ev) { return ev.address ? `${ev.venue}, ${ev.address}` : ev.venue; }
function deadlineFor(site, eventId) { return site?.deadlines?.[eventId] || null; }

// The "Kindly reply by…" sentence for a household, covering only the events
// they're invited to. Late replies are always accepted (nothing is locked),
// so a passed deadline softens the wording rather than closing anything.
function rsvpDeadlineSentence(eventIds, site) {
  const items = eventIds.map(id => ({ ev: eventById(id), ymd: deadlineFor(site, id) })).filter(x => x.ev && x.ymd);
  if (items.length === 0) return null;
  const upcoming = items.filter(x => daysUntilYmd(x.ymd, x.ev.timeZone) >= 0);
  const passed = items.filter(x => daysUntilYmd(x.ymd, x.ev.timeZone) < 0);
  if (upcoming.length === 0) return "The reply date has passed, but we'd still love to hear from you.";
  let out = new Set(upcoming.map(x => x.ymd)).size === 1 && passed.length === 0
    ? `Kindly reply by ${formatYmd(upcoming[0].ymd)}.`
    : `Kindly reply by ${upcoming.map(x => `${formatYmd(x.ymd)} for the ${x.ev.name}`).join(" and ")}.`;
  if (passed.length) out += ` The reply date for the ${passed.map(x => x.ev.name).join(" and ")} has passed, but late replies are welcome.`;
  return out;
}
function inviteUrl(code) {
  const base = CONFIG.siteBaseUrl || (window.location.origin + window.location.pathname);
  return `${base}?invite=${code}`;
}
function qrSrc(code) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(inviteUrl(code))}`;
}
// CSV injection guard: several exported fields (guest name, dietary note,
// household message) are guest-controlled via the public RSVP form. Excel/
// Sheets treats a cell starting with =, +, -, @, tab, or CR as a live
// formula regardless of CSV quoting, so a guest name like
// =HYPERLINK("http://evil.com") would execute the moment the admin opens
// the export. Prefixing with a leading apostrophe forces the cell to be
// read as literal text instead.
function csvSafe(v) {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/* =========================================================
   BACKEND — Cloudflare Pages Functions under /api
   ========================================================= */
async function apiGetInvite(code) {
  const res = await fetch(`/api/invite?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  return await res.json();
}
async function apiSubmitRsvp(payload) {
  const res = await fetch("/api/rsvp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("submit failed");
  return await res.json();
}
async function apiGetSeating(code) {
  const res = await fetch(`/api/seating?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  return await res.json();
}
async function apiAdmin(password, action, payload) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action, payload })
  });
  if (res.status === 401) { const e = new Error("Unauthorized"); e.code = 401; throw e; }
  if (!res.ok) { const e = new Error("admin request failed"); e.status = res.status; throw e; }
  return await res.json();
}

/* =========================================================
   COUNTDOWN
   Finds the next upcoming event (optionally scoped to a
   household's invitedEvents) and ticks down to it.
   ========================================================= */
function getNextEvent(eventIds) {
  const now = Date.now();
  const ids = eventIds && eventIds.length ? eventIds : eventsList().map(e => e.id);
  const upcoming = ids
    .map(id => eventById(id))
    .filter(e => e && e.date && e.time)
    .map(e => ({ ...e, ts: eventStartMs(e) }))
    .filter(e => !isNaN(e.ts) && e.ts > now)
    .sort((a, b) => a.ts - b.ts);
  return upcoming[0] || null;
}

function CountdownWidget({ eventIds }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const next = getNextEvent(eventIds);
  if (!next) {
    return (
      <div className="countdown">
        <div className="countdown-label"><strong>{CONFIG.coupleNames}</strong> — thank you for celebrating with us!</div>
      </div>
    );
  }
  const diff = Math.max(0, next.ts - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const Unit = ({ val, label }) => (
    <div className="countdown-unit">
      <span className="countdown-num">{String(val).padStart(2, "0")}</span>
      <span className="countdown-unit-label">{label}</span>
    </div>
  );
  return (
    <div className="countdown">
      <div className="countdown-label">Counting down to the <strong>{next.name}</strong></div>
      <div className="countdown-grid">
        <Unit val={days} label="Days" />
        <Unit val={hours} label="Hrs" />
        <Unit val={mins} label="Min" />
        <Unit val={secs} label="Sec" />
      </div>
    </div>
  );
}

/* =========================================================
   STYLES (ported invitation-stationery design system)
   ========================================================= */
const CSS = `
:root{
  --ink:#202B22; --ink-soft:#4A5148; --paper:#FBF7EF; --paper-2:#F3EDDF;
  --gold:#A9814C; --gold-soft:#D8C8A5; --sage:#6E7F63; --sage-dark:#57654E;
  --rose:#C98F86; --error:#B6503F; --shadow:0 18px 40px -20px rgba(32,43,34,0.35);
  --display:'Cormorant Garamond',serif; --body:'Work Sans',-apple-system,BlinkMacSystemFont,sans-serif;
}
.rsvp-root *{box-sizing:border-box;}
/* overflow-x:clip stops any stray wide element from making the whole page scroll sideways
   (unlike overflow:hidden it doesn't create a scroll container, so position:sticky still works). */
.rsvp-root{font-family:var(--body);color:var(--ink);background:var(--paper);min-height:100vh;min-height:100dvh;overflow-x:clip;}
.rsvp-root button{font-family:inherit;cursor:pointer;}
.rsvp-root input,.rsvp-root textarea{font-family:inherit;}
.eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:600;}
.hero{min-height:100vh;min-height:100dvh;background:radial-gradient(ellipse at 50% -10%,rgba(169,129,76,.18),transparent 60%),var(--ink);color:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 20px;position:relative;overflow:hidden;}
.hero::before{content:"";position:absolute;inset:18px;border:1px solid rgba(216,200,165,.35);pointer-events:none;}
.hero .eyebrow{color:var(--gold-soft);margin-bottom:18px;}
.hero h1{font-family:var(--display);font-weight:500;font-size:clamp(36px,8vw,68px);line-height:1.05;margin:0 0 10px;}
.hero .sub{font-family:var(--display);font-style:italic;font-size:clamp(15px,3vw,19px);color:var(--gold-soft);margin:0 0 30px;}
.note-quote{max-width:420px;font-family:var(--display);font-style:italic;font-size:18px;line-height:1.5;color:var(--paper);opacity:.92;margin:0 0 34px;position:relative;padding:0 10px;}
.seal{width:108px;height:108px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#C79A5E,var(--gold) 55%,#8A6636 100%);border:none;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:32px;color:var(--ink);box-shadow:0 10px 30px -8px rgba(0,0,0,.55),inset 0 2px 4px rgba(255,255,255,.35);transition:transform .3s cubic-bezier(.34,1.56,.64,1);}
.seal:hover{transform:scale(1.06) rotate(-3deg);}
.seal-caption{margin-top:16px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-soft);font-weight:500;}
.stage{min-height:100vh;min-height:100dvh;background:linear-gradient(180deg,var(--ink) 0,var(--ink) 120px,var(--paper) 120px);display:flex;justify-content:center;padding:36px 16px 80px;}
.card{width:100%;max-width:620px;background:var(--paper);border:1px solid var(--gold-soft);box-shadow:var(--shadow);position:relative;}
.card::before{content:"";position:absolute;inset:8px;border:1px solid rgba(169,129,76,.35);pointer-events:none;}
.card-inner{padding:38px 26px 32px;}
@media(min-width:560px){.card-inner{padding:52px 56px 44px;}}
.card-eyebrow{color:var(--gold);text-align:center;margin-bottom:6px;}
.card h2{font-family:var(--display);font-weight:500;font-size:clamp(24px,4.5vw,32px);text-align:center;margin:0 0 6px;}
.card .lede{text-align:center;color:var(--ink-soft);font-size:14.5px;margin:0 0 24px;line-height:1.55;}
.countdown{border:1px solid var(--gold-soft);background:var(--paper-2);padding:18px 16px 16px;margin-bottom:24px;text-align:center;}
.countdown-label{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;color:var(--ink-soft);margin-bottom:14px;}
.countdown-label strong{color:var(--gold);font-weight:600;}
/* Four equal columns that shrink to fit, so days/hrs/min/sec stay on one row even on a 320px-wide phone. */
.countdown-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;max-width:300px;margin:0 auto;}
.countdown-unit{min-width:0;padding:6px 2px;}
.countdown-num{display:block;font-family:var(--display);font-size:28px;font-weight:600;color:var(--ink);line-height:1;}
.countdown-unit-label{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);margin-top:5px;}
.personal-note-box{background:var(--paper-2);border-left:3px solid var(--gold);padding:14px 16px;font-family:var(--display);font-style:italic;font-size:16px;line-height:1.5;margin-bottom:26px;}
.choice-grid{display:grid;gap:14px;}
.choice-card{border:1px solid var(--gold-soft);background:#fff;padding:20px 18px;text-align:left;display:flex;align-items:center;gap:14px;width:100%;}
.choice-card .ic{width:42px;height:42px;border-radius:50%;background:var(--paper-2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:20px;color:var(--gold);}
.choice-card h3{margin:0 0 3px;font-family:var(--display);font-size:19px;font-weight:600;}
.choice-card p{margin:0;font-size:13px;color:var(--ink-soft);}
.steps{display:flex;justify-content:center;gap:10px;margin-bottom:28px;}
.step-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:13px;font-weight:600;border:1px solid var(--gold-soft);color:var(--ink-soft);background:transparent;}
.step-dot.active{background:var(--sage);border-color:var(--sage);color:var(--paper);}
.step-dot.done{background:var(--gold);border-color:var(--gold);color:var(--ink);}
.step-line{width:24px;height:1px;background:var(--gold-soft);align-self:center;margin-top:14px;}
.field{margin-bottom:18px;}
.field label{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--ink-soft);margin-bottom:7px;}
.field input[type=text],.field input[type=email],.field input[type=tel],.field textarea{width:100%;padding:12px 13px;border:1px solid var(--gold-soft);background:#fff;font-size:15.5px;color:var(--ink);border-radius:2px;}
.field input:focus,.field textarea:focus{outline:none;border-color:var(--sage);box-shadow:0 0 0 3px rgba(110,127,99,.15);}
.field textarea{resize:vertical;min-height:74px;}
.field .err{color:var(--error);font-size:12.5px;margin-top:6px;}
.field.has-err input,.field.has-err textarea{border-color:var(--error);}
.helptext{font-size:12.5px;color:var(--ink-soft);margin-top:4px;}
.attend-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--gold-soft);background:#fff;margin-bottom:10px;}
.attend-row .ev-name{font-size:14.5px;font-weight:500;}
.attend-row .ev-meta{font-size:12px;color:var(--ink-soft);margin-top:2px;}
.toggle-pair{display:flex;border:1px solid var(--gold-soft);border-radius:20px;overflow:hidden;flex-shrink:0;}
.toggle-btn{padding:7px 15px;font-size:12.5px;font-weight:600;background:#fff;border:none;color:var(--ink-soft);}
.toggle-btn.yes.on{background:var(--sage);color:#fff;}
.toggle-btn.no.on{background:#EADEDA;color:var(--error);}
.tag-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
.tag{padding:6px 13px;border:1px solid var(--gold-soft);border-radius:16px;font-size:12.5px;background:#fff;color:var(--ink-soft);font-weight:500;border-style:solid;}
.tag.on{background:var(--rose);border-color:var(--rose);color:#fff;}
.member{border:1px solid var(--gold-soft);background:var(--paper-2);padding:18px 16px;margin-bottom:16px;}
.member-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
.member-head .mname{font-family:var(--display);font-size:19px;font-weight:600;}
.remove-link{background:none;border:none;color:var(--error);font-size:12px;text-decoration:underline;padding:4px;}
.add-member-btn{width:100%;padding:13px;border:1px dashed var(--gold);background:transparent;color:var(--sage-dark);font-weight:600;font-size:13.5px;}
.btn-row{display:flex;gap:12px;margin-top:28px;}
.btn{flex:1;padding:14px 18px;border:none;font-size:14px;font-weight:600;letter-spacing:.03em;}
.btn:active{transform:scale(.98);}
.btn-primary{background:var(--sage);color:#fff;}
.btn-primary:hover{background:var(--sage-dark);}
.btn-ghost{background:transparent;color:var(--ink-soft);border:1px solid var(--gold-soft);}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-link{background:none;border:none;color:var(--sage-dark);font-size:13px;text-decoration:underline;padding:6px;}
.confirm-wrap{text-align:center;padding-top:4px;}
.stamp{width:116px;height:116px;border-radius:50%;margin:0 auto 20px;border:3px solid var(--sage);color:var(--sage);display:flex;align-items:center;justify-content:center;flex-direction:column;transform:rotate(-8deg);}
.stamp .s1{font-family:var(--display);font-weight:600;font-size:16px;}
.stamp .s2{font-size:9px;letter-spacing:.18em;text-transform:uppercase;margin-top:3px;}
.summary{background:var(--paper-2);border:1px solid var(--gold-soft);padding:16px 18px;text-align:left;margin:18px 0;}
.summary .srow{padding:8px 0;font-size:13.5px;border-bottom:1px solid rgba(169,129,76,.25);}
.summary .srow:last-child{border-bottom:none;}
.summary .slabel{color:var(--ink-soft);}
.login-stage{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:40px 16px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 50% 0%,rgba(110,127,99,.18),transparent 60%),radial-gradient(ellipse at 50% 100%,rgba(169,129,76,.14),transparent 55%),var(--paper);}
.login-stage::before,.login-stage::after{content:"";position:absolute;left:50%;top:58%;border-radius:50%;border:1px solid rgba(169,129,76,.22);transform:translate(-50%,-50%);pointer-events:none;}
.login-stage::before{width:min(1100px,170vw);height:min(1100px,170vw);}
.login-stage::after{width:min(1400px,220vw);height:min(1400px,220vw);border-color:rgba(169,129,76,.12);}
.login-box{position:relative;z-index:1;width:100%;max-width:400px;background:linear-gradient(180deg,#EEF1E8 0,#fff 42%);border:1px solid rgba(216,200,165,.7);border-radius:24px;padding:40px 32px 30px;box-shadow:0 30px 60px -30px rgba(32,43,34,.35),0 0 0 6px rgba(255,255,255,.5);text-align:center;}
.login-icon{width:56px;height:56px;margin:0 auto 20px;border-radius:16px;background:#fff;display:flex;align-items:center;justify-content:center;color:var(--ink);box-shadow:0 10px 24px -12px rgba(32,43,34,.4),inset 0 0 0 1px rgba(216,200,165,.5);}
.login-box h2{font-family:var(--display);font-weight:600;font-size:30px;margin:4px 0 6px;color:var(--ink);}
.login-sub{color:var(--ink-soft);font-size:14.5px;line-height:1.5;margin:0 0 26px;}
.login-input{display:flex;align-items:center;gap:10px;background:var(--paper-2);border:1px solid transparent;border-radius:14px;padding:0 6px 0 14px;transition:border-color .15s,box-shadow .15s;}
.login-input:focus-within{border-color:var(--sage);box-shadow:0 0 0 3px rgba(110,127,99,.15);background:#fff;}
.login-input.has-err{border-color:var(--error);}
.login-input > svg{flex:none;color:var(--ink-soft);}
.login-input input{flex:1;min-width:0;border:none;background:transparent;padding:14px 0;font-size:15.5px;color:var(--ink);outline:none;}
.login-eye{flex:none;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--ink-soft);border-radius:10px;cursor:pointer;}
.login-eye:hover{color:var(--ink);background:rgba(32,43,34,.06);}
.login-eye:focus-visible{outline:2px solid var(--sage);outline-offset:1px;}
.login-err{color:var(--error);font-size:13px;text-align:left;margin:8px 4px 0;}
.login-submit{width:100%;margin-top:22px;padding:15px 18px;border:none;border-radius:14px;background:var(--ink);color:#fff;font-size:15px;font-weight:600;letter-spacing:.02em;box-shadow:0 10px 20px -10px rgba(32,43,34,.6),inset 0 1px 0 rgba(255,255,255,.12);cursor:pointer;}
.login-submit:hover{background:#2C3A2F;}
.login-submit:active{transform:scale(.99);}
.login-submit:disabled{opacity:.6;cursor:not-allowed;}
.login-back{margin-top:16px;background:none;border:none;color:var(--ink-soft);font-size:13.5px;cursor:pointer;padding:6px;}
.login-back:hover{color:var(--ink);text-decoration:underline;}
.footer-link{position:fixed;bottom:10px;right:12px;font-size:11px;color:rgba(75,81,72,.4);background:none;border:none;text-decoration:underline;z-index:5;}
.preview-banner{position:sticky;top:0;background:var(--gold);color:var(--ink);padding:10px 16px;text-align:center;font-size:13px;font-weight:600;z-index:20;}
.preview-banner button{margin-left:10px;background:var(--ink);color:#fff;border:none;padding:5px 12px;border-radius:14px;font-size:12px;}

/* admin */
.admin-shell{min-height:100vh;min-height:100dvh;background:var(--paper-2);padding:0 0 60px;}
.admin-topbar{background:var(--ink);color:var(--paper);padding:18px 22px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;position:sticky;top:0;z-index:10;}
.admin-topbar h2{font-family:var(--display);font-weight:500;font-size:20px;margin:0;}
.admin-topbar .btn-link{color:var(--gold-soft);}
.admin-wrap{max-width:1020px;margin:0 auto;padding:26px 18px;}
.tabs{display:flex;gap:8px;margin-bottom:22px;}
.tab-btn{padding:9px 18px;border:1px solid var(--gold-soft);background:#fff;color:var(--ink-soft);font-size:13px;font-weight:600;border-radius:18px;}
.tab-btn.active{background:var(--ink);color:var(--paper);border-color:var(--ink);}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;}
.stat-card{background:#fff;border:1px solid var(--gold-soft);padding:16px;text-align:center;}
.stat-card .num{font-family:var(--display);font-size:28px;font-weight:600;color:var(--sage-dark);}
.stat-card .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-soft);margin-top:2px;}
.admin-controls{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
.admin-controls input{flex:1;min-width:180px;padding:10px 12px;border:1px solid var(--gold-soft);font-size:14px;}
.row-card{background:#fff;border:1px solid var(--gold-soft);margin-bottom:10px;}
.row-head{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;gap:10px;flex-wrap:wrap;}
.row-head .rname{font-weight:600;font-size:15px;}
.row-head .rmeta{font-size:12px;color:var(--ink-soft);margin-top:2px;}
.pill{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap;}
.pill.yes{background:#E4EBDF;color:var(--sage-dark);}
.pill.no{background:#F3E1DD;color:var(--error);}
.pill.pending{background:#EFE7D6;color:var(--gold);}
.row-body{padding:0 16px 16px;border-top:1px solid var(--paper-2);}
.row-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.row-actions button{padding:6px 12px;font-size:12px;border:1px solid var(--gold-soft);background:var(--paper-2);border-radius:14px;color:var(--ink-soft);font-weight:600;}
.member-detail{padding:10px 0;border-bottom:1px dashed var(--gold-soft);font-size:13.5px;}
.member-detail:last-child{border-bottom:none;}
.empty-state{text-align:center;padding:60px 20px;color:var(--ink-soft);}
.empty-state .em-ic{font-family:var(--display);font-size:44px;color:var(--gold-soft);margin-bottom:10px;}
.checkbox-row{display:flex;align-items:center;gap:8px;padding:9px 0;font-size:14px;}
.qr-modal-backdrop{position:fixed;inset:0;background:rgba(32,43,34,.6);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;}
.qr-modal{background:#fff;border-radius:4px;padding:28px;max-width:340px;width:100%;text-align:center;box-shadow:var(--shadow);}
.qr-modal img{width:100%;max-width:220px;border:1px solid var(--gold-soft);padding:8px;background:#fff;}
.link-box{background:var(--paper-2);border:1px solid var(--gold-soft);padding:9px 11px;font-size:12px;word-break:break-all;margin:14px 0;text-align:left;}
.spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;vertical-align:-3px;margin-right:6px;}
@keyframes spin{to{transform:rotate(360deg);}}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--paper);padding:12px 20px;border-radius:4px;font-size:13.5px;box-shadow:var(--shadow);z-index:60;}
@media(prefers-reduced-motion:reduce){.seal{transition:none;}}

/* seat map */
.seating-layout{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;}
.seating-sidebar{width:220px;flex-shrink:0;background:#fff;border:1px solid var(--gold-soft);padding:14px;max-height:640px;overflow-y:auto;}
.seating-main{flex:1;min-width:280px;}
.seating-sidebar h4{margin:0 0 4px;font-family:var(--display);font-size:16px;font-weight:600;}
.seating-sidebar .helptext{margin:0 0 12px;}
.household-group{margin-bottom:14px;}
.household-group .hname{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:var(--ink-soft);margin-bottom:6px;}
.guest-chip{display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:6px;border:1px solid var(--gold-soft);background:var(--paper-2);font-size:13px;font-weight:500;cursor:grab;border-radius:3px;}
.guest-chip:active{cursor:grabbing;}
.guest-chip.armed{background:var(--sage);color:#fff;border-color:var(--sage);}
.seating-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.seating-canvas-wrap{position:relative;width:100%;border:1px solid var(--gold-soft);background:#fff;}
.seating-canvas-wrap canvas{display:block;width:100%;height:auto;touch-action:none;}
.seating-canvas-wrap.mode-3d{aspect-ratio:1000/700;}
.seating-canvas-wrap.mode-3d canvas{width:100%;height:100%;}
.view-toggle{display:inline-flex;border:1px solid var(--gold-soft);border-radius:3px;overflow:hidden;}
.view-toggle button{padding:4px 12px;font-size:11.5px;font-weight:600;letter-spacing:.04em;background:#fff;color:var(--ink-soft);border:none;}
.view-toggle button.active{background:var(--sage);color:var(--paper);}
.seating-canvas-wrap.dragover{outline:3px solid var(--sage);outline-offset:-3px;}
.table-editor-panel{background:#fff;border:1px solid var(--gold-soft);padding:16px 18px;margin-top:14px;}
.table-editor-panel h4{margin:0 0 14px;font-family:var(--display);font-size:18px;}
.table-editor-row{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.table-editor-row .field{flex:1;min-width:120px;margin-bottom:0;}
.seated-list{list-style:none;margin:0 0 14px;padding:0;}
.seated-list li{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--gold-soft);font-size:13.5px;}
.seated-list li:last-child{border-bottom:none;}
.unseat-btn{background:none;border:none;color:var(--error);font-size:12px;text-decoration:underline;padding:2px;}
.seat-row{padding:12px 10px !important;}
.seat-row.empty{color:var(--ink-soft);}
.seat-row.empty:hover{background:var(--paper-2);cursor:pointer;}
.seat-row.filled{font-weight:500;}
.zoom-controls{position:absolute;bottom:10px;right:10px;display:flex;flex-direction:column;gap:6px;}
.zoom-controls button{width:34px;height:34px;border-radius:50%;border:1px solid var(--gold-soft);background:#fff;font-size:16px;font-weight:600;color:var(--ink);box-shadow:0 4px 10px rgba(0,0,0,.12);}
.seat-legend{margin-top:14px;}
.seat-legend-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13.5px;}
.seat-legend-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;}
.seat-empty{text-align:center;padding:50px 20px;color:var(--ink-soft);}
.seat-empty .em-ic{font-family:var(--display);font-size:40px;color:var(--gold-soft);margin-bottom:10px;}
@media(max-width:720px){.seating-sidebar{width:100%;max-height:220px;}}

/* venue display */
.venue-display{min-height:100vh;min-height:100dvh;background:var(--paper);}
.venue-header{background:radial-gradient(ellipse at 50% -20%,rgba(169,129,76,.22),transparent 60%),var(--ink);color:var(--paper);text-align:center;padding:48px 40px 34px;position:relative;overflow:hidden;}
.venue-header::before{content:"";position:absolute;inset:14px;border:1px solid rgba(216,200,165,.32);pointer-events:none;}
.venue-header .eyebrow{font-size:12px;letter-spacing:.26em;text-transform:uppercase;font-weight:600;color:var(--gold-soft);margin:0 0 14px;}
.venue-header h1{font-family:var(--display);font-weight:500;font-style:italic;font-size:clamp(34px,5vw,54px);line-height:1.05;margin:0 0 8px;}
.venue-header .sub{font-family:var(--display);font-size:clamp(14px,1.6vw,17px);color:var(--gold-soft);margin:0;}
.venue-exit{position:absolute;top:20px;right:24px;background:none;border:1px solid rgba(216,200,165,.5);color:var(--gold-soft);font-size:12.5px;padding:8px 14px;border-radius:16px;}
.venue-main{max-width:1360px;margin:0 auto;display:grid;grid-template-columns:1.15fr 1fr;gap:0;}
.venue-panel{padding:36px 40px;}
.venue-panel + .venue-panel{border-left:1px solid var(--gold-soft);}
.venue-panel .panel-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px;gap:16px;}
.venue-panel .panel-head h2{font-family:var(--display);font-weight:600;font-size:24px;margin:0;}
.venue-panel .panel-head .count{font-size:12px;color:var(--ink-soft);white-space:nowrap;}
.venue-search input{width:100%;font-size:15px;padding:11px 16px;border:1px solid var(--gold-soft);border-radius:3px;margin-bottom:22px;background:#fff;}
.venue-search input:focus{outline:none;border-color:var(--sage);box-shadow:0 0 0 3px rgba(110,127,99,.15);}
.venue-columns{column-count:2;column-gap:32px;}
.venue-columns .letter-group{break-inside:avoid;margin-bottom:18px;}
.venue-columns .letter-group h3{font-family:var(--display);font-size:14px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.14em;margin:0 0 6px;border-bottom:1px solid var(--gold-soft);padding-bottom:3px;}
.venue-guest-row{display:flex;width:100%;align-items:baseline;gap:6px;padding:4px 0;font-size:13.5px;background:none;border:none;text-align:left;color:var(--ink);}
.venue-guest-row .guest-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.venue-guest-row .leader{flex:1;border-bottom:1px dotted var(--gold-soft);height:1em;transform:translateY(-3px);min-width:8px;}
.venue-guest-row .badge{flex-shrink:0;font-size:11px;font-weight:600;color:var(--ink);background:var(--paper-2);border:1px solid var(--gold-soft);border-radius:11px;padding:2.5px 9px;}
.venue-guest-row.active .badge{background:var(--gold);color:#fff;border-color:var(--gold);}
.venue-guest-row.active .guest-name{color:var(--sage-dark);font-weight:600;}
.no-match{text-align:center;color:var(--ink-soft);font-style:italic;padding:20px 0;}
@media(max-width:880px){.venue-main{grid-template-columns:1fr;}.venue-panel + .venue-panel{border-left:none;border-top:1px solid var(--gold-soft);}.venue-columns{column-count:1;}}
/* Phone-width fixes only — .venue-exit and .zoom-controls keep their
   desktop absolute-overlay positioning above this breakpoint untouched. */
@media(max-width:600px){
  .venue-header{padding-top:20px;}
  .venue-exit{position:static;display:block;margin:0 auto 18px;width:max-content;}
  .seating-canvas-wrap .zoom-controls{position:static;flex-direction:row;justify-content:center;margin-top:10px;}
}
/* Guest: per-event RSVP deadline chip (Details page) */
.deadline-chip{display:inline-block;margin-top:7px;font-size:12px;font-weight:600;color:var(--gold);background:#F6EEDC;border:1px solid var(--gold-soft);border-radius:12px;padding:3px 10px;}
.deadline-chip.passed{color:var(--ink-soft);background:var(--paper-2);}
/* Guest: admin-set announcement card on the menu page */
.announcement{background:#fff;border:1px solid var(--gold-soft);border-radius:10px;padding:14px 16px;margin-bottom:18px;text-align:left;}
.announcement-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:var(--gold);margin-bottom:6px;}
.announcement-body{font-size:14.5px;line-height:1.55;white-space:pre-line;overflow-wrap:anywhere;}
/* Guest: "N days left to RSVP" nudge on the menu page */
.reminder-banner{display:flex;flex-wrap:wrap;align-items:center;gap:12px;background:#FBF1DE;border:1px solid var(--gold-soft);border-left:3px solid var(--gold);padding:14px 16px;margin-bottom:20px;font-size:14px;line-height:1.5;}
.reminder-lines{flex:1 1 220px;}
.reminder-lines > div + div{margin-top:4px;}
.reminder-cta{flex:none;min-height:44px;padding:0 18px;border:none;border-radius:22px;background:var(--ink);color:#fff;font-size:14px;font-weight:600;}
/* Admin: Settings accordion (see AdminSettings) */
.settings-intro{margin-bottom:14px;}
.settings-intro h3{font-family:var(--display);font-size:28px;font-weight:600;margin:0 0 4px;}
.settings-intro p{margin:0;font-size:13.5px;color:var(--ink-soft);line-height:1.5;}
.acc{background:#fff;border:1px solid var(--gold-soft);border-radius:14px;margin-bottom:12px;}
.acc-h{margin:0;font:inherit;}
.acc-head{display:flex;align-items:center;gap:12px;width:100%;min-height:72px;padding:14px 16px;background:none;border:0;border-radius:14px;text-align:left;color:var(--ink);font:inherit;cursor:pointer;}
.acc-head:focus-visible{outline:2px solid var(--sage);outline-offset:-2px;}
.acc-ic{flex:none;width:40px;height:40px;border-radius:50%;background:var(--paper-2);display:flex;align-items:center;justify-content:center;color:var(--gold);}
.acc-text{flex:1;min-width:0;}
.acc-title{display:block;font-family:var(--display);font-size:21px;font-weight:600;line-height:1.2;}
.acc-sum{display:block;font-size:12.5px;color:var(--ink-soft);margin-top:3px;line-height:1.4;overflow-wrap:anywhere;}
.acc-dirty{display:inline-block;margin-left:8px;vertical-align:3px;font-family:var(--body);font-size:11px;font-weight:600;color:var(--gold);background:#F6EEDC;border:1px solid var(--gold-soft);border-radius:10px;padding:1px 8px;}
.acc-chev{flex:none;color:var(--ink-soft);transition:transform .2s;}
.acc.open .acc-chev{transform:rotate(180deg);}
@media(prefers-reduced-motion:reduce){.acc-chev{transition:none;}}
.acc-body{padding:0 16px 16px;}
.acc .settings-card{background:var(--paper);}
.settings-events-grid{display:grid;gap:14px;}
@media(min-width:600px){.acc-head{padding:16px 22px;}.acc-body{padding:0 22px 22px;}}
@media(min-width:860px){.settings-events-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
.settings-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 10px;}
/* Narrow phones: date and time each get a full row, so the date isn't squeezed into its picker icon. */
@media(max-width:439px){.settings-two{grid-template-columns:1fr;}}
/* Inside the white accordion cards the floating Save bar fades to white, not the page's beige. */
.acc .settings-actions.dirty{background:linear-gradient(rgba(255,255,255,0),#fff 35%);}
.settings-label-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px;}
.settings-label-row label{margin-bottom:0;}
.settings-badge{font-size:11.5px;font-weight:600;color:var(--sage-dark);background:#E4EBDF;border-radius:10px;padding:2px 9px;white-space:nowrap;}
.settings-preview{background:#fff;border-radius:10px;padding:10px 12px;font-size:13.5px;line-height:1.45;}
.settings-preview span{color:var(--ink-soft);}
.settings-item-actions{display:flex;flex-wrap:wrap;gap:8px;}
.settings-item-actions .settings-clear{min-height:40px;}
.settings-clear:disabled{opacity:.45;cursor:not-allowed;}
.settings-clear.danger{color:var(--error);}
.settings-add{width:100%;min-height:46px;margin-bottom:6px;border:1px dashed var(--gold-soft);border-radius:12px;background:#fff;color:var(--ink-soft);font-size:14px;font-weight:600;}
/* Admin: Email guests panel */
.email-panel{padding:18px;margin-bottom:22px;border-radius:12px;}
.email-panel h3{font-family:var(--display);font-size:22px;font-weight:600;margin:0 0 12px;}
.segmented{display:flex;background:var(--paper-2);border-radius:12px;padding:4px;margin-bottom:14px;}
.segmented button{flex:1;min-height:40px;border:none;background:none;border-radius:9px;font-size:14px;font-weight:600;color:var(--ink-soft);}
.segmented button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(32,43,34,.15);}
select.settings-input{-webkit-appearance:auto;appearance:auto;}
.email-summary{font-size:13.5px;margin-top:8px;color:var(--ink-soft);}
.email-summary strong{color:var(--ink);}
.email-skipped{font-size:13px;margin-top:6px;color:var(--ink-soft);}
.email-skipped summary{cursor:pointer;color:var(--sage-dark);text-decoration:underline;min-height:32px;display:flex;align-items:center;}
.email-list{margin:6px 0 0;padding-left:20px;font-size:13px;line-height:1.6;}
.email-send{width:100%;min-height:48px;border-radius:12px;}
@media(min-width:600px){.email-send{width:auto;min-width:240px;}}
.email-status{margin-top:14px;padding:12px 14px;background:var(--paper-2);border-radius:10px;font-size:14px;}
/* 3D view placeholder while its code downloads (FloorPlan3D is lazy-loaded) */
.fp3d-loading{display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:200px;color:var(--ink-soft);font-size:14px;}
/* Admin tabs scroll sideways on a phone rather than wrapping/overflowing */
.tabs{overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.tabs::-webkit-scrollbar{display:none;}
.tab-btn{flex:none;white-space:nowrap;}
/* Admin: Settings tab. Inputs are 16px so iOS Safari doesn't zoom the page on focus. */
.settings-section{margin-bottom:30px;}
.settings-section > h3{font-family:var(--display);font-size:24px;font-weight:600;margin:0 0 6px;}
.settings-help{font-size:13.5px;color:var(--ink-soft);line-height:1.55;margin:0 0 16px;}
.settings-card{background:#fff;border:1px solid var(--gold-soft);border-radius:12px;padding:16px;margin-bottom:14px;}
.settings-card-head{margin-bottom:12px;}
.settings-ev-name{font-weight:600;font-size:16px;}
.settings-ev-meta{font-size:12.5px;color:var(--ink-soft);margin-top:2px;}
.settings-grid{display:grid;grid-template-columns:1fr;gap:0 14px;}
@media(min-width:600px){.settings-grid{grid-template-columns:1fr 1fr;}}
.settings-card .field{margin-bottom:14px;}
.settings-input{display:block;width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--gold-soft);border-radius:10px;background:#fff;font-size:16px;color:var(--ink);-webkit-appearance:none;appearance:none;}
.field input.settings-input,.field textarea.settings-input,.field select.settings-input{border-radius:10px;font-size:16px;padding:10px 12px;}
.settings-input:focus{outline:none;border-color:var(--sage);box-shadow:0 0 0 3px rgba(110,127,99,.15);}
.settings-input::-webkit-date-and-time-value{text-align:left;}
textarea.settings-input{min-height:96px;resize:vertical;line-height:1.5;}
.settings-input-row{display:flex;gap:8px;align-items:center;}
.settings-input-row .settings-input{flex:1;min-width:0;}
.settings-clear{flex:none;min-height:46px;padding:0 12px;border:1px solid var(--gold-soft);border-radius:10px;background:var(--paper-2);color:var(--ink-soft);font-size:13px;font-weight:600;}
.settings-derived{min-height:46px;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;padding:12px;background:var(--paper-2);border-radius:10px;font-weight:600;font-size:16px;}
.settings-derived span{font-weight:400;font-size:13px;color:var(--ink-soft);}
.settings-warn{color:var(--error);font-size:12.5px;margin-top:6px;}
.headcount{border-top:1px dashed var(--gold-soft);padding-top:12px;}
.headcount-row{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;font-size:14px;}
.headcount-row .sub{color:var(--ink-soft);font-size:12.5px;}
.headcount-bar{height:8px;background:var(--paper-2);border-radius:4px;overflow:hidden;margin-top:9px;}
.headcount-bar > div{height:100%;background:var(--sage);border-radius:4px;}
.headcount-bar > div.over{background:var(--error);}
.settings-actions{padding:12px 0 4px;}
/* Only pinned to the bottom of the screen while there are unsaved changes, so it never covers content otherwise. */
.settings-actions.dirty{position:sticky;bottom:0;background:linear-gradient(rgba(243,237,223,0),var(--paper-2) 35%);z-index:2;}
.settings-actions .btn{width:100%;min-height:48px;border-radius:12px;}
@media(min-width:600px){.settings-actions .btn{width:auto;min-width:220px;}}
`;

/* =========================================================
   VIEW COMPONENTS
   Defined at module scope (not inside App) on purpose: a
   component defined inside another component's render body
   gets a brand-new function identity every render, which
   makes React tear down and remount its whole DOM subtree
   (losing focus, mid-typing) instead of just updating it.
   These take `state` and an `actions` bag (all the handlers
   from App) as props instead of closing over them.
   ========================================================= */

function StepDots({ current }) {
  const labels = ["Details", "Events & Dietary", "Review"];
  return (
    <div className="steps">
      {labels.map((l, i) => {
        const n = i + 1;
        const cls = n < current ? "done" : n === current ? "active" : "";
        return (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={`step-dot ${cls}`} title={l}>{n}</span>
            {i < labels.length - 1 && <span className="step-line" />}
          </span>
        );
      })}
    </div>
  );
}

function NoInvite() {
  return (
    <div className="hero">
      <div className="eyebrow">{CONFIG.coupleNames}</div>
      <h1>You're Invited</h1>
      <div className="sub">Engagement Party &amp; Wedding</div>
      <p style={{ maxWidth: 380, fontSize: 14, color: "var(--gold-soft)", lineHeight: 1.6 }}>
        This RSVP is personal to each guest. Please use the link or QR code from your invitation to open it —
        or get in touch with {CONFIG.coupleNames} if you can't find yours.
      </p>
    </div>
  );
}

function InvalidInvite() {
  return (
    <div className="hero">
      <div className="eyebrow">{CONFIG.coupleNames}</div>
      <h1 style={{ fontSize: "clamp(28px,6vw,44px)" }}>Invite not found</h1>
      <p style={{ maxWidth: 380, fontSize: 14, color: "var(--gold-soft)", lineHeight: 1.6 }}>
        We couldn't match this link to an invitation. Double-check the QR code or link you were sent, or reach out
        to {CONFIG.coupleNames} directly.
      </p>
    </div>
  );
}

function GuestLanding({ state, actions }) {
  const rec = state.currentRecord;
  return (
    <div className="hero">
      {state.previewMode && (
        <div className="preview-banner" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          Previewing {rec.householdName}'s invite <button onClick={actions.exitPreview}>Exit preview</button>
        </div>
      )}
      <div className="eyebrow">Dear {rec.householdName}</div>
      <h1>You're Invited</h1>
      <div className="sub">{rec.invitedEvents.map(id => eventById(id)?.name).join(" & ")}</div>
      {rec.personalNote && <p className="note-quote">&ldquo;{rec.personalNote}&rdquo;</p>}
      <div>
        <button className="seal" onClick={() => actions.patch({ view: "guest-menu" })}>{rec.householdName.split(/[&,]/)[0].trim()[0] || "♥"}</button>
        <div className="seal-caption">Break the seal to continue</div>
      </div>
    </div>
  );
}

function GuestMenu({ state, actions }) {
  const rec = state.currentRecord;
  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <div className="card-eyebrow eyebrow" style={{ textAlign: "center" }}>{rec.householdName}</div>
      <GuestAnnouncement state={state} />
      <RsvpReminderBanner state={state} actions={actions} />
      <CountdownWidget eventIds={rec.invitedEvents} />
      <h2>Welcome</h2>
      <p className="lede">We can't wait to celebrate with you. What would you like to do?</p>
      <div className="choice-grid">
        <button className="choice-card" onClick={actions.startGuestForm}>
          <div className="ic">✎</div>
          <div><h3>RSVP</h3><p>{rec.response ? "View or update your response." : "Let us know who's coming and any dietary needs."}</p></div>
        </button>
        <button className="choice-card" onClick={() => actions.patch({ view: "guest-location" })}>
          <div className="ic">⚑</div>
          <div><h3>Location</h3><p>Venue details and directions.</p></div>
        </button>
        <button className="choice-card" onClick={() => actions.patch({ view: "guest-details" })}>
          <div className="ic">✦</div>
          <div><h3>Details</h3><p>Dates, times, dress code and other info.</p></div>
        </button>
        {invitedToSeatedEvent(rec) && (
          <button className="choice-card" onClick={() => actions.patch({ view: "guest-seating" })}>
            <div className="ic">◈</div>
            <div><h3>Find My Seat</h3><p>See your table for the reception.</p></div>
          </button>
        )}
      </div>
      {state.previewMode && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="btn-link" onClick={actions.exitPreview}>Exit preview</button>
        </div>
      )}
    </div></div></div>
  );
}

function GuestLocation({ state, actions }) {
  const rec = state.currentRecord;
  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <h2>Location &amp; Directions</h2>
      <p className="lede">Where to find us.</p>
      {rec.invitedEvents.map(id => {
        const ev = eventById(id);
        return (
          <div className="member" style={{ marginBottom: 20 }} key={id}>
            <div className="member-head"><span className="mname">{ev.name}</span></div>
            <div className="ev-meta" style={{ marginBottom: 12 }}>{eventDateText(ev)} · {eventTimeText(ev)}</div>
            <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: ev.address ? 4 : 12 }}>{ev.venue}</div>
            {ev.address && <div className="ev-meta" style={{ marginBottom: 12 }}>{ev.address}</div>}
            <div style={{ border: "1px solid var(--gold-soft)", overflow: "hidden", marginBottom: 12 }}>
              <iframe title={`Map to ${ev.venue}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery(ev))}&z=14&output=embed`}
                width="100%" height="220" style={{ border: 0, display: "block" }} loading="lazy" />
            </div>
            <a className="btn btn-ghost" style={{ display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery(ev))}`} target="_blank" rel="noopener noreferrer">Get Directions</a>
          </div>
        );
      })}
      <div style={{ textAlign: "center", marginTop: 10 }}>
        <button className="btn-link" onClick={() => actions.patch({ view: "guest-menu" })}>&larr; Back</button>
      </div>
    </div></div></div>
  );
}

// Guests who haven't replied see a nudge on their menu page once a deadline
// is this many days away or closer (and only until it passes).
const REMINDER_WINDOW_DAYS = 7;

function rsvpReminders(rec, site) {
  if (rec.response) return [];
  return rec.invitedEvents
    .map(id => ({ ev: eventById(id), ymd: deadlineFor(site, id) }))
    .filter(x => x.ev && x.ymd)
    .map(x => ({ ...x, days: daysUntilYmd(x.ymd, x.ev.timeZone) }))
    .filter(x => x.days >= 0 && x.days <= REMINDER_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);
}

function activeAnnouncement(site) {
  const a = site?.announcement;
  if (!a?.message) return null;
  if (a.until && daysUntilYmd(a.until) < 0) return null;
  return a.message;
}

function GuestAnnouncement({ state }) {
  const message = activeAnnouncement(state.siteSettings);
  if (!message) return null;
  return (
    <div className="announcement" role="note">
      <div className="announcement-eyebrow">A note from {CONFIG.coupleNames}</div>
      <div className="announcement-body">{message}</div>
    </div>
  );
}

function RsvpReminderBanner({ state, actions }) {
  const items = rsvpReminders(state.currentRecord, state.siteSettings);
  if (items.length === 0) return null;
  return (
    <div className="reminder-banner" role="status">
      <div className="reminder-lines">
        {items.map(x => (
          <div key={x.ev.id}>
            {x.days === 0
              ? <>Today is the last day to RSVP for the <strong>{x.ev.name}</strong>.</>
              : <><strong>{x.days} day{x.days === 1 ? "" : "s"} left</strong> to RSVP for the {x.ev.name} (by {formatYmd(x.ymd)}).</>}
          </div>
        ))}
      </div>
      <button className="reminder-cta" onClick={actions.startGuestForm}>RSVP now</button>
    </div>
  );
}

function DeadlineChip({ ymd, tz }) {
  if (!ymd) return null;
  const passed = daysUntilYmd(ymd, tz) < 0;
  return (
    <div className={`deadline-chip ${passed ? "passed" : ""}`}>
      {passed ? `RSVP date passed (${formatYmd(ymd)}) — late replies welcome` : `RSVP by ${formatYmd(ymd)}`}
    </div>
  );
}

function GuestDetails({ state, actions }) {
  const rec = state.currentRecord;
  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <h2>Event Details</h2>
      <p className="lede">Everything you need to know.</p>
      <div className="summary">
        {rec.invitedEvents.map(id => {
          const ev = eventById(id);
          return (
            <div className="srow" key={id}>
              <div style={{ fontWeight: 600 }}>{ev.name}</div>
              <div className="slabel" style={{ fontSize: 12.5 }}>{eventDateText(ev)} · {eventTimeText(ev)}</div>
              <div className="slabel" style={{ fontSize: 12.5 }}>{ev.venue}</div>
              <DeadlineChip ymd={deadlineFor(state.siteSettings, id)} tz={ev.timeZone} />
            </div>
          );
        })}
      </div>
      {guestInfoList().length > 0 && (
        <div className="summary">
          {guestInfoList().map(d => (
            <div className="srow" key={d.title}>
              <div style={{ fontWeight: 600 }}>{d.title}</div>
              <div className="slabel" style={{ fontSize: 12.5 }}>{d.body}</div>
            </div>
          ))}
        </div>
      )}
      {rec.personalNote && <p className="note-quote" style={{ color: "var(--ink)", margin: "0 0 20px" }}>&ldquo;{rec.personalNote}&rdquo;</p>}
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <button className="btn-link" onClick={() => actions.patch({ view: "guest-menu" })}>&larr; Back</button>
      </div>
    </div></div></div>
  );
}

function GuestSeating({ state, actions }) {
  const [seating, setSeating] = useState(null);
  const [transform, setTransform] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [fitted, setFitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function fetchSeating() {
      apiGetSeating(state.inviteCode).then(data => { if (!cancelled) setSeating(data || { tables: [], mySeats: [], objects: [] }); });
    }
    fetchSeating();
    // Light polling so a last-minute reassignment on the day shows up even if
    // this page has been open since the morning — see the admin tab's polling too.
    const id = setInterval(fetchSeating, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [state.inviteCode]);

  // The room now includes every table, not just the guest's own — but the
  // default/recenter view should still zoom to *their* seat, not fit the
  // whole room, or "find your seat" turns back into "find it yourself."
  const myTableIds = new Set((seating?.mySeats || []).map(s => s.tableId));
  const myTables = (seating?.tables || []).filter(t => myTableIds.has(t.id));

  useEffect(() => {
    if (seating && myTables.length > 0 && !fitted) {
      setTransform(fitSeatTransform(myTables));
      setFitted(true);
    }
  }, [seating, fitted]);

  // Colors keyed by sorted table id (not array order) so they stay stable across polls.
  const highlightColors = {};
  const highlightSeatIndices = {};
  const sortedTableIds = [...myTableIds].sort();
  sortedTableIds.forEach((tid, i) => { highlightColors[tid] = colorForIndex(i); });
  (seating?.mySeats || []).forEach(s => {
    if (!highlightSeatIndices[s.tableId]) highlightSeatIndices[s.tableId] = new Set();
    highlightSeatIndices[s.tableId].add(s.seatIndex);
  });

  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <h2>Find Your Seat</h2>
      <p className="lede">Your reception table for the day.</p>
      {seating === null && <p className="helptext" style={{ textAlign: "center" }}>Loading…</p>}
      {seating && seating.locked && (
        <div className="seat-empty"><div className="em-ic">✦</div>
          {seating.revealAt
            ? `Seating opens ${new Date(seating.revealAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} — check back then!`
            : "Seating hasn't opened yet — check back closer to the big day!"}
        </div>
      )}
      {seating && !seating.locked && seating.mySeats.length === 0 && (
        <div className="seat-empty"><div className="em-ic">✦</div>Seating hasn't been finalised yet — check back closer to the big day!</div>
      )}
      {seating && seating.mySeats.length > 0 && (
        <>
          <div className="seating-canvas-wrap">
            <SeatingCanvas tables={seating.tables} objects={seating.objects} highlightColors={highlightColors} highlightSeatIndices={highlightSeatIndices} dimOthers viewTransform={transform} onViewTransformChange={setTransform} />
            <div className="zoom-controls">
              <button onClick={() => setTransform(t => zoomSeatTransform(t, 1.25))} aria-label="Zoom in">+</button>
              <button onClick={() => setTransform(t => zoomSeatTransform(t, 1 / 1.25))} aria-label="Zoom out">−</button>
              <button onClick={() => setTransform(fitSeatTransform(myTables))} aria-label="Recenter">⦿</button>
            </div>
          </div>
          <div className="seat-legend">
            {seating.mySeats.map(s => {
              const t = seating.tables.find(tt => tt.id === s.tableId);
              return (
                <div className="seat-legend-row" key={s.memberId}>
                  <span className="seat-legend-dot" style={{ background: highlightColors[s.tableId] }} />
                  <span>{s.memberName} — <strong>{t ? t.label : "Table"}</strong>, seat {s.seatIndex + 1}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <button className="btn-link" onClick={() => actions.patch({ view: "guest-menu" })}>&larr; Back</button>
      </div>
    </div></div></div>
  );
}

function GuestFormStep1({ state, actions }) {
  const d = state.draft, e = state.errors, rec = state.currentRecord;
  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <div className="card-eyebrow eyebrow" style={{ textAlign: "center" }}>{rec.householdName}</div>
      <h2>Confirm your details</h2>
      <p className="lede">{rsvpDeadlineSentence(rec.invitedEvents, state.siteSettings) || "Let us know who's coming."}</p>
      <StepDots current={1} />
      {d.members.map((m, i) => (
        <div className="field" key={m.id} style={i === 0 ? {} : { marginBottom: 10 }}>
          <label>{i === 0 ? "Guest 1" : `Guest ${i + 1}`}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={m.name} placeholder="Guest name"
              onChange={ev => actions.updateMember(i, "name", ev.target.value)} />
            {i >= rec.members.length && (
              <button className="remove-link" onClick={() => actions.removeExtraGuest(i)}>Remove</button>
            )}
          </div>
          {e["m" + i] && <div className="err">{e["m" + i]}</div>}
        </div>
      ))}
      {rec.allowPlusOne && (
        <button className="add-member-btn" onClick={actions.addExtraGuest} style={{ marginBottom: 20 }}>+ Add a guest</button>
      )}
      <div className={`field ${e.email ? "has-err" : ""}`}>
        <label>Email address</label>
        <input type="email" value={d.contactEmail} placeholder="you@example.com"
          onChange={ev => actions.updateDraft("contactEmail", ev.target.value)} />
        {e.email ? <div className="err">{e.email}</div> : <div className="helptext">So we can reach you if plans change.</div>}
      </div>
      <div className="field">
        <label>Phone (optional)</label>
        <input type="tel" value={d.contactPhone} placeholder="04xx xxx xxx"
          onChange={ev => actions.updateDraft("contactPhone", ev.target.value)} />
      </div>
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={() => actions.patch({ view: "guest-menu" })}>Back</button>
        <button className="btn btn-primary" onClick={() => {
          const errs = actions.validateGuestStep1();
          if (Object.keys(errs).length) { actions.patch({ errors: errs }); return; }
          actions.patch({ step: 2, errors: {} });
        }}>Continue</button>
      </div>
    </div></div></div>
  );
}

function GuestFormStep2({ state, actions }) {
  const d = state.draft, rec = state.currentRecord;
  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <h2>Events &amp; dietary needs</h2>
      <p className="lede">You're invited to the following — let us know who's coming and any dietary requirements.</p>
      <StepDots current={2} />
      {d.members.map((m, i) => (
        <div className="member" key={m.id}>
          <div className="member-head"><span className="mname">{m.name || `Guest ${i + 1}`}</span></div>
          {rec.invitedEvents.map(id => {
            const ev = eventById(id);
            return (
              <div className="attend-row" key={id}>
                <div>
                  <div className="ev-name">{ev.name}</div>
                  <div className="ev-meta">{eventDateText(ev)} · {ev.venue}</div>
                </div>
                <div className="toggle-pair">
                  <button className={`toggle-btn yes ${m.attending[id] ? "on" : ""}`} onClick={() => actions.toggleAttend(i, id)}>Yes</button>
                  <button className={`toggle-btn no ${!m.attending[id] ? "on" : ""}`} onClick={() => actions.toggleAttend(i, id)}>No</button>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", marginBottom: 8 }}>Dietary requirements</label>
            <div className="tag-row">
              {CONFIG.dietaryOptions.map(tag => (
                <button key={tag} className={`tag ${m.dietaryTags.includes(tag) ? "on" : ""}`} onClick={() => actions.toggleDiet(i, tag)}>{tag}</button>
              ))}
            </div>
            <textarea placeholder="Any details we should know…" value={m.dietaryNote}
              onChange={ev => actions.updateMember(i, "dietaryNote", ev.target.value)} />
          </div>
        </div>
      ))}
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={() => actions.patch({ step: 1 })}>Back</button>
        <button className="btn btn-primary" onClick={() => actions.patch({ step: 3 })}>Continue</button>
      </div>
    </div></div></div>
  );
}

function GuestFormStep3({ state, actions }) {
  const d = state.draft, rec = state.currentRecord;
  return (
    <div className="stage"><div className="card"><div className="card-inner">
      <h2>Review &amp; send</h2>
      <p className="lede">Please check everything before sending.</p>
      <StepDots current={3} />
      <div className="summary">
        <div className="srow"><span className="slabel">Email</span><br />{d.contactEmail}</div>
        {d.contactPhone && <div className="srow"><span className="slabel">Phone</span><br />{d.contactPhone}</div>}
      </div>
      <div className="summary">
        {d.members.map(m => {
          const diet = [...m.dietaryTags];
          const dietStr = diet.length ? diet.join(", ") + (m.dietaryNote ? " — " + m.dietaryNote : "") : (m.dietaryNote || "None specified");
          return (
            <div className="srow" key={m.id}>
              <div style={{ fontWeight: 600 }}>{m.name}</div>
              <div className="slabel" style={{ fontSize: 12.5 }}>
                {rec.invitedEvents.map(id => `${eventById(id).name}: ${m.attending[id] ? "Attending" : "Not attending"}`).join(" · ")}
              </div>
              <div className="slabel" style={{ fontSize: 12.5 }}>Dietary: {dietStr}</div>
            </div>
          );
        })}
      </div>
      <div className="field">
        <label>Message for {CONFIG.coupleNames.split("&")[0].trim()} &amp; {CONFIG.coupleNames.split("&")[1]?.trim()} (optional)</label>
        <textarea placeholder="Song requests, well wishes, anything else…" value={d.notes}
          onChange={ev => actions.updateDraft("notes", ev.target.value)} />
      </div>
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={() => actions.patch({ step: 2 })}>Back</button>
        <button className="btn btn-primary" onClick={actions.submitGuestRSVP} disabled={state.loading}>
          {state.loading ? <><span className="spinner" />Sending…</> : (rec.response ? "Update RSVP" : "Send RSVP")}
        </button>
      </div>
    </div></div></div>
  );
}

function GuestConfirm({ state }) {
  const rec = state.currentRecord;
  const anyYes = rec.response.members.some(m => rec.invitedEvents.some(id => m.attending[id]));
  return (
    <div className="stage"><div className="card"><div className="card-inner confirm-wrap">
      <div className="stamp"><div className="s1">RSVP</div><div className="s2">Confirmed</div></div>
      <h2>Thank you!</h2>
      <p className="lede">{anyYes ? "We can't wait to celebrate with you." : "Thank you for letting us know — you'll be missed."}</p>
      <div className="summary" style={{ textAlign: "left" }}>
        {rec.response.members.map(m => (
          <div className="srow" key={m.id}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{m.name}</span>
              <span className="slabel">{rec.invitedEvents.filter(id => m.attending[id]).map(id => eventById(id).name).join(", ") || "Not attending"}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="helptext">You can reopen this same link anytime to update your response.</p>
    </div></div></div>
  );
}

function AdminLogin({ state, actions }) {
  const [showPassword, setShowPassword] = useState(false);
  const iconProps = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  return (
    <div className="login-stage">
      <form className="login-box" onSubmit={e => { e.preventDefault(); actions.submitAdminLogin(); }}>
        <div className="login-icon">
          <svg {...iconProps} width={24} height={24}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>
        </div>
        <div className="eyebrow" style={{ color: "var(--gold)" }}>{CONFIG.coupleNames}</div>
        <h2>Admin Sign In</h2>
        <p className="login-sub">Enter the admin password to manage guests, seating and RSVPs.</p>
        <div className={`login-input ${state.adminError ? "has-err" : ""}`}>
          <svg {...iconProps}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <input type={showPassword ? "text" : "password"} autoComplete="current-password" value={state.adminInput}
            onChange={e => actions.patch({ adminInput: e.target.value })}
            placeholder="Password" aria-label="Admin password"
            aria-invalid={!!state.adminError} aria-describedby={state.adminError ? "admin-login-err" : undefined} />
          <button type="button" className="login-eye" onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
            {showPassword
              ? <svg {...iconProps}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
              : <svg {...iconProps}><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M3 3l18 18" /></svg>}
          </button>
        </div>
        {state.adminError && <div className="login-err" id="admin-login-err" role="alert">{state.adminError}</div>}
        <button type="submit" className="login-submit" disabled={state.loading}>
          {state.loading ? <><span className="spinner" />Checking…</> : "Sign in"}
        </button>
        <button type="button" className="login-back" onClick={actions.exitToPublic}>← Back to the site</button>
      </form>
    </div>
  );
}

function HouseholdEditor({ state, actions }) {
  const d = state.householdDraft;
  return (
    <div className="row-card" style={{ padding: 18, marginBottom: 22, borderColor: "var(--sage)" }}>
      <h3 style={{ fontFamily: "var(--display)", fontSize: 20, marginTop: 0 }}>{state.editingCode ? "Edit household" : "Add a household"}</h3>
      <div className="field">
        <label>Household name (optional — auto-filled from guest names)</label>
        <input type="text" value={d.householdName} placeholder="e.g. The Smith Family"
          onChange={e => actions.updateHouseholdField("householdName", e.target.value)} />
      </div>
      {d.members.map((m, i) => (
        <div className="field" key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label>{i === 0 ? "Guest 1" : `Guest ${i + 1}`}</label>
            <input type="text" value={m.name} placeholder="Guest name" onChange={e => actions.updateHMemberName(i, e.target.value)} />
          </div>
          {d.members.length > 1 && <button className="remove-link" onClick={() => actions.removeHMember(i)}>Remove</button>}
        </div>
      ))}
      <button className="add-member-btn" onClick={actions.addHMember} style={{ marginBottom: 18 }}>+ Add guest to household</button>

      <label style={{ display: "block", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", marginBottom: 6 }}>Invited to</label>
      {eventsList().map(ev => (
        <label className="checkbox-row" key={ev.id}>
          <input type="checkbox" checked={d.invitedEvents.includes(ev.id)} onChange={() => actions.toggleHEvent(ev.id)} />
          {ev.name}
        </label>
      ))}
      <label className="checkbox-row">
        <input type="checkbox" checked={d.allowPlusOne} onChange={e => actions.updateHouseholdField("allowPlusOne", e.target.checked)} />
        Allow this household to add an extra guest
      </label>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Contact email (optional)</label>
        <input type="email" value={d.contactEmail} placeholder="name@example.com" autoComplete="off"
          onChange={e => actions.updateHouseholdField("contactEmail", e.target.value)} />
        <div className="helptext">Lets you email this household reminders and updates before they reply. Pre-fills their RSVP form.</div>
      </div>
      <div className="field">
        <label>Contact phone (optional)</label>
        <input type="tel" value={d.contactPhone} placeholder="04xx xxx xxx" autoComplete="off"
          onChange={e => actions.updateHouseholdField("contactPhone", e.target.value)} />
      </div>
      <div className="field">
        <label>Personal note (shown on their RSVP page)</label>
        <textarea placeholder="We're so excited to have you at the ceremony!" value={d.personalNote}
          onChange={e => actions.updateHouseholdField("personalNote", e.target.value)} />
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost" onClick={actions.cancelHouseholdDraft}>Cancel</button>
        <button className="btn btn-primary" onClick={actions.saveHousehold} disabled={state.loading}>
          {state.loading ? <><span className="spinner" />Saving…</> : "Save household"}
        </button>
      </div>
    </div>
  );
}

function QrModal({ state, actions }) {
  if (!state.qrModalCode) return null;
  const code = state.qrModalCode;
  const rec = state.guestList[code];
  return (
    <div className="qr-modal-backdrop" onClick={() => actions.patch({ qrModalCode: null })}>
      <div className="qr-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ fontFamily: "var(--display)", marginTop: 0 }}>{rec.householdName}</h3>
        <img src={qrSrc(code)} alt={`QR code for ${rec.householdName}`} />
        <div className="link-box">{inviteUrl(code)}</div>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="btn btn-ghost" onClick={() => actions.copyLink(code)}>Copy link</button>
          <button className="btn btn-primary" onClick={() => actions.patch({ qrModalCode: null })}>Done</button>
        </div>
      </div>
    </div>
  );
}

function AdminGuestList({ state, actions }) {
  const records = Object.entries(state.guestList);
  return (
    <>
      {!state.householdDraft && (
        <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={actions.startAddHousehold}>+ Add household</button>
      )}
      {state.householdDraft && <HouseholdEditor state={state} actions={actions} />}
      {records.length === 0 && !state.householdDraft && (
        <div className="empty-state"><div className="em-ic">✦</div>No households yet — add one to generate its QR code.</div>
      )}
      {records.map(([code, rec]) => {
        const open = !!state.openRows[code];
        const status = !rec.response ? "pending" : (rec.response.members.some(m => rec.invitedEvents.some(id => m.attending[id])) ? "yes" : "no");
        return (
          <div className="row-card" key={code}>
            <div className="row-head" onClick={() => actions.toggleRow(code)}>
              <div>
                <div className="rname">{rec.householdName} <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>({rec.members.length} guest{rec.members.length > 1 ? "s" : ""})</span></div>
                <div className="rmeta">Invited: {rec.invitedEvents.map(id => eventById(id)?.name).join(", ")} · code {code}</div>
              </div>
              <span className={`pill ${status}`}>{status === "pending" ? "Awaiting reply" : status === "yes" ? "Attending" : "Not attending"}</span>
            </div>
            {open && (
              <div className="row-body">
                {rec.personalNote && <div className="member-detail"><em>Note shown to guest:</em> "{rec.personalNote}"</div>}
                {rec.members.map(m => <div className="member-detail" key={m.id}>{m.name}</div>)}
                {(rec.contactEmail || rec.contactPhone) && <div className="member-detail">Contact (entered by you): {[rec.contactEmail, rec.contactPhone].filter(Boolean).join(" · ")}</div>}
                {rec.response && <div className="member-detail">Contact (from their RSVP): {rec.response.contactEmail} {rec.response.contactPhone ? "· " + rec.response.contactPhone : ""}</div>}
                <div className="row-actions">
                  <button onClick={() => actions.patch({ qrModalCode: code })}>Show QR code</button>
                  <button onClick={() => actions.copyLink(code)}>Copy link</button>
                  <button onClick={() => actions.previewInvite(code)}>Preview as guest</button>
                  <button onClick={() => actions.startEditHousehold(code)}>Edit</button>
                  <button onClick={() => actions.deleteHousehold(code)} style={{ color: "var(--error)" }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <QrModal state={state} actions={actions} />
    </>
  );
}

// Admin "Email guests": who an email goes to. A household's address is its
// own RSVP email once it has replied, otherwise the contact email the admin
// entered for it (households with neither are skipped and listed).
function recipientEmail(rec) { return rec.response?.contactEmail || rec.contactEmail || ""; }
function emailAudiences() {
  return [
    { id: "all", label: "Everyone", match: () => true },
    { id: "not-replied", label: "Haven't replied yet", match: r => !r.response },
    { id: "replied", label: "Have replied", match: r => !!r.response },
    ...eventsList().flatMap(ev => [
      { id: `invited:${ev.id}`, label: `Invited — ${eventShortName(ev)}`, match: r => r.invitedEvents.includes(ev.id) },
      { id: `attending:${ev.id}`, label: `Attending — ${eventShortName(ev)}`, match: r => !!r.response && r.invitedEvents.includes(ev.id) && r.response.members.some(m => m.attending?.[ev.id]) },
    ]),
  ];
}
// Reminder emails only ever go to households that haven't replied.
function reminderAudiences() {
  return [
    { id: "not-replied", label: "Everyone who hasn't replied", match: r => !r.response },
    ...eventsList().map(ev => ({ id: `not-replied:${ev.id}`, label: `Not replied — ${eventShortName(ev)}`, match: r => !r.response && r.invitedEvents.includes(ev.id) })),
  ];
}
// Must match EMAIL_BATCH_SIZE in functions/api/admin.js (the server rejects larger batches).
const EMAIL_BATCH_SIZE = 10;
// Gmail (via the Apps Script relay) allows roughly 100 recipients a day on a personal account.
const GMAIL_DAILY_LIMIT = 100;

function EmailSendStatus({ state, actions, retryPayload }) {
  if (state.emailProgress) {
    const { done, total } = state.emailProgress;
    return (
      <div className="email-status" role="status">
        <div>Sending… {done} of {total}</div>
        <div className="headcount-bar"><div style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
        <div className="helptext">Keep this page open until it finishes.</div>
      </div>
    );
  }
  const r = state.emailResult;
  if (!r) return null;
  return (
    <div className="email-status" role="status">
      <div><strong>Sent to {r.sent} household{r.sent === 1 ? "" : "s"}.</strong>{r.failed.length ? ` ${r.failed.length} didn't go through:` : ""}</div>
      {r.failed.length > 0 && (
        <>
          <ul className="email-list">
            {r.failed.map(f => <li key={f.code}>{state.guestList[f.code]?.householdName || f.code}{f.reason === "no email" ? " — no email on file" : f.reason === "already replied" ? " — replied in the meantime, so skipped" : ""}</li>)}
          </ul>
          {r.failed.some(f => f.status === "failed") && retryPayload && (
            <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={state.emailSending}
              onClick={() => actions.sendGuestEmails(r.failed.filter(f => f.status === "failed").map(f => f.code), retryPayload)}>Retry the ones that failed</button>
          )}
        </>
      )}
    </div>
  );
}

function EmailGuestsPanel({ state, actions }) {
  const reminder = state.emailKind === "reminder";
  return (
    <div className="row-card email-panel">
      <h3>Email guests</h3>
      <div className="segmented" role="tablist" aria-label="Email type">
        <button role="tab" aria-selected={!reminder} className={!reminder ? "on" : ""} disabled={state.emailSending}
          onClick={() => actions.patch({ emailKind: "update", emailResult: null })}>Update</button>
        <button role="tab" aria-selected={reminder} className={reminder ? "on" : ""} disabled={state.emailSending}
          onClick={() => actions.patch({ emailKind: "reminder", emailResult: null })}>RSVP reminder</button>
      </div>
      {reminder ? <ReminderEmailForm state={state} actions={actions} /> : <UpdateEmailForm state={state} actions={actions} />}
    </div>
  );
}

function AudienceSummary({ withEmail, noEmail, skippedLabel = "no email" }) {
  return (
    <>
      <div className="email-summary">
        <strong>{withEmail.length}</strong> household{withEmail.length === 1 ? "" : "s"} will receive this
        {noEmail.length > 0 && <> · {noEmail.length} {noEmail.length === 1 ? "has" : "have"} {skippedLabel} and will be skipped</>}
      </div>
      {noEmail.length > 0 && (
        <details className="email-skipped">
          <summary>Show who'll be skipped</summary>
          <ul className="email-list">{noEmail.map(([code, r]) => <li key={code}>{r.householdName}</li>)}</ul>
        </details>
      )}
      {withEmail.length > GMAIL_DAILY_LIMIT && (
        <div className="settings-warn">Gmail only sends to about {GMAIL_DAILY_LIMIT} people a day — some of these may fail. Use "Retry" tomorrow for any that do.</div>
      )}
    </>
  );
}

function ReminderEmailForm({ state, actions }) {
  const audiences = reminderAudiences();
  const aud = audiences.find(a => a.id === state.reminderAudience) || audiences[0];
  const matched = Object.entries(state.guestList).filter(([, r]) => aud.match(r));
  const withEmail = matched.filter(([, r]) => recipientEmail(r));
  const noEmail = matched.filter(([, r]) => !recipientEmail(r));
  const payload = { kind: "reminder", subject: state.reminderSubject.trim(), message: state.reminderNote.trim() };
  const deadlines = state.siteSettings.deadlines || {};
  return (
    <>
      <p className="settings-help">
        A personal nudge to households that haven't replied. Each one gets its own event list with the reply-by dates from
        Settings{Object.keys(deadlines).length === 0 ? " (none set yet)" : ""}, and an "Open your invitation" button that
        goes straight to their RSVP. Anyone who replies before you send is skipped automatically.
      </p>
      <div className="field">
        <label htmlFor="reminder-audience">Send to</label>
        <select id="reminder-audience" className="settings-input" value={aud.id} disabled={state.emailSending}
          onChange={e => actions.patch({ reminderAudience: e.target.value, emailResult: null })}>
          {audiences.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <AudienceSummary withEmail={withEmail} noEmail={noEmail} />
      </div>
      <div className="field">
        <label htmlFor="reminder-subject">Subject</label>
        <input id="reminder-subject" className="settings-input" type="text" maxLength={200} value={state.reminderSubject}
          onChange={e => actions.patch({ reminderSubject: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="reminder-note">Personal note (optional)</label>
        <textarea id="reminder-note" className="settings-input" maxLength={2000} value={state.reminderNote} placeholder="e.g. We're finalising numbers with the venue soon!"
          onChange={e => actions.patch({ reminderNote: e.target.value })} />
      </div>
      <button className="btn btn-primary email-send" disabled={state.emailSending || withEmail.length === 0 || !payload.subject}
        onClick={() => actions.sendGuestEmails(withEmail.map(([code]) => code), payload)}>
        {state.emailSending ? <><span className="spinner" />Sending…</> : `Send reminder to ${withEmail.length} household${withEmail.length === 1 ? "" : "s"}`}
      </button>
      <EmailSendStatus state={state} actions={actions} retryPayload={payload} />
    </>
  );
}

function UpdateEmailForm({ state, actions }) {
  const audiences = emailAudiences();
  const aud = audiences.find(a => a.id === state.emailAudience) || audiences[0];
  const matched = Object.entries(state.guestList).filter(([, r]) => aud.match(r));
  const withEmail = matched.filter(([, r]) => recipientEmail(r));
  const noEmail = matched.filter(([, r]) => !recipientEmail(r));
  const payload = { kind: "update", subject: state.emailSubject.trim(), message: state.emailMessage.trim() };
  return (
    <>
      <p className="settings-help">
        Send an update to a group of households. Households that have replied get it at their RSVP email; the rest at the
        contact email you entered for them on the Guest List.
      </p>
      <div className="field">
        <label htmlFor="email-audience">Send to</label>
        <select id="email-audience" className="settings-input" value={aud.id} disabled={state.emailSending}
          onChange={e => actions.patch({ emailAudience: e.target.value, emailResult: null })}>
          {audiences.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <AudienceSummary withEmail={withEmail} noEmail={noEmail} />
      </div>
      <div className="field">
        <label htmlFor="email-subject">Subject</label>
        <input id="email-subject" className="settings-input" type="text" maxLength={200} value={state.emailSubject} placeholder="An update from us"
          onChange={e => actions.patch({ emailSubject: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="email-message">Message</label>
        <textarea id="email-message" className="settings-input" maxLength={5000} value={state.emailMessage} placeholder="Write your update here…" style={{ minHeight: 130 }}
          onChange={e => actions.patch({ emailMessage: e.target.value })} />
      </div>
      <button className="btn btn-primary email-send" disabled={state.emailSending || withEmail.length === 0 || !payload.subject || !payload.message}
        onClick={() => actions.sendGuestEmails(withEmail.map(([code]) => code), payload)}>
        {state.emailSending ? <><span className="spinner" />Sending…</> : `Send to ${withEmail.length} household${withEmail.length === 1 ? "" : "s"}`}
      </button>
      <EmailSendStatus state={state} actions={actions} retryPayload={payload} />
    </>
  );
}

function AdminResponses({ state, actions }) {
  const all = state.guestList;
  let records = Object.entries(all);
  const q = state.adminSearch.trim().toLowerCase();
  if (q) records = records.filter(([code, rec]) => (rec.householdName + " " + rec.members.map(m => m.name).join(" ")).toLowerCase().includes(q));

  let totalHouseholds = Object.keys(all).length, responded = 0, totalGuests = 0;
  const eventCounts = {}; eventsList().forEach(e => (eventCounts[e.id] = { yes: 0 }));
  const dietaryCounts = {};
  Object.values(all).forEach(rec => {
    totalGuests += rec.members.length;
    if (rec.response) {
      responded++;
      rec.response.members.forEach(m => {
        rec.invitedEvents.forEach(id => { if (m.attending[id]) eventCounts[id].yes++; });
        (m.dietaryTags || []).forEach(t => (dietaryCounts[t] = (dietaryCounts[t] || 0) + 1));
      });
    }
  });
  const dietSummary = Object.keys(dietaryCounts).length ? Object.entries(dietaryCounts).map(([k, v]) => `${k}: ${v}`).join("  ·  ") : "None recorded yet";

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card"><div className="num">{totalHouseholds}</div><div className="lbl">Households invited</div></div>
        <div className="stat-card"><div className="num">{responded}</div><div className="lbl">Responded</div></div>
        <div className="stat-card"><div className="num">{totalGuests}</div><div className="lbl">Total guests</div></div>
        {eventsList().map(ev => (
          <div className="stat-card" key={ev.id}><div className="num">{eventCounts[ev.id].yes}</div><div className="lbl">{ev.name} — attending</div></div>
        ))}
      </div>
      <div className="summary" style={{ marginBottom: 22 }}><strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)" }}>Dietary summary&nbsp; </strong>{dietSummary}</div>
      <EmailGuestsPanel state={state} actions={actions} />
      <div className="admin-controls">
        <input type="text" placeholder="Search by name…" value={state.adminSearch} onChange={e => actions.patch({ adminSearch: e.target.value })} />
        <button className="btn btn-ghost" style={{ flex: "none" }} onClick={actions.exportCSV}>Export CSV</button>
      </div>
      {records.length === 0 && <div className="empty-state"><div className="em-ic">✦</div>No RSVPs match yet.</div>}
      {records.map(([code, rec]) => {
        const open = !!state.openRows["r" + code];
        const status = !rec.response ? "pending" : (rec.response.members.some(m => rec.invitedEvents.some(id => m.attending[id])) ? "yes" : "no");
        return (
          <div className="row-card" key={code}>
            <div className="row-head" onClick={() => actions.patch({ openRows: { ...state.openRows, ["r" + code]: !open } })}>
              <div>
                <div className="rname">{rec.householdName}</div>
                <div className="rmeta">{rec.response ? rec.response.contactEmail : "No response yet"} {rec.response?.submittedAt ? "· " + new Date(rec.response.submittedAt).toLocaleDateString() : ""}</div>
              </div>
              <span className={`pill ${status}`}>{status === "pending" ? "Awaiting reply" : status === "yes" ? "Attending" : "Not attending"}</span>
            </div>
            {open && (
              <div className="row-body">
                {(rec.response ? rec.response.members : rec.members).map(m => (
                  <div className="member-detail" key={m.id || m.name}>
                    <strong>{m.name}</strong><br />
                    {rec.response
                      ? rec.invitedEvents.map(id => `${eventById(id).name}: ${m.attending[id] ? "Yes" : "No"}`).join("  ·  ")
                      : rec.invitedEvents.map(id => eventById(id).name).join(", ") + " — awaiting reply"}
                    {rec.response && <><br />Dietary: {(m.dietaryTags || []).join(", ") || "—"}{m.dietaryNote ? " — " + m.dietaryNote : ""}</>}
                  </div>
                ))}
                {rec.response?.notes && <div className="member-detail"><em>Message:</em> {rec.response.notes}</div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* =========================================================
   SEAT MAP
   Canvas-drawn reception floor plan. Logical coordinate space
   is fixed at LW x LH regardless of on-screen size — the canvas
   is rendered at that resolution (scaled for devicePixelRatio)
   and stretched to fit its container via CSS, so all hit-testing
   and drag math works in the same fixed units as the drawing.
   ========================================================= */
const SEAT_PALETTE = ["#A9814C", "#6E7F63", "#C98F86", "#57654E", "#B6503F", "#8A6636"];
function colorForIndex(i) { return SEAT_PALETTE[i % SEAT_PALETTE.length]; }
const SEAT_GRID = 50; // floor-plan units — also the spacing of the faint background dot grid, so the two visibly agree
function snapToGrid(v) { return Math.round(v / SEAT_GRID) * SEAT_GRID; }
function snapClamp(v, min, max) { return snapToGrid(clamp(v, min, max)); }
function hexWithAlpha(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function seatToLogical(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const evt = e.touches && e.touches[0] ? e.touches[0] : e;
  return {
    x: (evt.clientX - rect.left) * (SEAT_LW / rect.width),
    y: (evt.clientY - rect.top) * (SEAT_LH / rect.height)
  };
}
function hitTestTable(tables, x, y) {
  for (let i = tables.length - 1; i >= 0; i--) {
    const t = tables[i];
    const dx = x - t.x, dy = y - t.y;
    const { w, h, round } = tableDims(t);
    if (round) {
      if ((dx * dx) / ((w / 2) * (w / 2)) + (dy * dy) / ((h / 2) * (h / 2)) <= 1) return t;
    } else if (Math.abs(dx) <= w / 2 && Math.abs(dy) <= h / 2) return t;
  }
  return null;
}
// Floor objects (bar, doors, walls...): geometry shared by drawing and hit-testing.
function triSign(p1, p2, p3) { return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]); }
function pointInTriangle(px, py, pts) {
  const p = [px, py];
  const d1 = triSign(p, pts[0], pts[1]), d2 = triSign(p, pts[1], pts[2]), d3 = triSign(p, pts[2], pts[0]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0, hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
// Returns null (no hit), "body" (move the whole shape), or for lines "p1"/"p2"
// (drag just that endpoint) so a wall/barrier can be stretched, not just moved.
function hitTestObject(o, x, y) {
  if (o.type === "line") {
    if (Math.hypot(x - o.x, y - o.y) <= 10) return "p1";
    if (Math.hypot(x - o.x2, y - o.y2) <= 10) return "p2";
    return pointToSegmentDistance(x, y, o.x, o.y, o.x2, o.y2) <= 8 ? "body" : null;
  }
  const dx = x - o.x, dy = y - o.y;
  if (o.type === "circle") return dx * dx + dy * dy <= (o.size / 2) * (o.size / 2) ? "body" : null;
  if (o.type === "triangle") return pointInTriangle(x, y, triangleVertices(o)) ? "body" : null;
  return Math.abs(dx) <= o.size / 2 && Math.abs(dy) <= o.size / 2 ? "body" : null; // rect
}
function hitTestObjects(objects, x, y) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const handle = hitTestObject(objects[i], x, y);
    if (handle) return { object: objects[i], handle };
  }
  return null;
}
function fitSeatTransform(tables) {
  if (!tables.length) return { panX: 0, panY: 0, zoom: 1 };
  const pad = 70;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  tables.forEach(t => {
    const half = t.size / 2;
    minX = Math.min(minX, t.x - half); maxX = Math.max(maxX, t.x + half);
    minY = Math.min(minY, t.y - half); maxY = Math.max(maxY, t.y + half);
  });
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const boxW = Math.max(1, maxX - minX), boxH = Math.max(1, maxY - minY);
  const zoom = clamp(Math.min(SEAT_LW / boxW, SEAT_LH / boxH), 0.6, 2.5);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { zoom, panX: SEAT_LW / 2 - cx * zoom, panY: SEAT_LH / 2 - cy * zoom };
}
function zoomSeatTransform(t, factor) {
  const zoom = clamp((t.zoom || 1) * factor, 0.5, 3);
  const cx = (SEAT_LW / 2 - (t.panX || 0)) / (t.zoom || 1);
  const cy = (SEAT_LH / 2 - (t.panY || 0)) / (t.zoom || 1);
  return { zoom, panX: SEAT_LW / 2 - cx * zoom, panY: SEAT_LH / 2 - cy * zoom };
}

// Draws one frame into an already-transformed ctx (translated/scaled to the
// current pan/zoom) in floor-plan units. Shared by the live canvas and the
// PNG export so the two can never visually drift apart.
function drawFloorPlan(ctx, opts) {
  const {
    tables, objects, editable, selectedTableId, selectedObjectId,
    occupancy, occupiedSeats, highlightColors, highlightSeatIndices, zoom = 1, showGrid = true, dimOthers = false
  } = opts;

  if (showGrid) {
    const dotGrid = new Path2D();
    for (let gx = SEAT_GRID; gx < SEAT_LW; gx += SEAT_GRID) {
      for (let gy = SEAT_GRID; gy < SEAT_LH; gy += SEAT_GRID) {
        dotGrid.moveTo(gx + 1.6, gy);
        dotGrid.arc(gx, gy, 1.6, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = "rgba(169,129,76,.18)";
    ctx.fill(dotGrid);
  }

  ctx.strokeStyle = "rgba(169,129,76,.4)";
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(10, 10, SEAT_LW - 20, SEAT_LH - 20);

  // Floor objects draw first (background layer) so tables visually sit on top of them.
  objects.forEach(o => {
    const isSelected = editable && selectedObjectId === o.id;
    ctx.save();
    if (o.type === "line") {
      ctx.strokeStyle = isSelected ? "#6E7F63" : "#3A3F37";
      ctx.lineWidth = isSelected ? 7 : 5;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x2, o.y2); ctx.stroke();
      if (isSelected) {
        [[o.x, o.y], [o.x2, o.y2]].forEach(([px, py]) => {
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#6E7F63"; ctx.fill();
        });
      }
      if (o.label) {
        ctx.fillStyle = "#202B22";
        ctx.font = "600 12px 'Work Sans', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(o.label, (o.x + o.x2) / 2, (o.y + o.y2) / 2 - 8);
      }
    } else {
      ctx.translate(o.x, o.y);
      ctx.fillStyle = "rgba(216,200,165,.4)";
      ctx.strokeStyle = isSelected ? "#6E7F63" : "rgba(74,81,72,.5)";
      ctx.lineWidth = isSelected ? 3 : 1.5;
      if (o.type === "circle") {
        ctx.beginPath(); ctx.arc(0, 0, o.size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (o.type === "triangle") {
        const pts = triangleVertices(o);
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px - o.x, py - o.y) : ctx.lineTo(px - o.x, py - o.y)));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        roundRectPath(ctx, -o.size / 2, -o.size / 2, o.size, o.size, 4); ctx.fill(); ctx.stroke();
      }
      if (o.label) {
        ctx.fillStyle = "#202B22";
        ctx.font = "600 12px 'Work Sans', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(o.label, 0, 0);
      }
    }
    ctx.restore();
  });

  tables.forEach(t => {
    const isSelected = editable && selectedTableId === t.id;
    const hlColor = !editable && highlightColors ? highlightColors[t.id] : null;
    // "Find my seat" always highlights the guest's own table(s), so any other
    // table is fair game to mute — otherwise one that happens to clip the
    // edge of that tightly-zoomed crop reads as an unexplained blank white
    // shape instead of clearly-someone-else's-table. Venue display leaves
    // dimOthers off: it's meant to show the whole room clearly at all times.
    const dim = dimOthers && !hlColor;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.lineWidth = hlColor ? 4 : (isSelected ? 3 : 1.5);
    ctx.strokeStyle = hlColor || (isSelected ? "#6E7F63" : dim ? "rgba(216,200,165,.55)" : "#D8C8A5");
    ctx.fillStyle = hlColor ? hexWithAlpha(hlColor, 0.2) : dim ? "rgba(216,200,165,.25)" : "#ffffff";
    if (hlColor) { ctx.shadowColor = hlColor; ctx.shadowBlur = 18; }

    const dims = tableDims(t);
    if (dims.round) {
      ctx.beginPath(); ctx.ellipse(0, 0, dims.w / 2, dims.h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      roundRectPath(ctx, -dims.w / 2, -dims.h / 2, dims.w, dims.h, 6); ctx.fill(); ctx.stroke();
    }
    ctx.shadowBlur = 0;

    const occSet = occupiedSeats ? occupiedSeats[t.id] : null;
    const hlSet = highlightSeatIndices ? highlightSeatIndices[t.id] : null;
    getSeatPositions(t).forEach((pos, i) => {
      const isFilled = occSet && occSet.has(i);
      const isHlSeat = hlSet && hlSet.has(i);
      const seatR = isHlSeat ? 8 : 4;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, seatR, 0, Math.PI * 2);
      if (isHlSeat) {
        ctx.fillStyle = hlColor; ctx.shadowColor = hlColor; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
      } else if (isFilled) {
        ctx.fillStyle = "rgba(74,81,72,.6)"; ctx.fill();
      } else {
        ctx.fillStyle = "#FBF7EF"; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(74,81,72,.35)"; ctx.stroke();
      }
    });

    ctx.fillStyle = "#202B22";
    ctx.font = "600 15px 'Work Sans', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t.label, 0, 0);

    if (occupancy) {
      const count = occupancy[t.id] || 0;
      ctx.font = "600 11px 'Work Sans', sans-serif";
      ctx.fillStyle = count > t.capacity ? "#B6503F" : "#6E7F63";
      ctx.fillText(`${count}/${t.capacity}`, 0, dims.h / 2 + 16);
    }
    ctx.restore();
  });
}

// Renders the current floor plan to a labeled PNG and triggers a download —
// something the couple can hand to a venue or caterer, so it deliberately
// shows table capacity/occupancy (useful for a headcount) but not the grid
// (a snap aid, not something a venue needs to see) or any selection state.
function exportFloorPlanPNG(tables, objects, occupancy, title) {
  const scale = 1.6, margin = 40, titleH = 70;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(SEAT_LW * scale + margin * 2);
  canvas.height = Math.round(SEAT_LH * scale + margin * 2 + titleH);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#FBF7EF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#202B22";
  ctx.font = "600 30px Georgia, 'Cormorant Garamond', serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(title, canvas.width / 2, titleH / 2 + 10);

  ctx.save();
  ctx.translate(margin, titleH + margin / 2);
  ctx.scale(scale, scale);
  drawFloorPlan(ctx, { tables, objects, occupancy, zoom: scale, showGrid: false });
  ctx.restore();

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "reception-floor-plan.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function SeatingCanvas({
  tables, objects, editable, selectedTableId, onSelectTable, onDragTableEnd, occupancy,
  occupiedSeats, highlightColors, highlightSeatIndices, dimOthers,
  selectedObjectId, onSelectObject, onObjectDragEnd,
  viewTransform, onViewTransformChange
}) {
  const canvasRef = useRef(null);
  const dragStartRef = useRef(null);
  const panStartRef = useRef(null);
  const [liveDrag, setLiveDrag] = useState(null); // { kind: "table"|"object", id, x, y, x2, y2 }
  const vtRef = useRef(viewTransform);
  const cbRef = useRef(onViewTransformChange);
  vtRef.current = viewTransform;
  cbRef.current = onViewTransformChange;

  const objs = objects || [];
  const effectiveTables = liveDrag?.kind === "table" ? tables.map(t => (t.id === liveDrag.id ? { ...t, x: liveDrag.x, y: liveDrag.y } : t)) : tables;
  const effectiveObjects = liveDrag?.kind === "object"
    ? objs.map(o => (o.id === liveDrag.id ? { ...o, ...(liveDrag.x != null && { x: liveDrag.x, y: liveDrag.y }), ...(liveDrag.x2 != null && { x2: liveDrag.x2, y2: liveDrag.y2 }) } : o))
    : objs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || editable) return;
    const onWheel = e => {
      e.preventDefault();
      const pt = seatToLogical(e, canvas);
      const cur = vtRef.current || { panX: 0, panY: 0, zoom: 1 };
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = clamp((cur.zoom || 1) * factor, 0.5, 3);
      const worldX = (pt.x - (cur.panX || 0)) / (cur.zoom || 1);
      const worldY = (pt.y - (cur.panY || 0)) / (cur.zoom || 1);
      cbRef.current({ zoom: newZoom, panX: pt.x - worldX * newZoom, panY: pt.y - worldY * newZoom });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [editable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(SEAT_LW * dpr), targetH = Math.round(SEAT_LH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SEAT_LW, SEAT_LH);
    // Soft vignette instead of a flat fill so the room reads as a floor, not a canvas.
    const bgGrad = ctx.createRadialGradient(SEAT_LW / 2, SEAT_LH / 2, 40, SEAT_LW / 2, SEAT_LH / 2, Math.max(SEAT_LW, SEAT_LH) / 1.3);
    bgGrad.addColorStop(0, "#FDFAF3");
    bgGrad.addColorStop(1, "#F3EDDF");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, SEAT_LW, SEAT_LH);

    ctx.save();
    const { panX = 0, panY = 0, zoom = 1 } = viewTransform || {};
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    drawFloorPlan(ctx, {
      tables: effectiveTables, objects: effectiveObjects, editable, selectedTableId, selectedObjectId,
      occupancy: editable ? occupancy : null, occupiedSeats, highlightColors, highlightSeatIndices, zoom, dimOthers
    });
    ctx.restore();
  }, [effectiveTables, effectiveObjects, editable, selectedTableId, selectedObjectId, occupancy, occupiedSeats, highlightColors, highlightSeatIndices, dimOthers, viewTransform]);

  function handlePointerDown(e) {
    const canvas = canvasRef.current;
    const pt = seatToLogical(e, canvas);
    if (editable) {
      const tableHit = hitTestTable(tables, pt.x, pt.y);
      if (tableHit) {
        onSelectTable(tableHit.id);
        onSelectObject(null);
        dragStartRef.current = { kind: "table", id: tableHit.id, startX: tableHit.x, startY: tableHit.y, startPtX: pt.x, startPtY: pt.y };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const objHit = hitTestObjects(objs, pt.x, pt.y);
      if (objHit) {
        onSelectObject(objHit.object.id);
        onSelectTable(null);
        dragStartRef.current = {
          kind: "object", id: objHit.object.id, handle: objHit.handle,
          startX: objHit.object.x, startY: objHit.object.y, startX2: objHit.object.x2, startY2: objHit.object.y2,
          startPtX: pt.x, startPtY: pt.y
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      onSelectTable(null);
      onSelectObject(null);
    } else {
      panStartRef.current = { startPanX: (viewTransform?.panX || 0), startPanY: (viewTransform?.panY || 0), startPtX: pt.x, startPtY: pt.y };
      canvas.setPointerCapture(e.pointerId);
    }
  }
  function handlePointerMove(e) {
    const canvas = canvasRef.current;
    const pt = seatToLogical(e, canvas);
    const d = dragStartRef.current;
    if (editable && d) {
      const dx = pt.x - d.startPtX, dy = pt.y - d.startPtY;
      if (d.kind === "table") {
        setLiveDrag({ kind: "table", id: d.id, x: snapClamp(d.startX + dx, 0, SEAT_LW), y: snapClamp(d.startY + dy, 0, SEAT_LH) });
      } else if (d.handle === "p1") {
        setLiveDrag({ kind: "object", id: d.id, x: snapClamp(d.startX + dx, 0, SEAT_LW), y: snapClamp(d.startY + dy, 0, SEAT_LH) });
      } else if (d.handle === "p2") {
        setLiveDrag({ kind: "object", id: d.id, x2: snapClamp(d.startX2 + dx, 0, SEAT_LW), y2: snapClamp(d.startY2 + dy, 0, SEAT_LH) });
      } else if (d.startX2 != null) {
        // dragging a line's body translates both endpoints together
        setLiveDrag({
          kind: "object", id: d.id,
          x: snapClamp(d.startX + dx, 0, SEAT_LW), y: snapClamp(d.startY + dy, 0, SEAT_LH),
          x2: snapClamp(d.startX2 + dx, 0, SEAT_LW), y2: snapClamp(d.startY2 + dy, 0, SEAT_LH)
        });
      } else {
        setLiveDrag({ kind: "object", id: d.id, x: snapClamp(d.startX + dx, 0, SEAT_LW), y: snapClamp(d.startY + dy, 0, SEAT_LH) });
      }
    } else if (!editable && panStartRef.current) {
      const p = panStartRef.current;
      onViewTransformChange({ ...(viewTransform || { zoom: 1 }), panX: p.startPanX + (pt.x - p.startPtX), panY: p.startPanY + (pt.y - p.startPtY) });
    }
  }
  function handlePointerUp() {
    const d = dragStartRef.current;
    if (editable && d && liveDrag) {
      if (d.kind === "table") onDragTableEnd(liveDrag.id, liveDrag.x, liveDrag.y);
      else {
        const changes = {};
        if (liveDrag.x != null) { changes.x = liveDrag.x; changes.y = liveDrag.y; }
        if (liveDrag.x2 != null) { changes.x2 = liveDrag.x2; changes.y2 = liveDrag.y2; }
        onObjectDragEnd(liveDrag.id, changes);
      }
    }
    dragStartRef.current = null;
    panStartRef.current = null;
    setLiveDrag(null);
  }
  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
}

function findGuestByMemberId(guestList, memberId) {
  for (const [code, rec] of Object.entries(guestList)) {
    const m = rec.members.find(mm => mm.id === memberId);
    if (m) return { memberId, name: m.name, inviteCode: code };
  }
  return { memberId, name: "Unknown guest", inviteCode: null };
}

// datetime-local inputs work in the viewer's local time with no timezone
// info; we store revealAt as a UTC ISO string, so converting for display in
// the input has to go through local Date components both ways or the
// picker silently shows the wrong wall-clock time.
function isoToLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SeatingRevealPanel({ state, actions, selectStyle }) {
  const [mode, setMode] = useState(state.seatingRevealMode);
  const [revealAt, setRevealAt] = useState(state.seatingRevealAt ? isoToLocalInputValue(state.seatingRevealAt) : "");

  const isRevealedNow = state.seatingRevealMode === "open" ||
    (state.seatingRevealMode === "scheduled" && state.seatingRevealAt && Date.now() >= new Date(state.seatingRevealAt).getTime());

  const statusText = state.seatingRevealMode === "open"
    ? "🔓 Open — guests can see their seat right now."
    : state.seatingRevealMode === "scheduled" && state.seatingRevealAt
      ? (isRevealedNow
          ? `🔓 Open — the scheduled time (${new Date(state.seatingRevealAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}) has passed, so guests can see their seat now.`
          : `🕐 Scheduled — guests will be able to see their seat starting ${new Date(state.seatingRevealAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`)
      : "🔒 Locked — guests cannot see their seat yet, no matter how they access the page.";

  function save() {
    actions.saveSeatingReveal(mode, mode === "scheduled" && revealAt ? new Date(revealAt).toISOString() : null);
  }

  return (
    <div className="table-editor-panel" style={{ marginTop: 0, marginBottom: 22 }}>
      <h4>Guest seat access</h4>
      <p className="lede" style={{ textAlign: "left", margin: "0 0 16px" }}>{statusText}</p>
      <div className="table-editor-row">
        <div className="field">
          <label>Mode</label>
          <select style={selectStyle} value={mode} onChange={e => setMode(e.target.value)}>
            <option value="locked">Locked — hidden from every guest</option>
            <option value="scheduled">Scheduled — reveal automatically at a set time</option>
            <option value="open">Open now</option>
          </select>
        </div>
        {mode === "scheduled" && (
          <div className="field">
            <label>Reveal at</label>
            <input type="datetime-local" value={revealAt} onChange={e => setRevealAt(e.target.value)} />
          </div>
        )}
      </div>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" onClick={save} disabled={state.loading || (mode === "scheduled" && !revealAt)}>Save</button>
      </div>
    </div>
  );
}

function AdminSeating({ state, actions }) {
  useEffect(() => { if (!state.seatingLoaded && !state.seatingLoading) actions.loadSeating(); }, [state.seatingLoaded, state.seatingLoading]);

  // Background refresh so a second admin's changes (on another device) show
  // up here within a few seconds, without needing full real-time push infra.
  useEffect(() => {
    if (!state.seatingLoaded) return;
    const id = setInterval(() => actions.loadSeating(true), 5000);
    return () => clearInterval(id);
  }, [state.seatingLoaded]);

  if (state.seatingLoading && !state.seatingLoaded) {
    return <div className="empty-state"><div className="em-ic">✦</div>Loading seating chart…</div>;
  }

  const households = Object.entries(state.guestList).filter(([, rec]) => invitedToSeatedEvent(rec)).map(([code, rec]) => ({
    code, name: rec.householdName,
    unseated: rec.members.filter(m => !state.seatingAssignments[m.id])
  })).filter(h => h.unseated.length > 0);

  const occupancy = {};
  const occupiedSeats = {};
  Object.values(state.seatingAssignments).forEach(a => {
    occupancy[a.tableId] = (occupancy[a.tableId] || 0) + 1;
    if (!occupiedSeats[a.tableId]) occupiedSeats[a.tableId] = new Set();
    occupiedSeats[a.tableId].add(a.seatIndex);
  });

  const selectedTable = state.seatingTables.find(t => t.id === state.selectedTableId);
  const selectedObject = state.seatingObjects.find(o => o.id === state.selectedObjectId);
  const seats = selectedTable
    ? Array.from({ length: selectedTable.capacity }, (_, i) => {
        const entry = Object.entries(state.seatingAssignments).find(([, a]) => a.tableId === selectedTable.id && a.seatIndex === i);
        return { index: i, guest: entry ? findGuestByMemberId(state.guestList, entry[0]) : null };
      })
    : [];

  function handleSeatDrop(e, seatIndex) {
    e.preventDefault();
    const data = e.dataTransfer.getData("text/plain");
    if (!data) return;
    const [memberId, inviteCode] = data.split("|");
    actions.assignSeat(memberId, inviteCode, selectedTable.id, seatIndex);
  }

  const selectStyle = { width: "100%", padding: "12px 13px", border: "1px solid var(--gold-soft)", background: "#fff", fontSize: 15.5, borderRadius: 2 };

  return (
    <>
      <SeatingRevealPanel state={state} actions={actions} selectStyle={selectStyle} />
      <p className="lede" style={{ textAlign: "left", margin: "0 0 16px" }}>
        Tap a table to see its seats. Drag a guest onto an empty seat — or tap a guest, then tap the seat.
        Drag tables and shapes to arrange the room; drag a wall's endpoints to angle or stretch it.
      </p>
      <div className="seating-toolbar">
        <button className="btn btn-primary" style={{ flex: "none" }} onClick={actions.addTable} disabled={state.loading}>+ Add table</button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={() => actions.addObject("circle")} disabled={state.loading}>+ Circle</button>
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={() => actions.addObject("rect")} disabled={state.loading}>+ Square</button>
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={() => actions.addObject("triangle")} disabled={state.loading}>+ Triangle</button>
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={() => actions.addObject("line")} disabled={state.loading}>+ Wall / barrier</button>
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={actions.downloadFloorPlan}>⬇ Download floor plan</button>
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={() => actions.patch({ view: "venue-display" })}>🖥 Open venue display</button>
        </div>
      </div>
      <div className="seating-layout">
        <div className="seating-sidebar">
          <h4>Unseated guests</h4>
          {households.length === 0 && <p className="helptext">Everyone's seated.</p>}
          {households.map(h => (
            <div className="household-group" key={h.code}>
              <div className="hname">{h.name}</div>
              {h.unseated.map(m => (
                <button key={m.id} className={`guest-chip ${state.armedGuest?.memberId === m.id ? "armed" : ""}`}
                  draggable
                  onDragStart={e => e.dataTransfer.setData("text/plain", `${m.id}|${h.code}`)}
                  onClick={() => actions.armGuest(m.id, h.code)}>
                  {m.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="seating-main">
          <div className="seating-canvas-wrap">
            <SeatingCanvas
              tables={state.seatingTables}
              objects={state.seatingObjects}
              editable
              selectedTableId={state.selectedTableId}
              onSelectTable={actions.selectTable}
              onDragTableEnd={actions.moveTable}
              occupancy={occupancy}
              occupiedSeats={occupiedSeats}
              selectedObjectId={state.selectedObjectId}
              onSelectObject={actions.selectObject}
              onObjectDragEnd={actions.moveObject}
            />
          </div>
          {selectedTable && state.tableDraft && (
            <div className="table-editor-panel">
              <h4>Edit table</h4>
              <div className="table-editor-row">
                <div className="field"><label>Label</label>
                  <input type="text" value={state.tableDraft.label} onChange={e => actions.updateTableDraftField("label", e.target.value)} />
                </div>
                <div className="field"><label>Shape</label>
                  <select style={selectStyle} value={state.tableDraft.shape} onChange={e => actions.setTableShape(e.target.value)}>
                    <option value="round">Round</option>
                    <option value="rect">Rectangular</option>
                    <option value="oval">Oval</option>
                    <option value="banquet">Banquet (long)</option>
                  </select>
                </div>
                <div className="field"><label>{state.tableDraft.shape === "oval" || state.tableDraft.shape === "banquet" ? "Width" : "Size"}</label>
                  <select style={selectStyle} value={state.tableDraft.size} onChange={e => actions.updateTableDraftField("size", Number(e.target.value))}>
                    <option value={70}>Small</option>
                    <option value={90}>Medium</option>
                    <option value={120}>Large</option>
                  </select>
                </div>
                {(state.tableDraft.shape === "oval" || state.tableDraft.shape === "banquet") && (
                  <div className="field"><label>Length</label>
                    <select style={selectStyle} value={state.tableDraft.size2 || 180} onChange={e => actions.updateTableDraftField("size2", Number(e.target.value))}>
                      <option value={140}>Short</option>
                      <option value={180}>Medium</option>
                      <option value={240}>Long</option>
                      <option value={300}>Extra long</option>
                    </select>
                  </div>
                )}
                <div className="field"><label>Capacity</label>
                  <input type="number" min="1" value={state.tableDraft.capacity} onChange={e => actions.updateTableDraftField("capacity", e.target.value)} />
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 0, marginBottom: 18 }}>
                <button className="btn btn-ghost" onClick={actions.deselectTable}>Close</button>
                <button className="btn btn-ghost" style={{ color: "var(--error)", borderColor: "var(--error)" }} onClick={actions.deleteTable}>Delete table</button>
                <button className="btn btn-primary" onClick={actions.saveTableDraft} disabled={state.loading}>Save details</button>
              </div>

              <h4>Seats</h4>
              <ul className="seated-list">
                {seats.map(s => (
                  <li key={s.index}
                    className={`seat-row ${s.guest ? "filled" : "empty"}`}
                    onDragOver={!s.guest ? (e => e.preventDefault()) : undefined}
                    onDrop={!s.guest ? (e => handleSeatDrop(e, s.index)) : undefined}
                    onClick={!s.guest && state.armedGuest ? () => actions.assignSeat(state.armedGuest.memberId, state.armedGuest.inviteCode, selectedTable.id, s.index) : undefined}>
                    <span>Seat {s.index + 1}</span>
                    {s.guest
                      ? <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {s.guest.name}
                          <button className="unseat-btn" onClick={() => actions.assignSeat(s.guest.memberId, s.guest.inviteCode, null, null)}>Unseat</button>
                        </span>
                      : <span className="helptext" style={{ margin: 0 }}>Empty — drag or tap a guest</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selectedObject && state.objectDraft && (
            <div className="table-editor-panel">
              <h4>Edit {selectedObject.type === "line" ? "wall / barrier" : selectedObject.type}</h4>
              <div className="table-editor-row">
                <div className="field" style={{ flex: 2 }}><label>Label</label>
                  <input type="text" placeholder="e.g. Bar, Entrance, Dance floor" value={state.objectDraft.label}
                    onChange={e => actions.updateObjectDraftField("label", e.target.value)} />
                </div>
                {selectedObject.type !== "line" && (
                  <div className="field"><label>Size</label>
                    <input type="number" min="10" value={state.objectDraft.size}
                      onChange={e => actions.updateObjectDraftField("size", Number(e.target.value))} />
                  </div>
                )}
              </div>
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button className="btn btn-ghost" onClick={actions.deselectObject}>Close</button>
                <button className="btn btn-ghost" style={{ color: "var(--error)", borderColor: "var(--error)" }} onClick={actions.deleteObject}>Delete</button>
                <button className="btn btn-primary" onClick={actions.saveObjectDraft} disabled={state.loading}>Save</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Full-screen, admin-only: a large-format "find your name, find your table"
// display meant for a lobby screen/tablet or a printed poster — distinct from
// the personal per-household "Find My Seat" guest page (GuestSeating above),
// which deliberately hides everyone else's assignment. This one shows every
// seated guest, which is expected for physical venue signage but is gated
// behind admin auth (reached only via a button in the Seating tab) rather
// than a public URL, since nothing here should be reachable without the
// admin password.
function VenueDisplay({ state, actions }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // { tableId, tableLabel, seatIndex, name } | null — name/seatIndex null when selected by clicking a table rather than a guest
  const [transform, setTransform] = useState(() => fitSeatTransform(state.seatingTables));
  const [viewMode, setViewMode] = useState("2d"); // '2d' | '3d' — see issue #4
  const floorPlan3DRef = useRef(null);
  const animGenRef = useRef(0);

  const roster = [];
  Object.entries(state.guestList).forEach(([code, rec]) => {
    rec.members.forEach(m => {
      const a = state.seatingAssignments[m.id];
      if (!a) return;
      const table = state.seatingTables.find(t => t.id === a.tableId);
      roster.push({ memberId: m.id, name: m.name, tableId: a.tableId, seatIndex: a.seatIndex, tableLabel: table ? table.label : "Table" });
    });
  });
  roster.sort((a, b) => a.name.localeCompare(b.name));

  const q = query.trim().toLowerCase();
  const filtered = q ? roster.filter(g => g.name.toLowerCase().includes(q)) : roster;
  const groups = {};
  const letters = [];
  filtered.forEach(g => {
    const letter = g.name[0].toUpperCase();
    if (!groups[letter]) { groups[letter] = []; letters.push(letter); }
    groups[letter].push(g);
  });

  function animateTo(target) {
    const myGen = ++animGenRef.current;
    const from = transform;
    const start = performance.now();
    function step(now) {
      if (animGenRef.current !== myGen) return; // superseded by a newer selection — drop this animation
      const t = Math.min(1, (now - start) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      setTransform({
        panX: from.panX + (target.panX - from.panX) * eased,
        panY: from.panY + (target.panY - from.panY) * eased,
        zoom: from.zoom + (target.zoom - from.zoom) * eased
      });
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function selectGuest(g) {
    setSelected({ tableId: g.tableId, tableLabel: g.tableLabel, seatIndex: g.seatIndex, name: g.name });
    const table = state.seatingTables.find(t => t.id === g.tableId);
    if (table) animateTo(fitSeatTransform([table]));
  }
  // Reverse lookup for the 3D view: clicking a table (rather than searching a
  // name) selects it and shows everyone seated there.
  function selectTable(tableId) {
    if (!tableId) { setSelected(null); return; }
    const table = state.seatingTables.find(t => t.id === tableId);
    if (!table) { setSelected(null); return; }
    setSelected({ tableId, tableLabel: table.label, seatIndex: null, name: null });
  }
  function showWholeRoom() {
    setSelected(null);
    animateTo(fitSeatTransform(state.seatingTables));
  }

  const highlightColors = selected ? { [selected.tableId]: "#A9814C" } : {};
  const highlightSeatIndices = selected && selected.seatIndex != null ? { [selected.tableId]: new Set([selected.seatIndex]) } : {};
  const tableOccupants = selected && selected.name == null ? roster.filter(g => g.tableId === selected.tableId) : null;

  return (
    <div className="venue-display">
      <div className="venue-header">
        <div className="eyebrow">Reception Seating</div>
        <h1>{CONFIG.coupleNames}</h1>
        <div className="sub">Find your name below, then your table on the floor plan</div>
        <button className="venue-exit" onClick={() => actions.patch({ view: "admin" })}>&larr; Exit venue display</button>
      </div>
      <div className="venue-main">
        <div className="venue-panel">
          <div className="panel-head">
            <h2>Guest List</h2>
            <span className="count">{q ? `${filtered.length} of ${roster.length}` : `${roster.length} guests`}</span>
          </div>
          <div className="venue-search">
            <input type="text" value={query} placeholder="Search a name…" autoComplete="off"
              onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="venue-columns">
            {letters.map(letter => (
              <div className="letter-group" key={letter}>
                <h3>{letter}</h3>
                {groups[letter].map(g => (
                  <button key={g.memberId}
                    className={`venue-guest-row ${selected?.memberId === g.memberId ? "active" : ""}`}
                    onClick={() => selectGuest(g)}>
                    <span className="guest-name">{g.name}</span>
                    <span className="leader"></span>
                    <span className="badge">{g.tableLabel}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {filtered.length === 0 && <p className="no-match">No names match that search.</p>}
        </div>
        <div className="venue-panel">
          <div className="panel-head">
            <h2>Floor Plan</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="count">{state.seatingTables.length} tables</span>
              <div className="view-toggle">
                <button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}>2D</button>
                <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")}>3D</button>
              </div>
            </div>
          </div>
          <div className={`seating-canvas-wrap ${viewMode === "3d" ? "mode-3d" : ""}`}>
            {viewMode === "2d" ? (
              <>
                <SeatingCanvas
                  tables={state.seatingTables}
                  objects={state.seatingObjects}
                  highlightColors={highlightColors}
                  highlightSeatIndices={highlightSeatIndices}
                  viewTransform={transform}
                  onViewTransformChange={setTransform}
                />
                <div className="zoom-controls">
                  <button onClick={() => setTransform(t => zoomSeatTransform(t, 1.25))} aria-label="Zoom in">+</button>
                  <button onClick={() => setTransform(t => zoomSeatTransform(t, 1 / 1.25))} aria-label="Zoom out">−</button>
                  <button onClick={showWholeRoom} aria-label="Show whole room">⦿</button>
                </div>
              </>
            ) : (
              <>
                <Suspense fallback={<div className="fp3d-loading" role="status">Loading 3D view…</div>}>
                  <FloorPlan3D
                    ref={floorPlan3DRef}
                    tables={state.seatingTables}
                    objects={state.seatingObjects}
                    focusTableId={selected?.tableId || null}
                    onSelectTable={selectTable}
                  />
                </Suspense>
                <div className="zoom-controls">
                  <button onClick={() => floorPlan3DRef.current?.zoomIn()} aria-label="Zoom in">+</button>
                  <button onClick={() => floorPlan3DRef.current?.zoomOut()} aria-label="Zoom out">−</button>
                  <button onClick={() => { setSelected(null); floorPlan3DRef.current?.recenter(); }} aria-label="Show whole room">⦿</button>
                </div>
              </>
            )}
          </div>
          {selected && (
            <p className="helptext" style={{ marginTop: 14, textAlign: "center" }}>
              {selected.name ? (
                <><strong>{selected.name}</strong> is seated at <strong>{selected.tableLabel}</strong>.</>
              ) : tableOccupants && tableOccupants.length ? (
                <><strong>{selected.tableLabel}</strong>: {tableOccupants.map(g => g.name).join(", ")}</>
              ) : (
                <><strong>{selected.tableLabel}</strong> has no seated guests yet.</>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   ADMIN SETTINGS
   Per-event RSVP deadlines and headcount vs capacity. Capacity is
   informational only — RSVPs are never blocked when it's reached.
   The seated event's capacity is the seating tables' total, so it
   follows the floor plan instead of being typed in. See design.md §11.
   ========================================================= */
function eventHeadcount(guestList, eventId) {
  let invited = 0, attending = 0, households = 0, replied = 0;
  Object.values(guestList).forEach(rec => {
    if (!rec.invitedEvents.includes(eventId)) return;
    households++;
    invited += rec.members.length;
    if (rec.response) {
      replied++;
      // response.members includes any extra guests (plus-ones) the household added.
      attending += rec.response.members.filter(m => m.attending?.[eventId]).length;
    }
  });
  return { invited, attending, households, replied };
}

function savedCapacityStr(site, id) { return site.capacities?.[id] != null ? String(site.capacities[id]) : ""; }

/* Settings is an accordion of independent sections (one open at a time). Each
   section keeps its own unsaved draft and Save button; closed sections stay
   mounted (just hidden), so collapsing one never discards its edits. Each is
   keyed on its own saved values, so saving one section resets only that one. */
function AdminSettings({ state, actions }) {
  const [open, setOpen] = useState("events");
  const toggle = id => () => setOpen(o => (o === id ? null : id));
  const { deadlines, capacities, announcement, events, guestInfo } = state.siteSettings;
  return (
    <div className="settings-page">
      <div className="settings-intro">
        <h3>Settings</h3>
        <p>Changes show to guests the next time they open their invite — no redeploy needed.</p>
      </div>
      <EventSettings key={JSON.stringify(events)} state={state} actions={actions} open={open === "events"} onToggle={toggle("events")} />
      <DeadlineSettings key={JSON.stringify([deadlines, capacities])} state={state} actions={actions} open={open === "deadlines"} onToggle={toggle("deadlines")} />
      <AnnouncementSettings key={JSON.stringify(announcement)} state={state} actions={actions} open={open === "announcement"} onToggle={toggle("announcement")} />
      <GuestInfoSettings key={JSON.stringify(guestInfo)} state={state} actions={actions} open={open === "info"} onToggle={toggle("info")} />
    </div>
  );
}

const SETTINGS_ICON_PROPS = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const SETTINGS_ICONS = {
  events: <svg {...SETTINGS_ICON_PROPS}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>,
  deadlines: <svg {...SETTINGS_ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  announcement: <svg {...SETTINGS_ICON_PROPS}><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M16 9a4 4 0 0 1 0 6" /></svg>,
  info: <svg {...SETTINGS_ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>,
};

function SettingsAccordion({ id, title, summary, open, onToggle, dirty, children }) {
  return (
    <section className={`acc ${open ? "open" : ""}`}>
      <h4 className="acc-h">
        <button type="button" className="acc-head" id={`acc-btn-${id}`} aria-expanded={open} aria-controls={`acc-${id}`} onClick={onToggle}>
          <span className="acc-ic">{SETTINGS_ICONS[id]}</span>
          <span className="acc-text">
            <span className="acc-title">{title}{dirty && <span className="acc-dirty">Unsaved</span>}</span>
            <span className="acc-sum">{summary}</span>
          </span>
          <svg className="acc-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </h4>
      <div className="acc-body" id={`acc-${id}`} role="region" aria-labelledby={`acc-btn-${id}`} hidden={!open}>{children}</div>
    </section>
  );
}

// Time zone picker: the likely ones first, then every zone the browser knows.
const COMMON_TIME_ZONES = [
  ["Australia/Adelaide", "Adelaide"], ["Australia/Darwin", "Darwin"], ["Australia/Brisbane", "Brisbane"],
  ["Australia/Sydney", "Sydney / Melbourne / Canberra"], ["Australia/Hobart", "Hobart"], ["Australia/Perth", "Perth"],
  ["Pacific/Auckland", "Auckland"],
];
function allTimeZones() { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } }

function eventDraftFrom(ev) {
  return { name: ev.name, date: ev.date, time: ev.time, timeZone: ev.timeZone || CONFIG.timeZone, venue: ev.venue, address: ev.address || "" };
}
function eventDraftErrors(d) {
  const e = {};
  if (!d.name.trim()) e.name = "Give the event a name.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) e.date = "Pick a date.";
  if (!/^\d{2}:\d{2}$/.test(d.time)) e.time = "Pick a start time.";
  if (!isValidTimeZone(d.timeZone)) e.timeZone = "Pick a time zone.";
  if (!d.venue.trim()) e.venue = "Add the venue.";
  return e;
}

function EventSettings({ state, actions, open, onToggle }) {
  const savedDraft = Object.fromEntries(eventsList().map(e => [e.id, eventDraftFrom(e)]));
  const [draft, setDraft] = useState(savedDraft);
  const set = (id, field, value) => setDraft(d => ({ ...d, [id]: { ...d[id], [field]: value } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const errors = Object.fromEntries(eventsList().map(e => [e.id, eventDraftErrors(draft[e.id])]));
  const valid = Object.values(errors).every(e => Object.keys(e).length === 0);
  const extraZones = allTimeZones().filter(z => !COMMON_TIME_ZONES.some(([c]) => c === z));
  const summary = eventsList().map(e => `${e.name} · ${formatYmdShort(e.date, true)}`).join(" · ")
    + (eventsList().every(e => (e.timeZone || CONFIG.timeZone) === CONFIG.timeZone) ? ` · ${tzCity(CONFIG.timeZone)} time` : "");

  function save() {
    const events = Object.fromEntries(Object.entries(draft).map(([id, d]) => [id, { ...d, name: d.name.trim(), venue: d.venue.trim(), address: d.address.trim() }]));
    actions.saveSettings({ events });
  }

  return (
    <SettingsAccordion id="events" title="Event details" summary={summary} open={open} onToggle={onToggle} dirty={dirty}>
      <p className="settings-help">
        What guests see on every page and in emails. Each event's time is in its own time zone — daylight saving is
        handled for you, and the countdown and reply-by cut-off use it wherever the guest is.
      </p>
      <div className="settings-events-grid">
        {eventsList().map(ev => {
          const d = draft[ev.id], err = errors[ev.id], idp = `event-${ev.id}`;
          const preview = { ...d, name: d.name || ev.name };
          return (
            <div className="settings-card" key={ev.id}>
              <div className="field">
                <div className="settings-label-row">
                  <label htmlFor={`${idp}-name`}>Event name</label>
                  {ev.seated && <span className="settings-badge">Has seating plan</span>}
                </div>
                <input id={`${idp}-name`} className="settings-input" type="text" maxLength={100} value={d.name} onChange={e => set(ev.id, "name", e.target.value)} />
                {err.name && <div className="settings-warn">{err.name}</div>}
              </div>
              <div className="settings-two">
                <div className="field">
                  <label htmlFor={`${idp}-date`}>Date</label>
                  <input id={`${idp}-date`} className="settings-input" type="date" value={d.date} onChange={e => set(ev.id, "date", e.target.value)} />
                  {err.date && <div className="settings-warn">{err.date}</div>}
                </div>
                <div className="field">
                  <label htmlFor={`${idp}-time`}>Start time</label>
                  <input id={`${idp}-time`} className="settings-input" type="time" value={d.time} onChange={e => set(ev.id, "time", e.target.value)} />
                  {err.time && <div className="settings-warn">{err.time}</div>}
                </div>
              </div>
              <div className="field">
                <label htmlFor={`${idp}-tz`}>Time zone</label>
                <select id={`${idp}-tz`} className="settings-input" value={d.timeZone} onChange={e => set(ev.id, "timeZone", e.target.value)}>
                  <optgroup label="Common">
                    {COMMON_TIME_ZONES.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
                  </optgroup>
                  {extraZones.length > 0 && (
                    <optgroup label="All time zones">
                      {extraZones.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                    </optgroup>
                  )}
                </select>
                {!err.date && !err.time && !err.timeZone && (
                  <div className="helptext">{tzOffsetLabel(d.date, d.time, d.timeZone)} on {formatYmdShort(d.date, true)}</div>
                )}
              </div>
              <div className="field">
                <label htmlFor={`${idp}-venue`}>Venue name</label>
                <input id={`${idp}-venue`} className="settings-input" type="text" maxLength={150} value={d.venue} onChange={e => set(ev.id, "venue", e.target.value)} />
                {err.venue && <div className="settings-warn">{err.venue}</div>}
              </div>
              <div className="field">
                <label htmlFor={`${idp}-address`}>Venue address (optional)</label>
                <input id={`${idp}-address`} className="settings-input" type="text" maxLength={300} value={d.address} placeholder="e.g. 12 Smith St, Adelaide"
                  onChange={e => set(ev.id, "address", e.target.value)} />
                <div className="helptext">Used for the map and “Get Directions”. Leave blank to search by venue name.</div>
              </div>
              {Object.keys(err).length === 0 && (
                <div className="settings-preview"><span>Guests see:</span> {eventDateText(preview)} · {eventTimeText(preview)} · {d.venue.trim()}</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="settings-help" style={{ margin: "4px 0 0" }}>Adding or removing an event is a code change, because every invitation and RSVP is linked to it.</p>
      <div className={`settings-actions ${dirty ? "dirty" : ""}`}>
        <button className="btn btn-primary" disabled={state.loading || !dirty || !valid} onClick={save}>
          {state.loading ? <><span className="spinner" />Saving…</> : !dirty ? "Event details saved" : valid ? "Save event details" : "Fix the highlighted fields"}
        </button>
      </div>
    </SettingsAccordion>
  );
}

const MAX_GUEST_INFO_ITEMS = 20;

function GuestInfoSettings({ state, actions, open, onToggle }) {
  const saved = guestInfoList();
  const [items, setItems] = useState(() => saved.map(i => ({ title: i.title, body: i.body, key: genId() })));
  const clean = items.map(i => ({ title: i.title.trim(), body: i.body.trim() }));
  const dirty = JSON.stringify(clean) !== JSON.stringify(saved.map(i => ({ title: i.title, body: i.body })));
  const missingTitle = clean.some(i => !i.title);
  const update = (key, field, value) => setItems(list => list.map(i => (i.key === key ? { ...i, [field]: value } : i)));
  const move = (idx, delta) => setItems(list => {
    const next = [...list]; const [it] = next.splice(idx, 1); next.splice(idx + delta, 0, it); return next;
  });
  const summary = saved.length ? saved.map(i => i.title).join(" · ") : "Nothing extra on the Details page";

  return (
    <SettingsAccordion id="info" title="Guest information" summary={summary} open={open} onToggle={onToggle} dirty={dirty}>
      <p className="settings-help">Shown on every guest's Details page, below the events, in this order — dress code, gifts, parking, anything else.</p>
      {items.length === 0 && <p className="helptext" style={{ marginTop: 0 }}>No items — the Details page will just show the events.</p>}
      {items.map((it, idx) => (
        <div className="settings-card guest-info-item" key={it.key}>
          <div className="field">
            <label htmlFor={`info-title-${it.key}`}>Title</label>
            <input id={`info-title-${it.key}`} className="settings-input" type="text" maxLength={80} value={it.title} placeholder="e.g. Parking"
              onChange={e => update(it.key, "title", e.target.value)} />
            {!it.title.trim() && <div className="settings-warn">Add a title (or remove this item).</div>}
          </div>
          <div className="field">
            <label htmlFor={`info-body-${it.key}`}>Text</label>
            <textarea id={`info-body-${it.key}`} className="settings-input" maxLength={1000} value={it.body}
              onChange={e => update(it.key, "body", e.target.value)} />
          </div>
          <div className="settings-item-actions">
            <button type="button" className="settings-clear" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label={`Move "${it.title || "item"}" up`}>Move up</button>
            <button type="button" className="settings-clear" disabled={idx === items.length - 1} onClick={() => move(idx, 1)} aria-label={`Move "${it.title || "item"}" down`}>Move down</button>
            <button type="button" className="settings-clear danger" onClick={() => setItems(list => list.filter(i => i.key !== it.key))} aria-label={`Remove "${it.title || "item"}"`}>Remove</button>
          </div>
        </div>
      ))}
      {items.length < MAX_GUEST_INFO_ITEMS && (
        <button type="button" className="settings-add" onClick={() => setItems(list => [...list, { title: "", body: "", key: genId() }])}>+ Add an item</button>
      )}
      <div className={`settings-actions ${dirty ? "dirty" : ""}`}>
        <button className="btn btn-primary" disabled={state.loading || !dirty || missingTitle} onClick={() => actions.saveSettings({ guestInfo: clean })}>
          {state.loading ? <><span className="spinner" />Saving…</> : !dirty ? "Guest information saved" : missingTitle ? "Every item needs a title" : "Save guest information"}
        </button>
      </div>
    </SettingsAccordion>
  );
}

function AnnouncementSettings({ state, actions, open, onToggle }) {
  const saved = state.siteSettings.announcement || { message: "", until: "" };
  const [message, setMessage] = useState(saved.message);
  const [until, setUntil] = useState(saved.until);
  const dirty = message.trim() !== saved.message || (message.trim() ? until : "") !== saved.until;
  const live = activeAnnouncement(state.siteSettings);
  const summary = live ? `Showing: “${saved.message.length > 48 ? saved.message.slice(0, 48) + "…" : saved.message}”`
    : saved.message ? "Saved, but its end date has passed — not showing" : "Off — nothing showing to guests";
  return (
    <SettingsAccordion id="announcement" title="Announcement" summary={summary} open={open} onToggle={onToggle} dirty={dirty}>
      <p className="settings-help">
        A short note shown at the top of every guest's page when they open their invite — no email needed, so it reaches
        everyone, including people who haven't replied yet. Leave it blank to show nothing.
      </p>
      <div className="settings-card">
        <div className="field">
          <label htmlFor="announcement-message">Message</label>
          <textarea id="announcement-message" className="settings-input" maxLength={2000} value={message}
            placeholder="e.g. Parking at the vineyard is limited — we recommend carpooling!"
            onChange={e => setMessage(e.target.value)} />
          <div className="helptext">{message.length}/2000</div>
        </div>
        <div className="field">
          <label htmlFor="announcement-until">Show until (optional)</label>
          <div className="settings-input-row">
            <input id="announcement-until" className="settings-input" type="date" value={until} onChange={e => setUntil(e.target.value)} />
            {until && <button type="button" className="settings-clear" onClick={() => setUntil("")}>Clear</button>}
          </div>
          <div className="helptext">{until ? `Hidden from guests after ${formatYmd(until)}.` : "Shown until you remove it."}</div>
        </div>
        <div className="helptext" style={{ marginTop: 0 }}>
          Status: {live ? "showing to guests now." : saved.message ? "saved, but the end date has passed — not showing." : "nothing is showing."}
        </div>
        {message.trim() && (
          <div style={{ marginTop: 14 }}>
            <div className="helptext" style={{ marginBottom: 6 }}>Preview</div>
            <div className="announcement" style={{ marginBottom: 0 }}>
              <div className="announcement-eyebrow">A note from {CONFIG.coupleNames}</div>
              <div className="announcement-body">{message.trim()}</div>
            </div>
          </div>
        )}
      </div>
      <div className={`settings-actions ${dirty ? "dirty" : ""}`}>
        <button className="btn btn-primary" disabled={state.loading || !dirty}
          onClick={() => actions.saveSettings({ announcement: { message: message.trim(), until } })}>
          {state.loading ? <><span className="spinner" />Saving…</> : dirty ? (message.trim() ? "Save announcement" : "Remove announcement") : "Announcement saved"}
        </button>
      </div>
    </SettingsAccordion>
  );
}

function DeadlineSettings({ state, actions, open, onToggle }) {
  const hasSeated = eventsList().some(e => e.seated);
  useEffect(() => { if (hasSeated && !state.seatingLoaded && !state.seatingLoading) actions.loadSeating(); }, [state.seatingLoaded, state.seatingLoading]);

  const saved = state.siteSettings;
  const [deadlines, setDeadlines] = useState(() => Object.fromEntries(eventsList().map(e => [e.id, saved.deadlines?.[e.id] || ""])));
  const [capacities, setCapacities] = useState(() => Object.fromEntries(eventsList().filter(e => !e.seated).map(e => [e.id, savedCapacityStr(saved, e.id)])));
  const dirty = eventsList().some(e => deadlines[e.id] !== (saved.deadlines?.[e.id] || ""))
    || Object.entries(capacities).some(([id, v]) => v.trim() !== savedCapacityStr(saved, id));
  const seatCapacity = state.seatingTables.reduce((n, t) => n + (Number(t.capacity) || 0), 0);

  const summaryParts = [];
  const dlSet = eventsList().filter(e => saved.deadlines?.[e.id]);
  summaryParts.push(dlSet.length ? `Reply by ${dlSet.map(e => formatYmdShort(saved.deadlines[e.id])).join(" & ")}` : "No reply-by dates set");
  summaryParts.push(eventsList().map(e => {
    const att = eventHeadcount(state.guestList, e.id).attending;
    const cap = e.seated ? (state.seatingLoaded ? seatCapacity : null) : saved.capacities?.[e.id];
    return cap != null ? `${att} of ${cap}` : `${att}`;
  }).join(" · ") + " attending");
  return (
    <SettingsAccordion id="deadlines" title="RSVP deadlines & numbers" summary={summaryParts.join(" · ")} open={open} onToggle={onToggle} dirty={dirty}>
      <p className="settings-help">
        Each event has its own reply-by date, shown to guests on their Details page and RSVP form (only for the events
        they're invited to). Guests can still reply after it passes. Capacity is for your reference only — nothing is
        blocked when it's reached.
      </p>
      {eventsList().map(ev => {
        const hc = eventHeadcount(state.guestList, ev.id);
        const capStr = capacities[ev.id] ?? "";
        const cap = ev.seated ? (state.seatingLoaded ? seatCapacity : null) : (capStr.trim() === "" ? null : Number(capStr));
        const dl = deadlines[ev.id];
        const evDate = eventYmd(ev);
        const tooLate = dl && evDate && dl >= evDate;
        const over = cap != null && hc.attending > cap;
        return (
          <div className="settings-card" key={ev.id}>
            <div className="settings-card-head">
              <div className="settings-ev-name">{ev.name}</div>
              <div className="settings-ev-meta">{eventDateText(ev)} · {eventTimeText(ev)} · {ev.venue}</div>
            </div>
            <div className="settings-grid">
              <div className="field">
                <label htmlFor={`deadline-${ev.id}`}>Reply by</label>
                <div className="settings-input-row">
                  <input id={`deadline-${ev.id}`} className="settings-input" type="date" value={dl} max={evDate || undefined}
                    onChange={e => setDeadlines({ ...deadlines, [ev.id]: e.target.value })} />
                  {dl && <button type="button" className="settings-clear" onClick={() => setDeadlines({ ...deadlines, [ev.id]: "" })}>Clear</button>}
                </div>
                <div className="helptext">{dl ? `Guests see: "RSVP by ${formatYmd(dl)}"` : "Not set — guests won't see a reply-by date for this event."}</div>
                {tooLate && <div className="settings-warn">This is on or after the event itself ({formatYmd(evDate)}).</div>}
              </div>
              <div className="field">
                <label htmlFor={`capacity-${ev.id}`}>Capacity</label>
                {ev.seated ? (
                  <div className="settings-derived" id={`capacity-${ev.id}`}>
                    {state.seatingLoaded ? seatCapacity : "…"}
                    <span>from {state.seatingTables.length} seating table{state.seatingTables.length === 1 ? "" : "s"} — updates as you add tables</span>
                  </div>
                ) : (
                  <input id={`capacity-${ev.id}`} className="settings-input" type="number" inputMode="numeric" min="0" step="1" placeholder="e.g. 80"
                    value={capStr} onChange={e => setCapacities({ ...capacities, [ev.id]: e.target.value })} />
                )}
              </div>
            </div>
            <div className="headcount">
              <div className="headcount-row">
                <span><strong>{hc.attending}</strong> attending{cap != null ? ` of ${cap}` : ""}</span>
                <span className="sub">{hc.replied} of {hc.households} household{hc.households === 1 ? "" : "s"} replied · {hc.invited} guest{hc.invited === 1 ? "" : "s"} invited</span>
              </div>
              {cap > 0 && (
                <div className="headcount-bar" role="img" aria-label={`${hc.attending} attending of ${cap}`}>
                  <div className={over ? "over" : ""} style={{ width: `${Math.min(100, Math.round((hc.attending / cap) * 100))}%` }} />
                </div>
              )}
              {over && <div className="settings-warn">{hc.attending - cap} over capacity.</div>}
            </div>
          </div>
        );
      })}
      <div className={`settings-actions ${dirty ? "dirty" : ""}`}>
        <button className="btn btn-primary" disabled={state.loading || !dirty}
          onClick={() => actions.saveSettings({ deadlines, capacities: Object.fromEntries(Object.entries(capacities).map(([id, v]) => [id, v.trim()])) })}>
          {state.loading ? <><span className="spinner" />Saving…</> : dirty ? "Save changes" : "All changes saved"}
        </button>
      </div>
    </SettingsAccordion>
  );
}

function Admin({ state, actions }) {
  return (
    <div className="admin-shell">
      <div className="admin-topbar">
        <h2>RSVP Dashboard</h2>
        <div>
          <button className="btn-link" onClick={actions.refreshAdmin}>Refresh</button>
          &nbsp;|&nbsp;
          <button className="btn-link" onClick={actions.exitToPublic}>Sign out</button>
        </div>
      </div>
      <div className="admin-wrap">
        <div className="tabs">
          <button className={`tab-btn ${state.adminTab === "guestlist" ? "active" : ""}`} onClick={() => actions.patch({ adminTab: "guestlist" })}>Guest List</button>
          <button className={`tab-btn ${state.adminTab === "responses" ? "active" : ""}`} onClick={() => actions.patch({ adminTab: "responses" })}>Responses &amp; Stats</button>
          <button className={`tab-btn ${state.adminTab === "seating" ? "active" : ""}`} onClick={() => actions.patch({ adminTab: "seating" })}>Seating</button>
          <button className={`tab-btn ${state.adminTab === "settings" ? "active" : ""}`} onClick={() => actions.patch({ adminTab: "settings" })}>Settings</button>
        </div>
        {state.adminTab === "guestlist" && <AdminGuestList state={state} actions={actions} />}
        {state.adminTab === "responses" && <AdminResponses state={state} actions={actions} />}
        {state.adminTab === "seating" && <AdminSeating state={state} actions={actions} />}
        {state.adminTab === "settings" && <AdminSettings state={state} actions={actions} />}
      </div>
    </div>
  );
}

/* =========================================================
   APP
   ========================================================= */
export default function App() {
  const [state, setState] = useState({
    ready: false,
    view: "no-invite", // no-invite | invalid-invite | guest-landing | guest-menu | guest-location | guest-details | guest-seating | guest-form | guest-confirm | admin-login | admin | venue-display
    inviteCode: null,
    currentRecord: null,
    previewMode: false,
    step: 1,
    draft: null,
    errors: {},
    loading: false,
    toast: null,
    guestList: {},
    // Admin-set site settings (per-event RSVP deadlines; capacities are admin-only).
    // Guests get theirs from /api/invite, the admin from "get-settings".
    siteSettings: { deadlines: {}, capacities: {}, announcement: { message: "", until: "" }, events: {}, guestInfo: null },
    // admin
    adminInput: "",
    adminPassword: "",
    adminError: "",
    adminAuthed: false,
    adminTab: "guestlist", // guestlist | responses | seating | settings
    adminSearch: "",
    openRows: {},
    qrModalCode: null,
    householdDraft: null,
    editingCode: null,
    // admin: email guests (see EmailGuestsPanel)
    emailKind: "update", // update | reminder
    emailAudience: "all",
    reminderAudience: "not-replied",
    reminderSubject: "A friendly reminder to RSVP",
    reminderNote: "",
    emailSubject: "",
    emailMessage: "",
    emailSending: false,
    emailProgress: null, // { done, total } while a send is running
    emailResult: null,   // { sent, failed: [{ code, status, reason }] } after it finishes
    // admin: seating
    seatingTables: [],
    seatingAssignments: {},
    seatingObjects: [],
    seatingRevealMode: "locked",
    seatingRevealAt: null,
    seatingLoaded: false,
    seatingLoading: false,
    selectedTableId: null,
    tableDraft: null,
    selectedObjectId: null,
    objectDraft: null,
    armedGuest: null
  });

  const patch = p => setState(s => ({ ...s, ...p }));

  // Seating requests (background polling + every add/move/delete/assign) can
  // resolve out of order — e.g. a 5s poll fired before a manual "add shape"
  // click can still land after it. Without a guard, that stale response
  // overwrites the newer state and the just-added shape silently vanishes,
  // which looks exactly like "adding a shape doesn't work." This ref tracks
  // the most recently *issued* seating request; a response only gets applied
  // if it's still the newest one by the time it comes back.
  const seatingSeqRef = useRef(0);
  async function seatingMutate(action, payload) {
    const mySeq = ++seatingSeqRef.current;
    const data = await apiAdmin(state.adminPassword, action, payload);
    if (seatingSeqRef.current !== mySeq) return null; // superseded by a newer request; drop it
    patch({ seatingTables: data.tables, seatingAssignments: data.assignments, seatingObjects: data.objects, seatingRevealMode: data.revealMode, seatingRevealAt: data.revealAt });
    return data;
  }
  async function saveSeatingReveal(mode, revealAt) {
    patch({ loading: true });
    try {
      await seatingMutate("save-seating-reveal", { mode, revealAt });
      patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't save the seating reveal setting.");
    }
  }

  useEffect(() => { init(); }, []);

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (!invite) { patch({ ready: true, view: "no-invite" }); return; }
    const data = await apiGetInvite(invite);
    if (data) {
      const { site, ...rec } = data;
      patch({ ready: true, view: "guest-landing", inviteCode: invite, currentRecord: rec, siteSettings: { deadlines: {}, capacities: {}, announcement: { message: "", until: "" }, events: {}, guestInfo: null, ...site } });
    } else {
      patch({ ready: true, view: "invalid-invite" });
    }
  }

  function showToast(msg) {
    patch({ toast: msg });
    setTimeout(() => patch({ toast: null }), 3200);
  }

  /* ---------- guest flow ---------- */
  function startGuestForm() {
    const rec = state.currentRecord;
    const members = rec.response
      ? rec.response.members
      : rec.members.map(m => ({ ...m, attending: defaultAttending(rec.invitedEvents), dietaryTags: [], dietaryNote: "" }));
    patch({
      view: "guest-form",
      step: 1,
      draft: {
        members,
        contactEmail: rec.response ? rec.response.contactEmail : (rec.contactEmail || ""),
        contactPhone: rec.response ? rec.response.contactPhone : (rec.contactPhone || ""),
        notes: rec.response ? rec.response.notes : ""
      },
      errors: {}
    });
  }

  function updateDraft(field, value) { patch({ draft: { ...state.draft, [field]: value } }); }
  function updateMember(idx, field, value) {
    const members = state.draft.members.map((m, i) => (i === idx ? { ...m, [field]: value } : m));
    patch({ draft: { ...state.draft, members } });
  }
  function toggleAttend(idx, eventId) {
    const members = state.draft.members.map((m, i) =>
      i === idx ? { ...m, attending: { ...m.attending, [eventId]: !m.attending[eventId] } } : m
    );
    patch({ draft: { ...state.draft, members } });
  }
  function toggleDiet(idx, tag) {
    const members = state.draft.members.map((m, i) => {
      if (i !== idx) return m;
      const has = m.dietaryTags.includes(tag);
      return { ...m, dietaryTags: has ? m.dietaryTags.filter(t => t !== tag) : [...m.dietaryTags, tag] };
    });
    patch({ draft: { ...state.draft, members } });
  }
  function addExtraGuest() {
    const rec = state.currentRecord;
    const members = [...state.draft.members, { id: genId(), name: "", attending: defaultAttending(rec.invitedEvents), dietaryTags: [], dietaryNote: "" }];
    patch({ draft: { ...state.draft, members } });
  }
  function removeExtraGuest(idx) {
    const members = state.draft.members.filter((_, i) => i !== idx);
    patch({ draft: { ...state.draft, members } });
  }

  function validateGuestStep1() {
    const e = {};
    state.draft.members.forEach((m, i) => { if (!m.name.trim()) e["m" + i] = "Please add a name."; });
    if (!state.draft.contactEmail.trim()) e.email = "Please enter an email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.draft.contactEmail.trim())) e.email = "That email doesn't look right.";
    return e;
  }

  async function submitGuestRSVP() {
    if (state.previewMode) { showToast("This is preview mode — responses aren't saved."); return; }
    patch({ loading: true });
    try {
      const updated = await apiSubmitRsvp({
        inviteCode: state.inviteCode,
        members: state.draft.members,
        contactEmail: state.draft.contactEmail.trim(),
        contactPhone: state.draft.contactPhone,
        notes: state.draft.notes
      });
      patch({ loading: false, view: "guest-confirm", currentRecord: updated });
    } catch (e) {
      patch({ loading: false });
      showToast("Something went wrong saving your RSVP — please try again.");
    }
  }

  /* ---------- admin: auth ---------- */
  async function submitAdminLogin() {
    patch({ loading: true, adminError: "" });
    try {
      const [all, settings] = await Promise.all([apiAdmin(state.adminInput, "list"), apiAdmin(state.adminInput, "get-settings")]);
      patch({ loading: false, adminAuthed: true, adminPassword: state.adminInput, view: "admin", guestList: all, siteSettings: settings, adminTab: "guestlist" });
    } catch (e) {
      // 403 = signing in from a *.pages.dev address, which functions/api/admin.js refuses (see ADMIN_HOSTS)
      patch({ loading: false, adminError: e.status === 403 ? `Admin sign-in only works at ${CONFIG.siteBaseUrl.replace(/^https?:\/\//, "")}.` : "Incorrect password." });
    }
  }
  async function refreshAdmin() {
    patch({ loading: true });
    try {
      const [all, settings] = await Promise.all([apiAdmin(state.adminPassword, "list"), apiAdmin(state.adminPassword, "get-settings")]);
      patch({ loading: false, guestList: all, siteSettings: settings });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't refresh — please sign in again.");
    }
  }
  function exitToPublic() {
    patch({ view: "no-invite", adminAuthed: false, adminPassword: "", previewMode: false, inviteCode: null, currentRecord: null });
  }

  /* ---------- admin: guest list management ---------- */
  function newHouseholdDraft() {
    return { householdName: "", members: [{ id: genId(), name: "" }], invitedEvents: eventsList().map(e => e.id), allowPlusOne: false, personalNote: "", contactEmail: "", contactPhone: "" };
  }
  function startAddHousehold() { patch({ householdDraft: newHouseholdDraft(), editingCode: null }); }
  function startEditHousehold(code) {
    const rec = state.guestList[code];
    patch({
      householdDraft: {
        householdName: rec.householdName,
        members: rec.members.map(m => ({ ...m })),
        invitedEvents: [...rec.invitedEvents],
        allowPlusOne: rec.allowPlusOne,
        personalNote: rec.personalNote || "",
        contactEmail: rec.contactEmail || "",
        contactPhone: rec.contactPhone || ""
      },
      editingCode: code
    });
  }
  function cancelHouseholdDraft() { patch({ householdDraft: null, editingCode: null }); }
  function updateHouseholdField(field, val) { patch({ householdDraft: { ...state.householdDraft, [field]: val } }); }
  function updateHMemberName(idx, val) {
    const members = state.householdDraft.members.map((m, i) => (i === idx ? { ...m, name: val } : m));
    patch({ householdDraft: { ...state.householdDraft, members } });
  }
  function addHMember() {
    const members = [...state.householdDraft.members, { id: genId(), name: "" }];
    patch({ householdDraft: { ...state.householdDraft, members } });
  }
  function removeHMember(idx) {
    if (state.householdDraft.members.length <= 1) return;
    const members = state.householdDraft.members.filter((_, i) => i !== idx);
    patch({ householdDraft: { ...state.householdDraft, members } });
  }
  function toggleHEvent(id) {
    const cur = state.householdDraft.invitedEvents;
    const invitedEvents = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    patch({ householdDraft: { ...state.householdDraft, invitedEvents } });
  }

  async function saveHousehold() {
    const d = state.householdDraft;
    if (d.members.some(m => !m.name.trim())) { showToast("Every guest needs a name."); return; }
    if (d.invitedEvents.length === 0) { showToast("Select at least one event this household is invited to."); return; }
    if (d.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail.trim())) { showToast("That contact email doesn't look right."); return; }
    patch({ loading: true });
    try {
      const all = await apiAdmin(state.adminPassword, "save-household", {
        inviteCode: state.editingCode,
        householdName: d.householdName.trim() || d.members.map(m => m.name).join(" & "),
        members: d.members.map(m => ({ id: m.id, name: m.name.trim() })),
        invitedEvents: d.invitedEvents,
        allowPlusOne: d.allowPlusOne,
        personalNote: d.personalNote,
        contactEmail: d.contactEmail.trim(),
        contactPhone: d.contactPhone.trim()
      });
      patch({ loading: false, guestList: all, householdDraft: null, editingCode: null });
      showToast(state.editingCode ? "Household updated." : "Household added — QR code ready to share.");
    } catch (e) {
      patch({ loading: false });
      showToast("Something went wrong saving this household.");
    }
  }

  async function deleteHousehold(code) {
    patch({ loading: true });
    try {
      const all = await apiAdmin(state.adminPassword, "delete-household", { inviteCode: code });
      patch({ loading: false, guestList: all });
      if (state.seatingLoaded) loadSeating();
    } catch (e) {
      patch({ loading: false });
      showToast("Something went wrong deleting this household.");
    }
  }

  /* ---------- admin: seating chart ---------- */
  async function loadSeating(silent) {
    if (!silent) patch({ seatingLoading: true });
    try {
      const data = await seatingMutate("list-seating");
      if (data) patch({ seatingLoading: false, seatingLoaded: true });
      else if (!silent) patch({ seatingLoading: false });
    } catch (e) {
      if (!silent) {
        patch({ seatingLoading: false });
        showToast("Couldn't load the seating chart.");
      }
    }
  }
  function selectTable(id) {
    const t = state.seatingTables.find(t => t.id === id);
    patch({ selectedTableId: id, tableDraft: t ? { ...t } : null });
  }
  function deselectTable() { patch({ selectedTableId: null, tableDraft: null }); }
  function updateTableDraftField(field, value) { patch({ tableDraft: { ...state.tableDraft, [field]: value } }); }
  function setTableShape(shape) {
    const needsLength = shape === "oval" || shape === "banquet";
    patch({ tableDraft: { ...state.tableDraft, shape, size2: needsLength ? (state.tableDraft.size2 || 180) : state.tableDraft.size2 } });
  }

  async function addTable() {
    const n = state.seatingTables.length + 1;
    const table = { id: genId(), label: `Table ${n}`, shape: "round", x: 140 + ((n * 97) % 720), y: 110 + ((n * 61) % 460), size: 90, rotation: 0, capacity: 8 };
    patch({ loading: true });
    try {
      const data = await seatingMutate("save-table", table);
      if (data) patch({ loading: false, selectedTableId: table.id, tableDraft: { ...table } });
      else patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't add a table.");
    }
  }
  async function saveTableDraft() {
    const d = state.tableDraft;
    if (!d.label.trim()) { showToast("Give the table a name."); return; }
    const payload = { ...d, label: d.label.trim(), capacity: Math.max(1, Number(d.capacity) || 1) };
    patch({ loading: true });
    try {
      await seatingMutate("save-table", payload);
      // Keep the panel open (rather than closing it) so seats can be assigned right after saving details.
      patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't save the table.");
    }
  }
  async function deleteTable() {
    const id = state.selectedTableId;
    if (!id) return;
    patch({ loading: true });
    try {
      const data = await seatingMutate("delete-table", { id });
      if (data) patch({ loading: false, selectedTableId: null, tableDraft: null });
      else patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't delete the table.");
    }
  }
  async function moveTable(id, x, y) {
    const t = state.seatingTables.find(t => t.id === id);
    if (!t) return;
    patch({ seatingTables: state.seatingTables.map(tt => (tt.id === id ? { ...tt, x, y } : tt)) });
    try {
      await seatingMutate("save-table", { ...t, x, y });
    } catch (e) {
      showToast("Couldn't save the table's position.");
    }
  }
  function selectObject(id) {
    const o = id ? state.seatingObjects.find(o => o.id === id) : null;
    patch({ selectedObjectId: id, objectDraft: o ? { ...o } : null });
  }
  function deselectObject() { patch({ selectedObjectId: null, objectDraft: null }); }
  function updateObjectDraftField(field, value) { patch({ objectDraft: { ...state.objectDraft, [field]: value } }); }

  async function addObject(type) {
    const n = state.seatingObjects.length + 1;
    const baseX = 150 + ((n * 83) % 700), baseY = 150 + ((n * 47) % 400);
    const obj = type === "line"
      ? { id: genId(), type, label: "", x: baseX, y: baseY, size: 10, x2: baseX + 120, y2: baseY }
      : { id: genId(), type, label: "", x: baseX, y: baseY, size: 60, x2: null, y2: null };
    patch({ loading: true });
    try {
      const data = await seatingMutate("save-object", obj);
      if (data) patch({ loading: false, selectedObjectId: obj.id, objectDraft: { ...obj }, selectedTableId: null, tableDraft: null });
      else patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't add that.");
    }
  }
  async function saveObjectDraft() {
    const d = state.objectDraft;
    patch({ loading: true });
    try {
      await seatingMutate("save-object", { ...d, label: d.label.trim() });
      patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't save that.");
    }
  }
  async function deleteObject() {
    const id = state.selectedObjectId;
    if (!id) return;
    patch({ loading: true });
    try {
      const data = await seatingMutate("delete-object", { id });
      if (data) patch({ loading: false, selectedObjectId: null, objectDraft: null });
      else patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't delete that.");
    }
  }
  async function moveObject(id, changes) {
    const o = state.seatingObjects.find(o => o.id === id);
    if (!o) return;
    const updated = { ...o, ...changes };
    patch({ seatingObjects: state.seatingObjects.map(oo => (oo.id === id ? updated : oo)) });
    try {
      await seatingMutate("save-object", updated);
    } catch (e) {
      showToast("Couldn't save that shape's position.");
    }
  }
  function downloadFloorPlan() {
    const occupancy = {};
    Object.values(state.seatingAssignments).forEach(a => { occupancy[a.tableId] = (occupancy[a.tableId] || 0) + 1; });
    exportFloorPlanPNG(state.seatingTables, state.seatingObjects, occupancy, `${CONFIG.coupleNames} — Reception Floor Plan`);
  }
  function armGuest(memberId, inviteCode) {
    patch({ armedGuest: state.armedGuest?.memberId === memberId ? null : { memberId, inviteCode } });
  }
  async function assignSeat(memberId, inviteCode, tableId, seatIndex) {
    patch({ loading: true });
    try {
      const data = await seatingMutate("assign-seat", { memberId, inviteCode, tableId, seatIndex });
      if (data) patch({ loading: false, armedGuest: null });
      else patch({ loading: false });
    } catch (e) {
      patch({ loading: false });
      showToast(e.status === 409 ? "That seat is already taken — pick another." : "Couldn't update that seat assignment.");
    }
  }

  /* ---------- admin: site settings ---------- */
  async function saveSettings(payload) {
    patch({ loading: true });
    try {
      const settings = await apiAdmin(state.adminPassword, "save-settings", payload);
      patch({ loading: false, siteSettings: settings });
      showToast("Settings saved.");
      return true;
    } catch (e) {
      patch({ loading: false });
      showToast("Couldn't save settings — please check the values and try again.");
      return false;
    }
  }

  /* ---------- admin: email guests ---------- */
  // Sends in batches of EMAIL_BATCH_SIZE households per request (the server
  // caps it), updating a progress bar between batches. A failed batch marks
  // just its own households as failed, so the rest still go out.
  async function sendGuestEmails(codes, payload) {
    if (codes.length === 0) return;
    if (!window.confirm(`Send "${payload.subject}" to ${codes.length} household${codes.length === 1 ? "" : "s"}?`)) return;
    patch({ emailSending: true, emailProgress: { done: 0, total: codes.length }, emailResult: null });
    const action = payload.kind === "reminder" ? "send-reminders" : "send-emails";
    const results = [];
    for (let i = 0; i < codes.length; i += EMAIL_BATCH_SIZE) {
      const batch = codes.slice(i, i + EMAIL_BATCH_SIZE);
      try {
        const r = await apiAdmin(state.adminPassword, action, { codes: batch, subject: payload.subject, message: payload.message });
        results.push(...r.results);
      } catch (e) {
        results.push(...batch.map(code => ({ code, status: "failed", reason: "request failed" })));
      }
      patch({ emailProgress: { done: Math.min(i + batch.length, codes.length), total: codes.length } });
    }
    const sent = results.filter(r => r.status === "sent").length;
    const failed = results.filter(r => r.status !== "sent");
    patch({ emailSending: false, emailProgress: null, emailResult: { sent, failed }, ...(failed.length === 0 && payload.kind === "update" ? { emailSubject: "", emailMessage: "" } : {}) });
    showToast(`Sent to ${sent} household${sent === 1 ? "" : "s"}${failed.length ? `, ${failed.length} didn't go through` : ""}.`);
  }

  function previewInvite(code) {
    const rec = state.guestList[code];
    patch({ view: "guest-landing", inviteCode: code, currentRecord: rec, previewMode: true, adminAuthed: false });
  }
  function exitPreview() { patch({ view: "admin", adminAuthed: true, previewMode: false }); }

  function toggleRow(code) { patch({ openRows: { ...state.openRows, [code]: !state.openRows[code] } }); }
  function copyLink(code) {
    navigator.clipboard?.writeText(inviteUrl(code));
    showToast("Invite link copied.");
  }

  function exportCSV() {
    const all = state.guestList;
    const rows = [["Household", "Guest name", "Invited events", ...eventsList().map(e => e.name + " - RSVP"), "Dietary tags", "Dietary notes", "Contact email", "Contact phone", "Household message", "Responded at"]];
    Object.values(all).forEach(rec => {
      const respMembers = rec.response ? rec.response.members : rec.members.map(m => ({ ...m, attending: {}, dietaryTags: [], dietaryNote: "" }));
      respMembers.forEach(m => {
        rows.push([
          rec.householdName,
          m.name,
          rec.invitedEvents.map(id => eventById(id)?.name).join("; "),
          ...eventsList().map(ev => (rec.invitedEvents.includes(ev.id) ? (rec.response ? (m.attending[ev.id] ? "Yes" : "No") : "Awaiting reply") : "Not invited")),
          (m.dietaryTags || []).join("; "),
          m.dietaryNote || "",
          rec.response?.contactEmail || rec.contactEmail || "",
          rec.response?.contactPhone || rec.contactPhone || "",
          rec.response ? rec.response.notes : "",
          rec.response ? rec.response.submittedAt : ""
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => '"' + csvSafe(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "rsvp-export.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // Bag of handlers passed down to the module-level view components as one
  // `actions` prop, so those components don't need a long individual prop
  // list per handler they use.
  const actions = {
    patch, showToast,
    startGuestForm, updateDraft, updateMember, toggleAttend, toggleDiet, addExtraGuest, removeExtraGuest, validateGuestStep1, submitGuestRSVP,
    submitAdminLogin, refreshAdmin, exitToPublic,
    startAddHousehold, startEditHousehold, cancelHouseholdDraft, updateHouseholdField, updateHMemberName, addHMember, removeHMember, toggleHEvent, saveHousehold, deleteHousehold,
    sendGuestEmails,
    previewInvite, exitPreview, toggleRow, copyLink, exportCSV,
    loadSeating, selectTable, deselectTable, updateTableDraftField, addTable, saveTableDraft, deleteTable, moveTable, armGuest, assignSeat,
    selectObject, deselectObject, updateObjectDraftField, addObject, saveObjectDraft, deleteObject, moveObject,
    setTableShape, downloadFloorPlan, saveSeatingReveal,
    saveSettings
  };

  /* ========================= MASTER RENDER ========================= */
  applySiteSettings(state.siteSettings);
  if (!state.ready) return <div className="rsvp-root" />;

  let body;
  switch (state.view) {
    case "no-invite": body = <NoInvite />; break;
    case "invalid-invite": body = <InvalidInvite />; break;
    case "guest-landing": body = <GuestLanding state={state} actions={actions} />; break;
    case "guest-menu": body = <GuestMenu state={state} actions={actions} />; break;
    case "guest-location": body = <GuestLocation state={state} actions={actions} />; break;
    case "guest-details": body = <GuestDetails state={state} actions={actions} />; break;
    case "guest-seating": body = <GuestSeating state={state} actions={actions} />; break;
    case "guest-form":
      body = state.step === 1 ? <GuestFormStep1 state={state} actions={actions} />
        : state.step === 2 ? <GuestFormStep2 state={state} actions={actions} />
        : <GuestFormStep3 state={state} actions={actions} />;
      break;
    case "guest-confirm": body = <GuestConfirm state={state} />; break;
    case "admin-login": body = <AdminLogin state={state} actions={actions} />; break;
    case "admin": body = <Admin state={state} actions={actions} />; break;
    case "venue-display": body = <VenueDisplay state={state} actions={actions} />; break;
    default: body = <NoInvite />;
  }

  return (
    <div className="rsvp-root">
      <style>{CSS}</style>
      {body}
      {state.toast && <div className="toast">{state.toast}</div>}
      {state.view !== "admin" && state.view !== "admin-login" && state.view !== "venue-display" && (
        <button className="footer-link" onClick={() => patch({ view: "admin-login", adminInput: "", adminError: "" })}>Admin</button>
      )}
    </div>
  );
}
