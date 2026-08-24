import { rowToRecord } from "../_lib/db.js";
import { sendEmail } from "../_lib/email.js";
import { renderGuestConfirmationEmail, renderAdminNotifyEmail } from "../_lib/templates.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const inviteCode = String(body.inviteCode || "").trim().toUpperCase();
  const contactEmail = String(body.contactEmail || "").trim();
  if (!inviteCode) return new Response("Missing inviteCode", { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return new Response("Invalid email", { status: 400 });
  if (!Array.isArray(body.members) || body.members.length === 0) return new Response("Missing members", { status: 400 });

  const row = await env.DB.prepare("SELECT * FROM households WHERE invite_code = ?").bind(inviteCode).first();
  if (!row) return new Response("Household not found", { status: 404 });

  const response = {
    members: body.members,
    contactEmail,
    contactPhone: body.contactPhone || "",
    notes: body.notes || "",
    submittedAt: new Date().toISOString()
  };

  await env.DB.prepare("UPDATE households SET response = ? WHERE invite_code = ?")
    .bind(JSON.stringify(response), inviteCode)
    .run();

  const record = rowToRecord({ ...row, response: JSON.stringify(response) });

  // Best-effort notifications — an email hiccup shouldn't block the guest's RSVP from saving.
  await Promise.allSettled([
    sendEmail(env, { to: contactEmail, subject: `RSVP confirmed — ${record.householdName}`, html: renderGuestConfirmationEmail(record) }),
    env.ADMIN_NOTIFY_EMAIL
      ? sendEmail(env, { to: env.ADMIN_NOTIFY_EMAIL, subject: `New RSVP from ${record.householdName}`, html: renderAdminNotifyEmail(record) })
      : Promise.resolve()
  ]);

  return Response.json(record);
}
