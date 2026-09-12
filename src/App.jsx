import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* =========================================================
   CONFIG — edit this block to personalise the invitation
   ========================================================= */
const CONFIG = {
  coupleNames: "Daniel & Faith",
  events: [
    // "datetime" is a real ISO timestamp (used by the countdown widget); "date"/"time" above stay as the
    // human-readable strings shown elsewhere. Keep both in sync if you change the schedule.
    { id: "engagement", name: "Engagement Party", date: "Saturday 14 February 2027", time: "6:00 PM", datetime: "2027-02-14T18:00:00+10:30", venue: "The Grounds, Adelaide" },
    { id: "wedding", name: "Wedding Ceremony & Reception", date: "Friday 06 August 2027", time: "3:00 PM", datetime: "2027-08-06T15:00:00+09:30", venue: "Longview Vineyard, Adelaide" }
  ],
  rsvpDeadline: "Friday 1 October 2027",
  dietaryOptions: ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Nut allergy", "Other"],
  // Admin password now lives server-side only (a Cloudflare Pages secret) — see functions/api/admin.js.
  // Where this app will live once hosted (used to build QR codes / invite links).
  // Leave blank to fall back to the current browser URL.
  siteBaseUrl: "https://daniel-and-faith-wedding-rsvp.pages.dev",
  // Shown on the guest Details page, in addition to the event list above — edit freely
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
function eventById(id) { return CONFIG.events.find(e => e.id === id); }
function inviteUrl(code) {
  const base = CONFIG.siteBaseUrl || (window.location.origin + window.location.pathname);
  return `${base}?invite=${code}`;
}
function qrSrc(code) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(inviteUrl(code))}`;
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
  const ids = eventIds && eventIds.length ? eventIds : CONFIG.events.map(e => e.id);
  const upcoming = ids
    .map(id => eventById(id))
    .filter(e => e && e.datetime)
    .map(e => ({ ...e, ts: new Date(e.datetime).getTime() }))
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
.rsvp-root{font-family:var(--body);color:var(--ink);background:var(--paper);min-height:100vh;}
.rsvp-root button{font-family:inherit;cursor:pointer;}
.rsvp-root input,.rsvp-root textarea{font-family:inherit;}
.eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:600;}
.hero{min-height:100vh;background:radial-gradient(ellipse at 50% -10%,rgba(169,129,76,.18),transparent 60%),var(--ink);color:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 20px;position:relative;overflow:hidden;}
.hero::before{content:"";position:absolute;inset:18px;border:1px solid rgba(216,200,165,.35);pointer-events:none;}
.hero .eyebrow{color:var(--gold-soft);margin-bottom:18px;}
.hero h1{font-family:var(--display);font-weight:500;font-size:clamp(36px,8vw,68px);line-height:1.05;margin:0 0 10px;}
.hero .sub{font-family:var(--display);font-style:italic;font-size:clamp(15px,3vw,19px);color:var(--gold-soft);margin:0 0 30px;}
.note-quote{max-width:420px;font-family:var(--display);font-style:italic;font-size:18px;line-height:1.5;color:var(--paper);opacity:.92;margin:0 0 34px;position:relative;padding:0 10px;}
.seal{width:108px;height:108px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#C79A5E,var(--gold) 55%,#8A6636 100%);border:none;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:32px;color:var(--ink);box-shadow:0 10px 30px -8px rgba(0,0,0,.55),inset 0 2px 4px rgba(255,255,255,.35);transition:transform .3s cubic-bezier(.34,1.56,.64,1);}
.seal:hover{transform:scale(1.06) rotate(-3deg);}
.seal-caption{margin-top:16px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-soft);font-weight:500;}
.stage{min-height:100vh;background:linear-gradient(180deg,var(--ink) 0,var(--ink) 120px,var(--paper) 120px);display:flex;justify-content:center;padding:36px 16px 80px;}
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
.countdown-grid{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;}
.countdown-unit{min-width:54px;padding:6px 4px;}
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
.login-box{max-width:380px;margin:80px auto;background:#fff;border:1px solid var(--gold-soft);padding:34px 30px;box-shadow:var(--shadow);}
.footer-link{position:fixed;bottom:10px;right:12px;font-size:11px;color:rgba(75,81,72,.4);background:none;border:none;text-decoration:underline;z-index:5;}
.preview-banner{position:sticky;top:0;background:var(--gold);color:var(--ink);padding:10px 16px;text-align:center;font-size:13px;font-weight:600;z-index:20;}
.preview-banner button{margin-left:10px;background:var(--ink);color:#fff;border:none;padding:5px 12px;border-radius:14px;font-size:12px;}

/* admin */
.admin-shell{min-height:100vh;background:var(--paper-2);padding:0 0 60px;}
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
.venue-display{min-height:100vh;background:var(--paper);}
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
        <button className="choice-card" onClick={() => actions.patch({ view: "guest-seating" })}>
          <div className="ic">◈</div>
          <div><h3>Find My Seat</h3><p>See your table for the reception.</p></div>
        </button>
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
            <div className="ev-meta" style={{ marginBottom: 12 }}>{ev.date} · {ev.time}</div>
            <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 12 }}>{ev.venue}</div>
            <div style={{ border: "1px solid var(--gold-soft)", overflow: "hidden", marginBottom: 12 }}>
              <iframe title={`Map to ${ev.venue}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(ev.venue)}&z=14&output=embed`}
                width="100%" height="220" style={{ border: 0, display: "block" }} loading="lazy" />
            </div>
            <a className="btn btn-ghost" style={{ display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue)}`} target="_blank" rel="noopener noreferrer">Get Directions</a>
          </div>
        );
      })}
      <div style={{ textAlign: "center", marginTop: 10 }}>
        <button className="btn-link" onClick={() => actions.patch({ view: "guest-menu" })}>&larr; Back</button>
      </div>
    </div></div></div>
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
              <div className="slabel" style={{ fontSize: 12.5 }}>{ev.date} · {ev.time}</div>
              <div className="slabel" style={{ fontSize: 12.5 }}>{ev.venue}</div>
            </div>
          );
        })}
      </div>
      {CONFIG.details && CONFIG.details.length > 0 && (
        <div className="summary">
          {CONFIG.details.map(d => (
            <div className="srow" key={d.title}>
              <div style={{ fontWeight: 600 }}>{d.title}</div>
              <div className="slabel" style={{ fontSize: 12.5 }}>{d.body}</div>
            </div>
          ))}
        </div>
      )}
      {rec.personalNote && <p className="note-quote" style={{ color: "var(--ink)", margin: "0 0 20px" }}>&ldquo;{rec.personalNote}&rdquo;</p>}
      <p className="lede">Kindly reply by {CONFIG.rsvpDeadline}.</p>
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
      <p className="lede">Kindly reply by {CONFIG.rsvpDeadline}.</p>
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
                  <div className="ev-meta">{ev.date} · {ev.venue}</div>
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
  return (
    <div className="stage" style={{ background: "var(--paper)" }}>
      <div className="login-box">
        <div className="card-eyebrow eyebrow" style={{ textAlign: "center", color: "var(--gold)" }}>{CONFIG.coupleNames}</div>
        <h2 style={{ textAlign: "center" }}>Admin sign in</h2>
        <div className={`field ${state.adminError ? "has-err" : ""}`} style={{ marginTop: 20 }}>
          <label>Password</label>
          <input type="text" value={state.adminInput}
            onChange={e => actions.patch({ adminInput: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") actions.submitAdminLogin(); }}
            placeholder="Enter admin password" />
          {state.adminError && <div className="err">{state.adminError}</div>}
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={actions.exitToPublic}>Back</button>
          <button className="btn btn-primary" onClick={actions.submitAdminLogin} disabled={state.loading}>
            {state.loading ? <><span className="spinner" />Checking…</> : "Sign in"}
          </button>
        </div>
      </div>
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
      {CONFIG.events.map(ev => (
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
                {rec.response && <div className="member-detail">Contact: {rec.response.contactEmail} {rec.response.contactPhone ? "· " + rec.response.contactPhone : ""}</div>}
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

function BroadcastPanel({ state, actions, respondedCount }) {
  return (
    <div className="row-card" style={{ padding: 18, marginBottom: 22 }}>
      <h3 style={{ fontFamily: "var(--display)", fontSize: 20, marginTop: 0 }}>Send an update</h3>
      <p className="lede" style={{ margin: "0 0 16px", textAlign: "left" }}>
        Email everyone who's RSVP'd so far ({respondedCount}) about a change — venue update, reminder, anything else.
        (Guests who haven't replied yet don't have an email on file until they do.)
      </p>
      <div className="field">
        <label>Subject</label>
        <input type="text" value={state.broadcastSubject} placeholder="An update from us"
          onChange={e => actions.patch({ broadcastSubject: e.target.value })} />
      </div>
      <div className="field">
        <label>Message</label>
        <textarea value={state.broadcastMessage} placeholder="Write your update here…" style={{ minHeight: 110 }}
          onChange={e => actions.patch({ broadcastMessage: e.target.value })} />
      </div>
      <div className="btn-row" style={{ marginTop: 4 }}>
        <button className="btn btn-primary" onClick={actions.sendBroadcast} disabled={state.broadcastSending || respondedCount === 0}>
          {state.broadcastSending ? <><span className="spinner" />Sending…</> : "Send update"}
        </button>
      </div>
      {state.broadcastResult && (
        <p className="helptext" style={{ marginTop: 10 }}>
          Last send: {state.broadcastResult.sent} delivered{state.broadcastResult.failed ? `, ${state.broadcastResult.failed} failed` : ""}.
        </p>
      )}
    </div>
  );
}

function AdminResponses({ state, actions }) {
  const all = state.guestList;
  let records = Object.entries(all);
  const q = state.adminSearch.trim().toLowerCase();
  if (q) records = records.filter(([code, rec]) => (rec.householdName + " " + rec.members.map(m => m.name).join(" ")).toLowerCase().includes(q));

  let totalHouseholds = Object.keys(all).length, responded = 0, totalGuests = 0;
  const eventCounts = {}; CONFIG.events.forEach(e => (eventCounts[e.id] = { yes: 0 }));
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
        {CONFIG.events.map(ev => (
          <div className="stat-card" key={ev.id}><div className="num">{eventCounts[ev.id].yes}</div><div className="lbl">{ev.name} — attending</div></div>
        ))}
      </div>
      <div className="summary" style={{ marginBottom: 22 }}><strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)" }}>Dietary summary&nbsp; </strong>{dietSummary}</div>
      <BroadcastPanel state={state} actions={actions} respondedCount={responded} />
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
const SEAT_LW = 1000;
const SEAT_LH = 700;
const SEAT_PALETTE = ["#A9814C", "#6E7F63", "#C98F86", "#57654E", "#B6503F", "#8A6636"];
function colorForIndex(i) { return SEAT_PALETTE[i % SEAT_PALETTE.length]; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
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
// Every table shape reduces to a width/height box plus whether it's
// round-cornered (ellipse) or sharp (rect) — hit-testing, seat layout,
// drawing, and the occupancy-badge offset all read off this one function.
function tableDims(t) {
  switch (t.shape) {
    case "oval": return { w: t.size, h: t.size2 || t.size * 1.4, round: true };
    case "rect": return { w: t.size, h: t.size * 0.55, round: false };
    case "banquet": return { w: t.size2 || t.size * 2.5, h: t.size, round: false };
    default: return { w: t.size, h: t.size, round: true }; // 'round'
  }
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
function triangleVertices(o) {
  const r = o.size / 2;
  return [-90, 30, 150].map(deg => {
    const rad = (deg * Math.PI) / 180;
    return [o.x + Math.cos(rad) * r, o.y + Math.sin(rad) * r];
  });
}
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
// Seat layout, shared by drawing and by the admin seat-picker panel so seat
// N always means the same physical chair everywhere it's referenced.
function getSeatPositions(t) {
  const n = Math.max(1, t.capacity | 0);
  const positions = [];
  const { w, h, round } = tableDims(t);
  if (round) {
    const rx = w / 2, ry = h / 2;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      positions.push({ x: Math.cos(ang) * (rx + 12), y: Math.sin(ang) * (ry + 12) });
    }
  } else {
    const perSide = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const onTop = i < perSide;
      const idx = onTop ? i : i - perSide;
      const countInRow = onTop ? perSide : n - perSide;
      positions.push({ x: -w / 2 + (w / (countInRow + 1)) * (idx + 1), y: (onTop ? -1 : 1) * (h / 2 + 12) });
    }
  }
  return positions;
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

  const households = Object.entries(state.guestList).map(([code, rec]) => ({
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

// Schematic 3D orbit view of the same seating_tables/floor_objects data the
// 2D SeatingCanvas draws — see GitHub issue #4. Deliberately flat-shaded
// blocks in the existing palette, no walls/ceiling: this is a "which table
// is where" orbit toy for the venue-display lobby screen, not a room replica.
const FP3D_SCALE = 1 / 45; // logical floor-plan units -> three.js world units
const FP3D_TABLE_H = 0.9;
const FP3D_OBJ_H = 0.5;
const FP3D_TABLE_TOP = "#FBF7EF"; // paper — the tabletop guests would look down at
const FP3D_TABLE_SIDE = "#D8C8A5"; // gold-soft — reads as a "skirt", cheap depth cue with only flat colors
const FP3D_TABLE_EDGE = "#A9814C";
const FP3D_OBJECT_COLOR = "#C9B790"; // sits between gold-soft and paper-2, reads as a landmark not a table
const FP3D_WALL_COLOR = "#3A3F37";
const FP3D_FLOOR_COLOR = "#F3EDDF";
const FP3D_LABEL_CHIP = "#FBF7EF";
const FP3D_LABEL_TEXT = "#202B22";

function fp3dLogicalToWorld(x, y) { return [x * FP3D_SCALE, y * FP3D_SCALE]; }

// Canvas-texture sprites go blurry no matter how you tune them: minified
// (zoomed out) they alias into a grey smudge, magnified (zoomed in close)
// the same fixed-resolution bitmap gets stretched soft. Real DOM text via
// CSS2DRenderer has neither problem — it's rasterized fresh by the browser
// every frame at whatever size it's shown, and it billboards for free.
function makeFp3dLabelObject(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    font: 700 13px 'Work Sans', sans-serif; color: ${FP3D_LABEL_TEXT};
    background: ${FP3D_LABEL_CHIP}; padding: 3px 9px; border-radius: 4px;
    white-space: nowrap; pointer-events: none; user-select: none;
    box-shadow: 0 1px 3px rgba(32,43,34,.25);
  `;
  return new CSS2DObject(el);
}

// One mesh (with an edge outline as a child) per table, positioned/sized off
// the same tableDims() the 2D canvas uses so the two views can't drift apart.
// Top/side get two flat colors (not a texture) so the table reads as a
// distinct object against the floor instead of a flat-lit grey blob.
function buildFp3dTableMesh(t) {
  const { w, h, round } = tableDims(t);
  const [wx, wy] = fp3dLogicalToWorld(w, h);
  const topMat = new THREE.MeshLambertMaterial({ color: FP3D_TABLE_TOP });
  const sideMat = new THREE.MeshLambertMaterial({ color: FP3D_TABLE_SIDE });
  let geo, materials;
  if (round) {
    geo = new THREE.CylinderGeometry(0.5, 0.5, FP3D_TABLE_H, 40).scale(wx, 1, wy);
    materials = [sideMat, topMat, sideMat]; // CylinderGeometry groups: side, top, bottom
  } else {
    geo = new THREE.BoxGeometry(wx, FP3D_TABLE_H, wy);
    // BoxGeometry groups are one per face (+x,-x,+y,-y,+z,-z); remap so only
    // the top (+y, group index 2) uses the light material, everything else stays "side".
    geo.groups.forEach((g, i) => { g.materialIndex = i === 2 ? 1 : 0; });
    materials = [sideMat, topMat];
  }
  const mesh = new THREE.Mesh(geo, materials);
  const [px, py] = fp3dLogicalToWorld(t.x, t.y);
  mesh.position.set(px, FP3D_TABLE_H / 2, py);
  mesh.userData = { tableId: t.id };
  const edgeMat = new THREE.LineBasicMaterial({ color: FP3D_TABLE_EDGE });
  if (round) {
    // A full EdgesGeometry on a 40-segment cylinder draws every vertical
    // side seam, which reads as barrel-stripes rather than a table rim —
    // just the top perimeter reads as "round table" without the clutter.
    const rimPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      rimPts.push(new THREE.Vector3(Math.cos(a) * wx / 2, FP3D_TABLE_H / 2, Math.sin(a) * wy / 2));
    }
    mesh.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), edgeMat));
  } else {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat));
  }
  mesh.add(makeFp3dLabelObject(t.label).translateY(FP3D_TABLE_H / 2 + 0.55));
  return mesh;
}

// Floor landmarks (bar, doors, walls/barriers) as low, non-interactive blocks
// — same shapes as drawFloorPlan()'s 2D pass, just extruded a little.
function buildFp3dObjectMesh(o) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: o.type === "line" ? FP3D_WALL_COLOR : FP3D_OBJECT_COLOR });
  let mesh;
  if (o.type === "line") {
    const dx = o.x2 - o.x, dy = o.y2 - o.y;
    const [lenX, lenY] = fp3dLogicalToWorld(dx, dy);
    const len = Math.max(0.05, Math.hypot(lenX, lenY));
    mesh = new THREE.Mesh(new THREE.BoxGeometry(len, FP3D_OBJ_H, 0.14), mat);
    const [mx, my] = fp3dLogicalToWorld((o.x + o.x2) / 2, (o.y + o.y2) / 2);
    mesh.position.set(mx, FP3D_OBJ_H / 2, my);
    mesh.rotation.y = -Math.atan2(dy, dx);
  } else if (o.type === "rect") {
    const [sx, sy] = fp3dLogicalToWorld(o.size, o.size);
    mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, FP3D_OBJ_H, sy), mat);
    const [px, py] = fp3dLogicalToWorld(o.x, o.y);
    mesh.position.set(px, FP3D_OBJ_H / 2, py);
  } else if (o.type === "triangle") {
    const shape = new THREE.Shape();
    triangleVertices(o).forEach(([vx, vy], i) => {
      const [lx, ly] = fp3dLogicalToWorld(vx - o.x, vy - o.y);
      i === 0 ? shape.moveTo(lx, ly) : shape.lineTo(lx, ly);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: FP3D_OBJ_H, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    mesh = new THREE.Mesh(geo, mat);
    const [px, py] = fp3dLogicalToWorld(o.x, o.y);
    mesh.position.set(px, FP3D_OBJ_H / 2, py);
  } else { // 'circle'
    const [r] = fp3dLogicalToWorld(o.size / 2, 0);
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, FP3D_OBJ_H, 28), mat);
    const [px, py] = fp3dLogicalToWorld(o.x, o.y);
    mesh.position.set(px, FP3D_OBJ_H / 2, py);
  }
  group.add(mesh);
  if (o.label) group.add(makeFp3dLabelObject(o.label).translateY(FP3D_OBJ_H + 0.4).translateX(mesh.position.x).translateZ(mesh.position.z));
  return group;
}

function fp3dAnimateCamera(s, toTarget, toCamPos) {
  const fromTarget = s.controls.target.clone();
  const fromCamPos = s.camera.position.clone();
  const start = performance.now();
  const myGen = (s.focusGen || 0) + 1;
  s.focusGen = myGen;
  function step(now) {
    if (!s.camera || s.focusGen !== myGen) return;
    const t = Math.min(1, (now - start) / 500);
    const eased = 1 - Math.pow(1 - t, 3);
    s.controls.target.lerpVectors(fromTarget, toTarget, eased);
    s.camera.position.lerpVectors(fromCamPos, toCamPos, eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const FloorPlan3D = forwardRef(function FloorPlan3D({ tables, objects, focusTableId, focusColor = "#A9814C", onSelectTable }, ref) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const tableMeshesRef = useRef(new Map());
  const selectRef = useRef(onSelectTable);
  selectRef.current = onSelectTable;
  const [clickedTableId, setClickedTableId] = useState(null);

  useImperativeHandle(ref, () => ({
    zoomIn() { fp3dZoomBy(sceneRef.current, 1 / 1.25); },
    zoomOut() { fp3dZoomBy(sceneRef.current, 1.25); },
    recenter() {
      const s = sceneRef.current;
      if (!s) return;
      fp3dAnimateCamera(s, s.initialTarget.clone(), s.initialCamPos.clone());
    }
  }), []);

  // One-time scene/camera/renderer/controls setup; torn down on unmount.
  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth || 600, height = mount.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FP3D_FLOOR_COLOR);

    const [roomW, roomH] = fp3dLogicalToWorld(SEAT_LW, SEAT_LH);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    const center = new THREE.Vector3(roomW / 2, 0, roomH / 2);
    camera.position.set(center.x, Math.max(roomW, roomH) * 0.62, center.z + Math.max(roomW, roomH) * 0.75);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    // Renders real DOM text for table/landmark labels, overlaid on the WebGL
    // canvas — see makeFp3dLabelObject() for why (canvas-texture sprites blur).
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    Object.assign(labelRenderer.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
    mount.style.position = "relative";
    mount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the floor
    controls.minDistance = 3;
    controls.maxDistance = Math.max(roomW, roomH) * 2.2;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(roomW * 0.3, Math.max(roomW, roomH), roomH * 0.7);
    scene.add(dirLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(roomW, roomH),
      new THREE.MeshLambertMaterial({ color: FP3D_FLOOR_COLOR })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomW / 2, 0, roomH / 2);
    scene.add(floor);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = null;
    function onPointerDown(e) { downPos = [e.clientX, e.clientY]; }
    function onPointerUp(e) {
      if (downPos && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4) return; // was a drag/orbit, not a click
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...tableMeshesRef.current.values()], false)[0];
      const tableId = hit ? hit.object.userData.tableId : null;
      setClickedTableId(tableId);
      selectRef.current?.(tableId);
    }
    function onPointerMove(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...tableMeshesRef.current.values()], false)[0];
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    let raf = 0;
    function tick() {
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    });
    ro.observe(mount);

    sceneRef.current = {
      scene, camera, controls, contentGroup, center,
      initialCamPos: camera.position.clone(), initialTarget: center.clone()
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(labelRenderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Rebuild the table/object meshes whenever the floor plan data changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.contentGroup.traverse(obj => {
      if (obj.isCSS2DObject) { obj.element.remove(); return; } // CSS2DRenderer never removes stale elements on its own
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => { m.map?.dispose(); m.dispose(); });
      }
    });
    s.contentGroup.clear();
    tableMeshesRef.current = new Map();
    (objects || []).forEach(o => s.contentGroup.add(buildFp3dObjectMesh(o)));
    (tables || []).forEach(t => {
      const mesh = buildFp3dTableMesh(t);
      tableMeshesRef.current.set(t.id, mesh);
      s.contentGroup.add(mesh);
    });
  }, [tables, objects]);

  // Recolor for the externally-driven (guest search) or locally-clicked
  // selection, and fly the camera to whichever table is focused.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const activeId = focusTableId || clickedTableId;
    tableMeshesRef.current.forEach((mesh, id) => {
      const isActive = id === activeId;
      const [sideMat, topMat] = mesh.material;
      topMat.color.set(isActive ? focusColor : FP3D_TABLE_TOP);
      sideMat.color.set(isActive ? focusColor : FP3D_TABLE_SIDE);
    });
    const targetMesh = activeId ? tableMeshesRef.current.get(activeId) : null;
    const target = targetMesh ? targetMesh.position.clone() : s.center;
    const dist = s.camera.position.distanceTo(s.controls.target) || 6;
    const dir = s.camera.position.clone().sub(s.controls.target).normalize();
    const toDist = targetMesh ? Math.min(dist, 5) : dist;
    fp3dAnimateCamera(s, target, target.clone().add(dir.multiplyScalar(toDist)));
  }, [focusTableId, focusColor, clickedTableId]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
});

function fp3dZoomBy(s, factor) {
  if (!s) return;
  const dir = s.camera.position.clone().sub(s.controls.target);
  const dist = clamp(dir.length() * factor, s.controls.minDistance, s.controls.maxDistance);
  s.camera.position.copy(s.controls.target).add(dir.normalize().multiplyScalar(dist));
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
                <FloorPlan3D
                  ref={floorPlan3DRef}
                  tables={state.seatingTables}
                  objects={state.seatingObjects}
                  focusTableId={selected?.tableId || null}
                  onSelectTable={selectTable}
                />
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
        </div>
        {state.adminTab === "guestlist" && <AdminGuestList state={state} actions={actions} />}
        {state.adminTab === "responses" && <AdminResponses state={state} actions={actions} />}
        {state.adminTab === "seating" && <AdminSeating state={state} actions={actions} />}
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
    // admin
    adminInput: "",
    adminPassword: "",
    adminError: "",
    adminAuthed: false,
    adminTab: "guestlist", // guestlist | responses
    adminSearch: "",
    openRows: {},
    qrModalCode: null,
    householdDraft: null,
    editingCode: null,
    // admin: broadcast
    broadcastSubject: "",
    broadcastMessage: "",
    broadcastSending: false,
    broadcastResult: null,
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
    const rec = await apiGetInvite(invite);
    if (rec) {
      patch({ ready: true, view: "guest-landing", inviteCode: invite, currentRecord: rec });
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
        contactEmail: rec.response ? rec.response.contactEmail : "",
        contactPhone: rec.response ? rec.response.contactPhone : "",
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
      const all = await apiAdmin(state.adminInput, "list");
      patch({ loading: false, adminAuthed: true, adminPassword: state.adminInput, view: "admin", guestList: all, adminTab: "guestlist" });
    } catch (e) {
      patch({ loading: false, adminError: "Incorrect password." });
    }
  }
  async function refreshAdmin() {
    patch({ loading: true });
    try {
      const all = await apiAdmin(state.adminPassword, "list");
      patch({ loading: false, guestList: all });
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
    return { householdName: "", members: [{ id: genId(), name: "" }], invitedEvents: CONFIG.events.map(e => e.id), allowPlusOne: false, personalNote: "" };
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
        personalNote: rec.personalNote || ""
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
    patch({ loading: true });
    try {
      const all = await apiAdmin(state.adminPassword, "save-household", {
        inviteCode: state.editingCode,
        householdName: d.householdName.trim() || d.members.map(m => m.name).join(" & "),
        members: d.members.map(m => ({ id: m.id, name: m.name.trim() })),
        invitedEvents: d.invitedEvents,
        allowPlusOne: d.allowPlusOne,
        personalNote: d.personalNote
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

  /* ---------- admin: broadcast update to guests who've responded ---------- */
  async function sendBroadcast() {
    if (!state.broadcastSubject.trim() || !state.broadcastMessage.trim()) {
      showToast("Add a subject and message first.");
      return;
    }
    patch({ broadcastSending: true, broadcastResult: null });
    try {
      const result = await apiAdmin(state.adminPassword, "broadcast", {
        subject: state.broadcastSubject.trim(),
        message: state.broadcastMessage.trim()
      });
      patch({ broadcastSending: false, broadcastResult: result, broadcastSubject: "", broadcastMessage: "" });
      showToast(`Sent to ${result.sent} guest${result.sent === 1 ? "" : "s"}${result.failed ? `, ${result.failed} failed` : ""}.`);
    } catch (e) {
      patch({ broadcastSending: false });
      showToast("Broadcast failed to send — please try again.");
    }
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
    const rows = [["Household", "Guest name", "Invited events", ...CONFIG.events.map(e => e.name + " - RSVP"), "Dietary tags", "Dietary notes", "Contact email", "Contact phone", "Household message", "Responded at"]];
    Object.values(all).forEach(rec => {
      const respMembers = rec.response ? rec.response.members : rec.members.map(m => ({ ...m, attending: {}, dietaryTags: [], dietaryNote: "" }));
      respMembers.forEach(m => {
        rows.push([
          rec.householdName,
          m.name,
          rec.invitedEvents.map(id => eventById(id)?.name).join("; "),
          ...CONFIG.events.map(ev => (rec.invitedEvents.includes(ev.id) ? (rec.response ? (m.attending[ev.id] ? "Yes" : "No") : "Awaiting reply") : "Not invited")),
          (m.dietaryTags || []).join("; "),
          m.dietaryNote || "",
          rec.response ? rec.response.contactEmail : "",
          rec.response ? rec.response.contactPhone : "",
          rec.response ? rec.response.notes : "",
          rec.response ? rec.response.submittedAt : ""
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
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
    sendBroadcast,
    previewInvite, exitPreview, toggleRow, copyLink, exportCSV,
    loadSeating, selectTable, deselectTable, updateTableDraftField, addTable, saveTableDraft, deleteTable, moveTable, armGuest, assignSeat,
    selectObject, deselectObject, updateObjectDraftField, addObject, saveObjectDraft, deleteObject, moveObject,
    setTableShape, downloadFloorPlan, saveSeatingReveal
  };

  /* ========================= MASTER RENDER ========================= */
  if (!state.ready) return <div className="rsvp-root" style={{ minHeight: "100vh" }} />;

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
