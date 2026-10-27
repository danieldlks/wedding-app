import { COUPLE_NAMES, SITE_BASE_URL } from "./config.js";
import { todayYmdIn } from "./time.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// `events` = resolveEvents(settings) from db.js: the admin's current event names.
function nameOf(events, id) { return events?.[id]?.name || id; }

// ---- Shared email building blocks ------------------------------------------
// Email clients ignore <style> sheets and modern CSS, so everything is tables
// and inline styles. Apple Mail loads the site's web fonts; Gmail doesn't, and
// falls back to Georgia / Helvetica.
const C = { ink: "#202B22", inkSoft: "#4A5148", paper: "#FBF7EF", paper2: "#F3EDDF", gold: "#A9814C", goldSoft: "#D8C8A5", sage: "#57654E", muted: "#8A8F86", error: "#B6503F" };
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "'Work Sans',Helvetica,Arial,sans-serif";
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">`;

const multiline = s => escapeHtml(s).replace(/\n/g, "<br>");
export function inviteLink(record) { return `${SITE_BASE_URL}?invite=${encodeURIComponent(record.inviteCode)}`; }

// Hidden first line: the preview text inbox lists show next to the subject.
const preheader = t => `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.paper2};">${escapeHtml(t)}</div>`;
const eyebrow = (t, color = C.gold) => `<div style="font-family:${SANS};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${color};font-weight:600;">${t}</div>`;
const heading = t => `<div style="font-family:${SERIF};font-size:30px;line-height:1.15;color:${C.ink};font-weight:500;margin:6px 0 0;">${t}</div>`;
const para = (t, extra = "") => `<p style="font-family:${SANS};font-size:15px;line-height:1.6;color:${C.inkSoft};margin:14px 0 0;${extra}">${t}</p>`;
const panel = rows => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:${C.paper2};border:1px solid ${C.goldSoft};border-top:none;">${rows}</table>`;
const panelRow = inner => `<tr><td style="padding:16px 18px;border-top:1px solid ${C.goldSoft};">${inner}</td></tr>`;
const panelTitle = t => `<div style="font-family:${SERIF};font-size:21px;color:${C.ink};font-weight:600;">${t}</div>`;

// `note` is an optional short line between the button and the backup link.
function inviteButton(label, href, note = "") {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;"><tr>
    <td style="background:${C.ink};border-radius:999px;">
      <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:.02em;">${label}</a>
    </td></tr></table>
  ${note ? para(note, "text-align:center;font-size:13px;margin-top:12px;") : ""}
  <p style="font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted};text-align:center;margin:14px 0 0;">Button not working? Open this link:<br><a href="${href}" style="color:${C.gold};word-break:break-all;">${href.replace(/^https?:\/\//, "")}</a></p>`;
}

// Guest email shell: dark green header band, cream card, signed footer.
function guestShell(record, preview, body) {
  const couple = escapeHtml(COUPLE_NAMES).replace("&amp;", `<span style="font-style:italic;color:${C.goldSoft};">&amp;</span>`);
  return `${FONTS}${preheader(preview)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper2};">
<tr><td align="center" style="padding:20px 12px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${C.paper};border:1px solid ${C.goldSoft};">
    <tr><td align="center" style="background:${C.ink};padding:30px 24px 26px;">
      ${eyebrow("The wedding of", C.goldSoft)}
      <div style="font-family:${SERIF};font-size:38px;line-height:1.1;color:${C.paper};font-weight:500;margin-top:8px;">${couple}</div>
      <div style="width:44px;height:1px;background:${C.gold};margin:16px auto 0;line-height:1px;font-size:1px;">&nbsp;</div>
    </td></tr>
    <tr><td style="padding:30px 26px 8px;">
      ${eyebrow("To " + escapeHtml(record.householdName), C.sage)}
      ${body}
      <div style="height:1px;background:${C.goldSoft};margin:26px 0 0;line-height:1px;font-size:1px;">&nbsp;</div>
      <div style="font-family:${SERIF};font-size:20px;font-style:italic;color:${C.ink};text-align:center;margin:22px 0 0;">With love, ${escapeHtml(COUPLE_NAMES)}</div>
    </td></tr>
    <tr><td align="center" style="padding:18px 26px 26px;">
      <div style="font-family:${SANS};font-size:11px;line-height:1.5;color:${C.muted};">You're receiving this because you're invited to celebrate with ${escapeHtml(COUPLE_NAMES)}.</div>
    </td></tr>
  </table>
</td></tr></table>`;
}

function dietText(m) {
  return [(m.dietaryTags || []).join(", "), m.dietaryNote || ""].filter(Boolean).join(": ");
}
const attendsAny = (record, m) => record.invitedEvents.some(id => m.attending?.[id]);

// ---- Guest: RSVP confirmation ----------------------------------------------
// Sent after every RSVP (first reply or a change). `deadlines` are the saved
// reply-by dates; `updated` is true when the household had already replied.
export function renderGuestConfirmationEmail(record, events, { deadlines = {}, updated = false } = {}) {
  const members = record.response.members;
  const anyone = members.some(m => attendsAny(record, m));
  const cards = record.invitedEvents.map(id => {
    const going = members.filter(m => m.attending?.[id]).map(m => escapeHtml(m.name));
    const notGoing = members.filter(m => !m.attending?.[id]).map(m => escapeHtml(m.name));
    return panelRow(`${panelTitle(escapeHtml(nameOf(events, id)))}
      ${going.length ? `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${C.inkSoft};margin-top:6px;"><span style="color:${C.sage};font-weight:600;">&#10003;&nbsp;Attending</span> &nbsp;${going.join(", ")}</div>` : ""}
      ${notGoing.length ? `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${C.muted};margin-top:3px;">&#10005;&nbsp;Can't make it &nbsp;${notGoing.join(", ")}</div>` : ""}`);
  }).join("");
  const diets = members.filter(m => attendsAny(record, m) && dietText(m)).map(m => `${escapeHtml(m.name)} &mdash; ${escapeHtml(dietText(m))}`);
  const dietRow = diets.length ? panelRow(`${eyebrow("Dietary notes")}<div style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.inkSoft};margin-top:6px;">${diets.join("<br>")}</div>`) : "";
  const hasDeadline = record.invitedEvents.some(id => deadlines[id]);
  return guestShell(record, "Here's a summary of your RSVP, plus your personal invitation link.", `
    ${heading(updated ? "Thanks for updating your RSVP" : "Thank you for your RSVP")}
    ${para(anyone
      ? "We're so happy you'll be celebrating with us. Here's what we have for your household:"
      : "We'll miss you, and thank you for letting us know. Here's what we have for your household:")}
    ${panel(cards + dietRow)}
    ${para(`Plans change, and that's okay. You can update your answers any time${hasDeadline ? " before the reply-by date" : ""} using your personal invitation.`, "text-align:center;margin-top:24px;")}
    ${inviteButton("View or update your RSVP", inviteLink(record))}`);
}

// ---- Guest: admin "Email guests" update ------------------------------------
// Recipients may not have replied yet, so nothing here assumes an RSVP.
export function renderUpdateEmail(record, subject, message) {
  return guestShell(record, message.slice(0, 120), `
    ${heading(escapeHtml(subject))}
    ${para(multiline(message))}
    ${inviteButton("Open your invitation", inviteLink(record), "Your invitation has the venue, map and all the details in one place.")}`);
}

// ---- Admin: new / updated RSVP alert ---------------------------------------
export function renderAdminNotifyEmail(record, events, { updated = false } = {}) {
  const r = record.response;
  const members = r.members;
  const ids = record.invitedEvents;
  const coming = members.filter(m => attendsAny(record, m)).length;
  // Short labels ("Engagement", "Wedding") keep the per-person column narrow on
  // a phone, but only when each event's first word is still unique.
  const firstWord = id => nameOf(events, id).split(/\s+/)[0];
  const short = new Set(ids.map(firstWord)).size === ids.length;
  const label = id => escapeHtml(short ? firstWord(id) : nameOf(events, id));
  const perEvent = ids.map(id => `${label(id)} ${members.filter(m => m.attending?.[id]).length}`).join(" &middot; ");
  const mark = (id, ok) => `<span style="color:${ok ? C.sage : C.muted};font-weight:${ok ? 600 : 400};white-space:nowrap;">${ok ? "&#10003;" : "&#10005;"}&nbsp;${label(id)}</span>`;
  const rows = members.map(m => `
    <tr>
      <td valign="top" style="padding:10px 10px 10px 0;border-top:1px solid #E6E0D2;font-family:${SANS};font-size:14px;color:${C.ink};font-weight:600;">${escapeHtml(m.name)}${dietText(m) ? `<div style="font-weight:400;font-size:12px;line-height:1.4;color:${C.error};margin-top:2px;">${escapeHtml(dietText(m))}</div>` : ""}</td>
      <td valign="top" style="padding:10px 0;border-top:1px solid #E6E0D2;font-family:${SANS};font-size:13px;line-height:1.6;text-align:right;width:${short ? "120px" : "48%"};">${ids.map(id => mark(id, m.attending?.[id])).join("<br>")}</td>
    </tr>`).join("");
  const link = (href, t) => `<a href="${href}" style="color:${C.gold};">${t}</a>`;
  const contact = [link(`mailto:${escapeHtml(r.contactEmail)}`, escapeHtml(r.contactEmail)),
    r.contactPhone ? link(`tel:${escapeHtml(r.contactPhone.replace(/[^\d+]/g, ""))}`, escapeHtml(r.contactPhone)) : ""].filter(Boolean).join(" &middot; ");
  return `${FONTS}${preheader(`${coming} of ${members.length} attending`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F2EE;">
<tr><td align="center" style="padding:20px 12px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #E6E0D2;border-top:4px solid ${C.ink};">
    <tr><td style="padding:22px 22px 6px;">
      ${eyebrow(updated ? "Updated RSVP" : "New RSVP")}
      <div style="font-family:${SERIF};font-size:26px;color:${C.ink};font-weight:600;margin-top:4px;">${escapeHtml(record.householdName)}</div>
      <div style="font-family:${SANS};font-size:13px;line-height:1.5;color:${C.inkSoft};margin-top:4px;">${coming} of ${members.length} attending &middot; ${perEvent}</div>
    </td></tr>
    <tr><td style="padding:10px 22px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
    </td></tr>
    ${r.notes ? `<tr><td style="padding:14px 22px 0;">
      <div style="background:${C.paper};border-left:2px solid ${C.gold};padding:10px 14px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.ink};font-style:italic;">&ldquo;${multiline(r.notes)}&rdquo;</div>
    </td></tr>` : ""}
    <tr><td style="padding:16px 22px 22px;font-family:${SANS};font-size:13px;line-height:1.7;color:${C.inkSoft};">
      ${contact}<br>
      Invite code ${escapeHtml(record.inviteCode)} &middot; ${link(SITE_BASE_URL, "Open the site")}
    </td></tr>
  </table>
</td></tr></table>`;
}

// Where an admin email goes: the guest's own RSVP address if they've replied,
// otherwise the contact email the admin entered for the household.
export function recipientFor(record) {
  return record.response?.contactEmail || record.contactEmail || "";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// 'YYYY-MM-DD' -> "Thursday 15 April 2027" (same wording as the guest pages).
export function formatYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

// ---- Guest: RSVP reminder ----------------------------------------------------
// Personalised with the household's own invited events and reply-by dates. A
// reply-by date counts as passed once that date is over in the event's own time zone.
export function renderReminderEmail(record, deadlines, note, events) {
  const rows = record.invitedEvents.map(id => {
    const d = deadlines[id];
    const today = todayYmdIn(events?.[id]?.timeZone || "Australia/Adelaide");
    const when = !d ? ""
      : d < today ? `<div style="font-family:${SANS};font-size:14px;color:${C.inkSoft};margin-top:4px;">The reply date has passed, but we'd still love to hear from you</div>`
      : `<div style="font-family:${SANS};font-size:14px;color:${C.inkSoft};margin-top:4px;">Please reply by <strong style="color:${C.gold};">${formatYmd(d)}</strong></div>`;
    return panelRow(panelTitle(escapeHtml(nameOf(events, id))) + when);
  }).join("");
  return guestShell(record, "A friendly reminder to RSVP. It only takes a minute.", `
    ${heading("We'd love to hear from you")}
    ${para("Just a friendly reminder that we haven't received your RSVP yet. You're invited to:")}
    ${panel(rows)}
    ${note ? para(multiline(note)) : ""}
    ${inviteButton("Open your invitation", inviteLink(record), "It only takes a minute, and you can change your answer any time.")}`);
}
