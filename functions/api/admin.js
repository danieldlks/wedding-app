import { rowToRecord, genId, genInviteCode, listAllRecords } from "../_lib/db.js";
import { sendEmail } from "../_lib/email.js";
import { renderBroadcastEmail } from "../_lib/templates.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { password, action, payload } = body;
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return new Response("Unauthorized", { status: 401 });
  }

  switch (action) {
    case "list":
      return Response.json(await listAllRecords(env.DB));

    case "save-household": {
      const p = payload || {};
      if (!Array.isArray(p.members) || p.members.length === 0) return new Response("Missing members", { status: 400 });
      if (!Array.isArray(p.invitedEvents) || p.invitedEvents.length === 0) return new Response("Missing invitedEvents", { status: 400 });
      return Response.json(await saveHousehold(env.DB, p));
    }

    case "delete-household": {
      const code = String(payload?.inviteCode || "").trim().toUpperCase();
      if (!code) return new Response("Missing inviteCode", { status: 400 });
      await env.DB.prepare("DELETE FROM households WHERE invite_code = ?").bind(code).run();
      return Response.json(await listAllRecords(env.DB));
    }

    case "broadcast": {
      const subject = String(payload?.subject || "").trim();
      const message = String(payload?.message || "").trim();
      if (!subject || !message) return new Response("Missing subject/message", { status: 400 });
      return Response.json(await broadcast(env, subject, message));
    }

    default:
      return new Response("Unknown action", { status: 400 });
  }
}

async function saveHousehold(db, p) {
  let code = String(p.inviteCode || "").trim().toUpperCase();
  let createdAt = new Date().toISOString();
  let existingResponse = null;

  if (code) {
    const existing = await db.prepare("SELECT created_at, response FROM households WHERE invite_code = ?").bind(code).first();
    if (existing) { createdAt = existing.created_at; existingResponse = existing.response; }
  } else {
    code = await genInviteCode(db);
  }

  const members = p.members.map(m => ({ id: m.id || genId(), name: String(m.name || "").trim() }));
  const householdName = String(p.householdName || "").trim() || members.map(m => m.name).join(" & ");

  await db.prepare(`
    INSERT INTO households (invite_code, household_name, members, invited_events, allow_plus_one, personal_note, created_at, response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(invite_code) DO UPDATE SET
      household_name = excluded.household_name,
      members = excluded.members,
      invited_events = excluded.invited_events,
      allow_plus_one = excluded.allow_plus_one,
      personal_note = excluded.personal_note
  `).bind(
    code,
    householdName,
    JSON.stringify(members),
    JSON.stringify(p.invitedEvents),
    p.allowPlusOne ? 1 : 0,
    p.personalNote || "",
    createdAt,
    existingResponse
  ).run();

  return listAllRecords(db);
}

async function broadcast(env, subject, message) {
  const { results } = await env.DB.prepare("SELECT * FROM households WHERE response IS NOT NULL").all();
  let sent = 0, failed = 0;
  for (const row of results) {
    const record = rowToRecord(row);
    const to = record.response?.contactEmail;
    if (!to) { failed++; continue; }
    try {
      await sendEmail(env, { to, subject, html: renderBroadcastEmail(record, message) });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}
