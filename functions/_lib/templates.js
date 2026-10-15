import { eventName, COUPLE_NAMES } from "./config.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function memberLines(record) {
  return record.response.members.map(m => {
    const attending = record.invitedEvents.filter(id => m.attending[id]).map(eventName);
    const diet = (m.dietaryTags || []).join(", ") + (m.dietaryNote ? ` — ${m.dietaryNote}` : "");
    return `<li><strong>${escapeHtml(m.name)}</strong> — ${attending.length ? escapeHtml(attending.join(", ")) : "Not attending"}${diet ? ` — Dietary: ${escapeHtml(diet)}` : ""}</li>`;
  }).join("");
}

export function renderGuestConfirmationEmail(record) {
  return `
    <p>Hi ${escapeHtml(record.householdName)},</p>
    <p>Thanks for your RSVP! Here's what we've got on file:</p>
    <ul>${memberLines(record)}</ul>
    ${record.response.notes ? `<p><em>Your message:</em> ${escapeHtml(record.response.notes)}</p>` : ""}
    <p>You can reopen your invite link anytime to update your response.</p>
  `;
}

export function renderAdminNotifyEmail(record) {
  return `
    <p><strong>${escapeHtml(record.householdName)}</strong> just RSVP'd.</p>
    <ul>${memberLines(record)}</ul>
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
