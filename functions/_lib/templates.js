import { COUPLE_NAMES, SITE_BASE_URL } from "./config.js";
import { todayYmdIn } from "./time.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// `events` = resolveEvents(settings) from db.js: the admin's current event names.
function nameOf(events, id) { return events?.[id]?.name || id; }

function memberLines(record, events) {
  return record.response.members.map(m => {
    const attending = record.invitedEvents.filter(id => m.attending[id]).map(id => nameOf(events, id));
    const diet = (m.dietaryTags || []).join(", ") + (m.dietaryNote ? ` — ${m.dietaryNote}` : "");
    return `<li><strong>${escapeHtml(m.name)}</strong> — ${attending.length ? escapeHtml(attending.join(", ")) : "Not attending"}${diet ? ` — Dietary: ${escapeHtml(diet)}` : ""}</li>`;
  }).join("");
}

export function renderGuestConfirmationEmail(record, events) {
  return `
    <p>Hi ${escapeHtml(record.householdName)},</p>
    <p>Thanks for your RSVP! Here's what we've got on file:</p>
    <ul>${memberLines(record, events)}</ul>
    ${record.response.notes ? `<p><em>Your message:</em> ${escapeHtml(record.response.notes)}</p>` : ""}
    <p>You can reopen your invite link anytime to update your response.</p>
  `;
}

export function renderAdminNotifyEmail(record, events) {
  return `
    <p><strong>${escapeHtml(record.householdName)}</strong> just RSVP'd.</p>
    <ul>${memberLines(record, events)}</ul>
    <p>Contact: ${escapeHtml(record.response.contactEmail)}${record.response.contactPhone ? " · " + escapeHtml(record.response.contactPhone) : ""}</p>
    ${record.response.notes ? `<p><em>Message:</em> ${escapeHtml(record.response.notes)}</p>` : ""}
  `;
}

// Admin "Email guests" update. Recipients may not have replied yet, so the
// footer no longer assumes an RSVP.
export function renderUpdateEmail(record, message) {
  return `
    <p>Hi ${escapeHtml(record.householdName)},</p>
    <div>${escapeHtml(message).replace(/\n/g, "<br>")}</div>
    <p style="margin-top:24px;font-size:12px;color:#666;">You're receiving this because you're invited to celebrate with ${escapeHtml(COUPLE_NAMES)}.</p>
  `;
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

// Admin "RSVP reminder" email: personalised with the household's own invited
// events and reply-by dates, plus a button straight to their invitation.
// A reply-by date counts as passed once that date is over in the event's own time zone.
export function renderReminderEmail(record, deadlines, note, events) {
  const link = `${SITE_BASE_URL}?invite=${encodeURIComponent(record.inviteCode)}`;
  const lines = record.invitedEvents.map(id => {
    const d = deadlines[id];
    const today = todayYmdIn(events?.[id]?.timeZone || "Australia/Adelaide");
    const when = !d ? "" : d < today ? " — the reply date has passed, but we'd still love to hear from you" : ` — please reply by <strong>${formatYmd(d)}</strong>`;
    return `<li>${escapeHtml(nameOf(events, id))}${when}</li>`;
  }).join("");
  return `
    <p>Hi ${escapeHtml(record.householdName)},</p>
    <p>We'd love to know if you can celebrate with us! This is a friendly reminder to RSVP for:</p>
    <ul>${lines}</ul>
    ${note ? `<div>${escapeHtml(note).replace(/\n/g, "<br>")}</div>` : ""}
    <p style="margin:24px 0;">
      <a href="${link}" style="background:#202B22;color:#ffffff;padding:12px 22px;border-radius:22px;text-decoration:none;font-weight:600;display:inline-block;">Open your invitation</a>
    </p>
    <p>It only takes a minute, and you can change your answer any time using the same link.</p>
    <p>${escapeHtml(COUPLE_NAMES)}</p>
    <p style="margin-top:24px;font-size:12px;color:#666;">Button not working? Copy this link into your browser: ${link}</p>
  `;
}
