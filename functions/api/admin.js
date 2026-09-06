import { rowToRecord, genId, genInviteCode, listAllRecords, listSeating } from "../_lib/db.js";
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
      await env.DB.prepare("DELETE FROM seat_assignments WHERE invite_code = ?").bind(code).run();
      await env.DB.prepare("DELETE FROM households WHERE invite_code = ?").bind(code).run();
      return Response.json(await listAllRecords(env.DB));
    }

    case "list-seating":
      return Response.json(await listSeating(env.DB));

    case "save-table":
      return Response.json(await saveTable(env.DB, payload || {}));

    case "delete-table": {
      const id = String(payload?.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400 });
      await env.DB.prepare("DELETE FROM seat_assignments WHERE table_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM seating_tables WHERE id = ?").bind(id).run();
      return Response.json(await listSeating(env.DB));
    }

    case "assign-seat": {
      const memberId = String(payload?.memberId || "").trim();
      const inviteCode = String(payload?.inviteCode || "").trim().toUpperCase();
      const tableId = payload?.tableId ? String(payload.tableId).trim() : null;
      if (!memberId || !inviteCode) return new Response("Missing memberId/inviteCode", { status: 400 });
      if (tableId) {
        const seatIndex = Number(payload?.seatIndex);
        if (!Number.isInteger(seatIndex) || seatIndex < 0) return new Response("Missing seatIndex", { status: 400 });
        // The UI only offers empty seats as drop/tap targets, but guard against a
        // stale-poll race (two admins targeting the same seat within the same
        // ~5s refresh window) rather than silently overwriting one of them.
        const clash = await env.DB.prepare(
          "SELECT member_id FROM seat_assignments WHERE table_id = ? AND seat_index = ? AND member_id != ?"
        ).bind(tableId, seatIndex, memberId).first();
        if (clash) return new Response("That seat is already taken", { status: 409 });
        await env.DB.prepare(`
          INSERT INTO seat_assignments (member_id, invite_code, table_id, seat_index, assigned_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(member_id) DO UPDATE SET
            table_id = excluded.table_id, invite_code = excluded.invite_code,
            seat_index = excluded.seat_index, assigned_at = excluded.assigned_at
        `).bind(memberId, inviteCode, tableId, seatIndex, new Date().toISOString()).run();
      } else {
        await env.DB.prepare("DELETE FROM seat_assignments WHERE member_id = ?").bind(memberId).run();
      }
      return Response.json(await listSeating(env.DB));
    }

    case "save-object":
      return Response.json(await saveFloorObject(env.DB, payload || {}));

    case "delete-object": {
      const id = String(payload?.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400 });
      await env.DB.prepare("DELETE FROM floor_objects WHERE id = ?").bind(id).run();
      return Response.json(await listSeating(env.DB));
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

async function saveTable(db, p) {
  const id = String(p.id || "").trim() || genId();
  const label = String(p.label || "").trim() || "Table";
  const shape = p.shape === "rect" ? "rect" : "round";
  const x = Number.isFinite(Number(p.x)) ? Number(p.x) : 100;
  const y = Number.isFinite(Number(p.y)) ? Number(p.y) : 100;
  const size = Math.max(30, Number(p.size) || 90);
  const rotation = Number(p.rotation) || 0;
  const capacity = Math.max(1, Number(p.capacity) || 8);

  const existing = await db.prepare("SELECT created_at FROM seating_tables WHERE id = ?").bind(id).first();
  const createdAt = existing?.created_at || new Date().toISOString();

  await db.prepare(`
    INSERT INTO seating_tables (id, label, shape, x, y, size, rotation, capacity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label, shape = excluded.shape, x = excluded.x, y = excluded.y,
      size = excluded.size, rotation = excluded.rotation, capacity = excluded.capacity
  `).bind(id, label, shape, x, y, size, rotation, capacity, createdAt).run();

  return listSeating(db);
}

async function saveFloorObject(db, p) {
  const id = String(p.id || "").trim() || genId();
  const type = ["circle", "rect", "triangle", "line"].includes(p.type) ? p.type : "rect";
  const label = String(p.label || "").trim();
  const x = Number.isFinite(Number(p.x)) ? Number(p.x) : 100;
  const y = Number.isFinite(Number(p.y)) ? Number(p.y) : 100;
  const size = Math.max(10, Number(p.size) || 60);
  const x2 = p.x2 != null && Number.isFinite(Number(p.x2)) ? Number(p.x2) : null;
  const y2 = p.y2 != null && Number.isFinite(Number(p.y2)) ? Number(p.y2) : null;

  const existing = await db.prepare("SELECT created_at FROM floor_objects WHERE id = ?").bind(id).first();
  const createdAt = existing?.created_at || new Date().toISOString();

  await db.prepare(`
    INSERT INTO floor_objects (id, type, label, x, y, size, x2, y2, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, label = excluded.label, x = excluded.x, y = excluded.y,
      size = excluded.size, x2 = excluded.x2, y2 = excluded.y2
  `).bind(id, type, label, x, y, size, x2, y2, createdAt).run();

  return listSeating(db);
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
