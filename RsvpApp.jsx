import { useState, useEffect } from "react";

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
  adminPassword: "dlow96", // <-- change this before sharing the app
  // Where this app will live once hosted (used to build QR codes / invite links).
  // Leave blank to fall back to the current browser URL.
  siteBaseUrl: "",
  // Shown on the guest Details page, in addition to the event list above — edit freely
  details: [
    { title: "Dress Code", body: "Cocktail / semi-formal attire." },
    { title: "Gifts", body: "Your presence is the only present we need — details will follow closer to the date if you'd still like to contribute." }
  ]
};
const STORAGE_KEY = "wedding-guestlist";

/* =========================================================
   PURE HELPERS
   ========================================================= */
function genId() { return Math.random().toString(36).slice(2, 9); }
function genInviteCode(existing) {
  let code;
  do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (existing[code]);
  return code;
}
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

async function loadGuestList() {
  try {
    const res = await window.storage.get(STORAGE_KEY, true);
    return res && res.value ? JSON.parse(res.value) : {};
  } catch (e) {
    return {};
  }
}
async function saveGuestList(all) {
  return await window.storage.set(STORAGE_KEY, JSON.stringify(all), true);
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
`;

/* =========================================================
   APP
   ========================================================= */
export default function App() {
  const [state, setState] = useState({
    ready: false,
    view: "no-invite", // no-invite | invalid-invite | guest-landing | guest-menu | guest-location | guest-details | guest-form | guest-confirm | admin-login | admin
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
    adminError: "",
    adminAuthed: false,
    adminTab: "guestlist", // guestlist | responses
    adminSearch: "",
    openRows: {},
    qrModalCode: null,
    householdDraft: null,
    editingCode: null
  });

  const patch = p => setState(s => ({ ...s, ...p }));

  useEffect(() => { init(); }, []);

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    const all = await loadGuestList();
    if (invite && all[invite]) {
      patch({ ready: true, guestList: all, view: "guest-landing", inviteCode: invite, currentRecord: all[invite] });
    } else if (invite) {
      patch({ ready: true, guestList: all, view: "invalid-invite" });
    } else {
      patch({ ready: true, guestList: all, view: "no-invite" });
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
      const all = await loadGuestList();
      const rec = all[state.inviteCode] || state.currentRecord;
      rec.response = {
        members: state.draft.members,
        contactEmail: state.draft.contactEmail.trim(),
        contactPhone: state.draft.contactPhone,
        notes: state.draft.notes,
        submittedAt: new Date().toISOString()
      };
      all[state.inviteCode] = rec;
      const res = await saveGuestList(all);
      if (!res) throw new Error("save failed");
      patch({ loading: false, view: "guest-confirm", currentRecord: rec, guestList: all });
    } catch (e) {
      patch({ loading: false });
      showToast("Something went wrong saving your RSVP — please try again.");
    }
  }

  /* ---------- admin: auth ---------- */
  async function submitAdminLogin() {
    if (state.adminInput === CONFIG.adminPassword) {
      patch({ loading: true });
      const all = await loadGuestList();
      patch({ loading: false, adminAuthed: true, view: "admin", guestList: all, adminTab: "guestlist" });
    } else {
      patch({ adminError: "Incorrect password." });
    }
  }
  async function refreshAdmin() {
    patch({ loading: true });
    const all = await loadGuestList();
    patch({ loading: false, guestList: all });
  }
  function exitToPublic() {
    patch({ view: "no-invite", adminAuthed: false, previewMode: false, inviteCode: null, currentRecord: null });
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
    const all = await loadGuestList();
    const code = state.editingCode || genInviteCode(all);
    const existing = all[code] || {};
    all[code] = {
      inviteCode: code,
      householdName: d.householdName.trim() || d.members.map(m => m.name).join(" & "),
      members: d.members.map(m => ({ id: m.id, name: m.name.trim() })),
      invitedEvents: d.invitedEvents,
      allowPlusOne: d.allowPlusOne,
      personalNote: d.personalNote,
      createdAt: existing.createdAt || new Date().toISOString(),
      response: existing.response || null
    };
    await saveGuestList(all);
    patch({ loading: false, guestList: all, householdDraft: null, editingCode: null });
    showToast(state.editingCode ? "Household updated." : "Household added — QR code ready to share.");
  }

  async function deleteHousehold(code) {
    patch({ loading: true });
    const all = await loadGuestList();
    delete all[code];
    await saveGuestList(all);
    patch({ loading: false, guestList: all });
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

  /* ========================= RENDER HELPERS ========================= */
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

  /* ---------- guest views ---------- */
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
  function GuestLanding() {
    const rec = state.currentRecord;
    return (
      <div className="hero">
        {state.previewMode && (
          <div className="preview-banner" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
            Previewing {rec.householdName}'s invite <button onClick={exitPreview}>Exit preview</button>
          </div>
        )}
        <div className="eyebrow">Dear {rec.householdName}</div>
        <h1>You're Invited</h1>
        <div className="sub">{rec.invitedEvents.map(id => eventById(id)?.name).join(" & ")}</div>
        {rec.personalNote && <p className="note-quote">&ldquo;{rec.personalNote}&rdquo;</p>}
        <div>
          <button className="seal" onClick={() => patch({ view: "guest-menu" })}>{rec.householdName.split(/[&,]/)[0].trim()[0] || "♥"}</button>
          <div className="seal-caption">Break the seal to continue</div>
        </div>
      </div>
    );
  }

  function GuestMenu() {
    const rec = state.currentRecord;
    return (
      <div className="stage"><div className="card"><div className="card-inner">
        <div className="card-eyebrow eyebrow" style={{ textAlign: "center" }}>{rec.householdName}</div>
        <CountdownWidget eventIds={rec.invitedEvents} />
        <h2>Welcome</h2>
        <p className="lede">We can't wait to celebrate with you. What would you like to do?</p>
        <div className="choice-grid">
          <button className="choice-card" onClick={startGuestForm}>
            <div className="ic">✎</div>
            <div><h3>RSVP</h3><p>{rec.response ? "View or update your response." : "Let us know who's coming and any dietary needs."}</p></div>
          </button>
          <button className="choice-card" onClick={() => patch({ view: "guest-location" })}>
            <div className="ic">⚑</div>
            <div><h3>Location</h3><p>Venue details and directions.</p></div>
          </button>
          <button className="choice-card" onClick={() => patch({ view: "guest-details" })}>
            <div className="ic">✦</div>
            <div><h3>Details</h3><p>Dates, times, dress code and other info.</p></div>
          </button>
        </div>
        {state.previewMode && (
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button className="btn-link" onClick={exitPreview}>Exit preview</button>
          </div>
        )}
      </div></div></div>
    );
  }

  function GuestLocation() {
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
          <button className="btn-link" onClick={() => patch({ view: "guest-menu" })}>&larr; Back</button>
        </div>
      </div></div></div>
    );
  }

  function GuestDetails() {
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
          <button className="btn-link" onClick={() => patch({ view: "guest-menu" })}>&larr; Back</button>
        </div>
      </div></div></div>
    );
  }

  function GuestFormStep1() {
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
                onChange={ev => updateMember(i, "name", ev.target.value)} />
              {i >= rec.members.length && (
                <button className="remove-link" onClick={() => removeExtraGuest(i)}>Remove</button>
              )}
            </div>
            {e["m" + i] && <div className="err">{e["m" + i]}</div>}
          </div>
        ))}
        {rec.allowPlusOne && (
          <button className="add-member-btn" onClick={addExtraGuest} style={{ marginBottom: 20 }}>+ Add a guest</button>
        )}
        <div className={`field ${e.email ? "has-err" : ""}`}>
          <label>Email address</label>
          <input type="email" value={d.contactEmail} placeholder="you@example.com"
            onChange={ev => updateDraft("contactEmail", ev.target.value)} />
          {e.email ? <div className="err">{e.email}</div> : <div className="helptext">So we can reach you if plans change.</div>}
        </div>
        <div className="field">
          <label>Phone (optional)</label>
          <input type="tel" value={d.contactPhone} placeholder="04xx xxx xxx"
            onChange={ev => updateDraft("contactPhone", ev.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => patch({ view: "guest-menu" })}>Back</button>
          <button className="btn btn-primary" onClick={() => {
            const errs = validateGuestStep1();
            if (Object.keys(errs).length) { patch({ errors: errs }); return; }
            patch({ step: 2, errors: {} });
          }}>Continue</button>
        </div>
      </div></div></div>
    );
  }

  function GuestFormStep2() {
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
                    <button className={`toggle-btn yes ${m.attending[id] ? "on" : ""}`} onClick={() => toggleAttend(i, id)}>Yes</button>
                    <button className={`toggle-btn no ${!m.attending[id] ? "on" : ""}`} onClick={() => toggleAttend(i, id)}>No</button>
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", marginBottom: 8 }}>Dietary requirements</label>
              <div className="tag-row">
                {CONFIG.dietaryOptions.map(tag => (
                  <button key={tag} className={`tag ${m.dietaryTags.includes(tag) ? "on" : ""}`} onClick={() => toggleDiet(i, tag)}>{tag}</button>
                ))}
              </div>
              <textarea placeholder="Any details we should know…" value={m.dietaryNote}
                onChange={ev => updateMember(i, "dietaryNote", ev.target.value)} />
            </div>
          </div>
        ))}
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => patch({ step: 1 })}>Back</button>
          <button className="btn btn-primary" onClick={() => patch({ step: 3 })}>Continue</button>
        </div>
      </div></div></div>
    );
  }

  function GuestFormStep3() {
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
            onChange={ev => updateDraft("notes", ev.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => patch({ step: 2 })}>Back</button>
          <button className="btn btn-primary" onClick={submitGuestRSVP} disabled={state.loading}>
            {state.loading ? <><span className="spinner" />Sending…</> : (rec.response ? "Update RSVP" : "Send RSVP")}
          </button>
        </div>
      </div></div></div>
    );
  }

  function GuestConfirm() {
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

  /* ---------- admin views ---------- */
  function AdminLogin() {
    return (
      <div className="stage" style={{ background: "var(--paper)" }}>
        <div className="login-box">
          <div className="card-eyebrow eyebrow" style={{ textAlign: "center", color: "var(--gold)" }}>{CONFIG.coupleNames}</div>
          <h2 style={{ textAlign: "center" }}>Admin sign in</h2>
          <div className={`field ${state.adminError ? "has-err" : ""}`} style={{ marginTop: 20 }}>
            <label>Password</label>
            <input type="text" value={state.adminInput}
              onChange={e => patch({ adminInput: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") submitAdminLogin(); }}
              placeholder="Enter admin password" />
            {state.adminError && <div className="err">{state.adminError}</div>}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={exitToPublic}>Back</button>
            <button className="btn btn-primary" onClick={submitAdminLogin} disabled={state.loading}>
              {state.loading ? <><span className="spinner" />Checking…</> : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function HouseholdEditor() {
    const d = state.householdDraft;
    return (
      <div className="row-card" style={{ padding: 18, marginBottom: 22, borderColor: "var(--sage)" }}>
        <h3 style={{ fontFamily: "var(--display)", fontSize: 20, marginTop: 0 }}>{state.editingCode ? "Edit household" : "Add a household"}</h3>
        <div className="field">
          <label>Household name (optional — auto-filled from guest names)</label>
          <input type="text" value={d.householdName} placeholder="e.g. The Smith Family"
            onChange={e => updateHouseholdField("householdName", e.target.value)} />
        </div>
        {d.members.map((m, i) => (
          <div className="field" key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label>{i === 0 ? "Guest 1" : `Guest ${i + 1}`}</label>
              <input type="text" value={m.name} placeholder="Guest name" onChange={e => updateHMemberName(i, e.target.value)} />
            </div>
            {d.members.length > 1 && <button className="remove-link" onClick={() => removeHMember(i)}>Remove</button>}
          </div>
        ))}
        <button className="add-member-btn" onClick={addHMember} style={{ marginBottom: 18 }}>+ Add guest to household</button>

        <label style={{ display: "block", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, color: "var(--ink-soft)", marginBottom: 6 }}>Invited to</label>
        {CONFIG.events.map(ev => (
          <label className="checkbox-row" key={ev.id}>
            <input type="checkbox" checked={d.invitedEvents.includes(ev.id)} onChange={() => toggleHEvent(ev.id)} />
            {ev.name}
          </label>
        ))}
        <label className="checkbox-row">
          <input type="checkbox" checked={d.allowPlusOne} onChange={e => updateHouseholdField("allowPlusOne", e.target.checked)} />
          Allow this household to add an extra guest
        </label>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Personal note (shown on their RSVP page)</label>
          <textarea placeholder="We're so excited to have you at the ceremony!" value={d.personalNote}
            onChange={e => updateHouseholdField("personalNote", e.target.value)} />
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" onClick={cancelHouseholdDraft}>Cancel</button>
          <button className="btn btn-primary" onClick={saveHousehold} disabled={state.loading}>
            {state.loading ? <><span className="spinner" />Saving…</> : "Save household"}
          </button>
        </div>
      </div>
    );
  }

  function QrModal() {
    if (!state.qrModalCode) return null;
    const code = state.qrModalCode;
    const rec = state.guestList[code];
    return (
      <div className="qr-modal-backdrop" onClick={() => patch({ qrModalCode: null })}>
        <div className="qr-modal" onClick={e => e.stopPropagation()}>
          <h3 style={{ fontFamily: "var(--display)", marginTop: 0 }}>{rec.householdName}</h3>
          <img src={qrSrc(code)} alt={`QR code for ${rec.householdName}`} />
          <div className="link-box">{inviteUrl(code)}</div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn btn-ghost" onClick={() => copyLink(code)}>Copy link</button>
            <button className="btn btn-primary" onClick={() => patch({ qrModalCode: null })}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  function AdminGuestList() {
    const records = Object.entries(state.guestList);
    return (
      <>
        {!state.householdDraft && (
          <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={startAddHousehold}>+ Add household</button>
        )}
        {state.householdDraft && <HouseholdEditor />}
        {records.length === 0 && !state.householdDraft && (
          <div className="empty-state"><div className="em-ic">✦</div>No households yet — add one to generate its QR code.</div>
        )}
        {records.map(([code, rec]) => {
          const open = !!state.openRows[code];
          const status = !rec.response ? "pending" : (rec.response.members.some(m => rec.invitedEvents.some(id => m.attending[id])) ? "yes" : "no");
          return (
            <div className="row-card" key={code}>
              <div className="row-head" onClick={() => toggleRow(code)}>
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
                    <button onClick={() => patch({ qrModalCode: code })}>Show QR code</button>
                    <button onClick={() => copyLink(code)}>Copy link</button>
                    <button onClick={() => previewInvite(code)}>Preview as guest</button>
                    <button onClick={() => startEditHousehold(code)}>Edit</button>
                    <button onClick={() => deleteHousehold(code)} style={{ color: "var(--error)" }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <QrModal />
      </>
    );
  }

  function AdminResponses() {
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
        <div className="admin-controls">
          <input type="text" placeholder="Search by name…" value={state.adminSearch} onChange={e => patch({ adminSearch: e.target.value })} />
          <button className="btn btn-ghost" style={{ flex: "none" }} onClick={exportCSV}>Export CSV</button>
        </div>
        {records.length === 0 && <div className="empty-state"><div className="em-ic">✦</div>No RSVPs match yet.</div>}
        {records.map(([code, rec]) => {
          const open = !!state.openRows["r" + code];
          const status = !rec.response ? "pending" : (rec.response.members.some(m => rec.invitedEvents.some(id => m.attending[id])) ? "yes" : "no");
          return (
            <div className="row-card" key={code}>
              <div className="row-head" onClick={() => patch({ openRows: { ...state.openRows, ["r" + code]: !open } })}>
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

  function Admin() {
    return (
      <div className="admin-shell">
        <div className="admin-topbar">
          <h2>RSVP Dashboard</h2>
          <div>
            <button className="btn-link" onClick={refreshAdmin}>Refresh</button>
            &nbsp;|&nbsp;
            <button className="btn-link" onClick={exitToPublic}>Sign out</button>
          </div>
        </div>
        <div className="admin-wrap">
          <div className="tabs">
            <button className={`tab-btn ${state.adminTab === "guestlist" ? "active" : ""}`} onClick={() => patch({ adminTab: "guestlist" })}>Guest List</button>
            <button className={`tab-btn ${state.adminTab === "responses" ? "active" : ""}`} onClick={() => patch({ adminTab: "responses" })}>Responses &amp; Stats</button>
          </div>
          {state.adminTab === "guestlist" ? <AdminGuestList /> : <AdminResponses />}
        </div>
      </div>
    );
  }

  /* ========================= MASTER RENDER ========================= */
  if (!state.ready) return <div className="rsvp-root" style={{ minHeight: "100vh" }} />;

  let body;
  switch (state.view) {
    case "no-invite": body = <NoInvite />; break;
    case "invalid-invite": body = <InvalidInvite />; break;
    case "guest-landing": body = <GuestLanding />; break;
    case "guest-menu": body = <GuestMenu />; break;
    case "guest-location": body = <GuestLocation />; break;
    case "guest-details": body = <GuestDetails />; break;
    case "guest-form":
      body = state.step === 1 ? <GuestFormStep1 /> : state.step === 2 ? <GuestFormStep2 /> : <GuestFormStep3 />;
      break;
    case "guest-confirm": body = <GuestConfirm />; break;
    case "admin-login": body = <AdminLogin />; break;
    case "admin": body = <Admin />; break;
    default: body = <NoInvite />;
  }

  return (
    <div className="rsvp-root">
      <style>{CSS}</style>
      {body}
      {state.toast && <div className="toast">{state.toast}</div>}
      {state.view !== "admin" && state.view !== "admin-login" && (
        <button className="footer-link" onClick={() => patch({ view: "admin-login", adminInput: "", adminError: "" })}>Admin</button>
      )}
    </div>
  );
}
