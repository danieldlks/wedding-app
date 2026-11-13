import { rowToRecord, genId, genInviteCode, listAllRecords, listSeating, getSiteSettings, putSetting, isValidDate, resolveEvents, isHexColor, getLevels, cleanLevels, isLevelId } from "../_lib/db.js";
import { isValidTimeZone } from "../_lib/time.js";
import { sendEmail, getEmailQuota } from "../_lib/email.js";
import { renderUpdateEmail, renderReminderEmail, recipientFor } from "../_lib/templates.js";
import { ADMIN_HOSTS, EVENTS } from "../_lib/config.js";
import { adminRegistry, saveRegistrySettings, saveItem, deleteItem, adminRemoveReservation, RegistryError } from "../_lib/registry.js";
import { fetchProductInfo } from "../_lib/productLink.js";

export async function onRequestPost({ request, env }) {
  // Checked before the password so guesses sent via a *.pages.dev address
  // (outside the custom domain's rate-limiting rule) are never evaluated.
  if (!ADMIN_HOSTS.includes(new URL(request.url).hostname)) {
    return new Response("Admin access is only available at daniel-and-faith.com", { status: 403 });
  }

  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { password, action, payload } = body;
  if (!(await passwordMatches(password, env.ADMIN_PASSWORD))) {
    return new Response("Unauthorized", { status: 401 });
  }

  switch (action) {
    case "list":
      return Response.json(await listAllRecords(env.DB));

    case "save-household": {
      const p = payload || {};
      if (!Array.isArray(p.members) || p.members.length === 0) return new Response("Missing members", { status: 400 });
      if (!Array.isArray(p.invitedEvents) || p.invitedEvents.length === 0) return new Response("Missing invitedEvents", { status: 400 });
      const email = String(p.contactEmail || "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response("Invalid contact email", { status: 400 });
      if (String(p.contactPhone || "").trim().length > 40) return new Response("Contact phone too long", { status: 400 });
      return Response.json(await saveHousehold(env.DB, p));
    }

    case "delete-household": {
      const code = String(payload?.inviteCode || "").trim().toUpperCase();
      if (!code) return new Response("Missing inviteCode", { status: 400 });
      await env.DB.prepare("DELETE FROM seat_assignments WHERE invite_code = ?").bind(code).run();
      await env.DB.prepare("DELETE FROM registry_reservations WHERE invite_code = ?").bind(code).run();
      await env.DB.prepare("DELETE FROM households WHERE invite_code = ?").bind(code).run();
      return Response.json(await listAllRecords(env.DB));
    }

    case "list-seating":
      return Response.json(await listSeating(env.DB));

    case "save-seating-reveal": {
      const mode = ["locked", "scheduled", "open"].includes(payload?.mode) ? payload.mode : "locked";
      const revealAt = mode === "scheduled" && payload?.revealAt ? String(payload.revealAt) : null;
      await env.DB.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('seating_reveal_mode', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(mode).run();
      await env.DB.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('seating_reveal_at', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(revealAt).run();
      return Response.json(await listSeating(env.DB));
    }

    case "get-settings":
      return Response.json(await getSiteSettings(env.DB));

    case "save-settings": {
      // Only known event ids are accepted, so arbitrary keys can't be written.
      // An empty value clears that setting. Everything is validated before
      // anything is written, so a bad value never leaves a half-applied save.
      const deadlines = payload?.deadlines || {};
      const capacities = payload?.capacities || {};
      const writes = [];
      for (const ev of EVENTS) {
        if (ev.id in deadlines) {
          const v = String(deadlines[ev.id] || "").trim();
          if (v && !isValidDate(v)) return new Response(`Invalid deadline for ${ev.id}`, { status: 400 });
          writes.push([`rsvp_deadline_${ev.id}`, v]);
        }
        if (ev.id in capacities) {
          const raw = capacities[ev.id];
          const n = raw === "" || raw == null ? "" : Number(raw);
          if (n !== "" && !(Number.isInteger(n) && n >= 0 && n <= 100000)) return new Response(`Invalid capacity for ${ev.id}`, { status: 400 });
          writes.push([`event_capacity_${ev.id}`, n]);
        }
      }
      // Event details: only name/date/time/time zone/venue/address are editable;
      // ids (and so which households are invited) stay fixed in code.
      const eventEdits = payload?.events || {};
      for (const ev of EVENTS) {
        if (!(ev.id in eventEdits)) continue;
        const e = eventEdits[ev.id] || {};
        const clean = {
          name: String(e.name || "").trim(),
          date: String(e.date || "").trim(),
          time: String(e.time || "").trim(),
          timeZone: String(e.timeZone || "").trim(),
          venue: String(e.venue || "").trim(),
          address: String(e.address || "").trim(),
          dressCode: String(e.dressCode || "").trim(),
          dressNote: String(e.dressNote || "").trim(),
        };
        if (!clean.dressCode) clean.dressNote = "";
        if (!clean.name || clean.name.length > 100) return new Response(`Event name for ${ev.id} is required (max 100 characters)`, { status: 400 });
        if (!isValidDate(clean.date)) return new Response(`Invalid date for ${ev.id}`, { status: 400 });
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.time)) return new Response(`Invalid start time for ${ev.id}`, { status: 400 });
        if (!isValidTimeZone(clean.timeZone)) return new Response(`Invalid time zone for ${ev.id}`, { status: 400 });
        if (!clean.venue || clean.venue.length > 150) return new Response(`Venue for ${ev.id} is required (max 150 characters)`, { status: 400 });
        if (clean.address.length > 300) return new Response(`Address for ${ev.id} is too long (max 300 characters)`, { status: 400 });
        if (clean.dressCode.length > 80) return new Response(`Dress code for ${ev.id} is too long (max 80 characters)`, { status: 400 });
        if (clean.dressNote.length > 300) return new Response(`Dress code note for ${ev.id} is too long (max 300 characters)`, { status: 400 });
        writes.push([`event_details_${ev.id}`, JSON.stringify(clean)]);
      }
      // Guest information (Details page items). An empty list is allowed and
      // means "show none"; null/"reset" clears the override back to the code defaults.
      if ("guestInfo" in (payload || {})) {
        const items = payload.guestInfo;
        if (items === null) writes.push(["guest_info_items", ""]);
        else {
          if (!Array.isArray(items) || items.length > 20) return new Response("Guest information must be a list of at most 20 items", { status: 400 });
          const clean = items.map(i => ({ title: String(i?.title || "").trim(), body: String(i?.body || "").trim() }));
          if (clean.some(i => !i.title || i.title.length > 80 || i.body.length > 1000)) return new Response("Each item needs a title (max 80 characters) and text up to 1000 characters", { status: 400 });
          writes.push(["guest_info_items", JSON.stringify(clean)]);
        }
      }
      if (payload?.announcement) {
        const message = String(payload.announcement.message || "").trim();
        const until = String(payload.announcement.until || "").trim();
        if (message.length > 2000) return new Response("Announcement too long (max 2000 characters)", { status: 400 });
        if (until && !isValidDate(until)) return new Response("Invalid announcement end date", { status: 400 });
        writes.push(["announcement_message", message], ["announcement_until", message ? until : ""]);
      }
      if (payload?.notifications && "rsvpAlerts" in payload.notifications) {
        writes.push(["admin_rsvp_alerts", payload.notifications.rsvpAlerts ? "" : "off"]);
      }
      for (const [key, value] of writes) await putSetting(env.DB, key, value);
      return Response.json(await getSiteSettings(env.DB));
    }

    // Gift registry (see functions/_lib/registry.js). Each change returns the
    // whole registry, like the seating actions do.
    case "registry-list":
      return Response.json(await adminRegistry(env.DB));

    case "registry-save-settings":
    case "registry-save-item":
    case "registry-delete-item":
    case "registry-remove-reservation": {
      const p = payload || {};
      try {
        if (action === "registry-save-settings") await saveRegistrySettings(env.DB, p);
        else if (action === "registry-save-item") await saveItem(env.DB, p);
        else if (action === "registry-delete-item") await deleteItem(env.DB, String(p.id || ""));
        else await adminRemoveReservation(env.DB, String(p.id || ""));
      } catch (e) {
        if (e instanceof RegistryError) return new Response(e.message, { status: e.status });
        throw e;
      }
      return Response.json(await adminRegistry(env.DB));
    }

    case "registry-fetch-link":
      return Response.json(await fetchProductInfo(payload?.url));

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

    case "save-room": {
      // The room's size in plan units (50 = 1 m), 6 m to 100 m. Optional shiftX/shiftY move every
      // table and item right/down (to add space on the left/top) in the same save.
      const w = Math.round(Number(payload?.w)), h = Math.round(Number(payload?.h));
      if (!(w >= 300 && w <= 5000 && h >= 300 && h <= 5000)) return new Response("Room must be between 6 m and 100 m each way", { status: 400 });
      const sx = Math.round(Number(payload?.shiftX) || 0), sy = Math.round(Number(payload?.shiftY) || 0);
      if (Math.abs(sx) > 5000 || Math.abs(sy) > 5000) return new Response("Invalid shift", { status: 400 });
      if (sx || sy) {
        await env.DB.prepare("UPDATE seating_tables SET x = x + ?, y = y + ?").bind(sx, sy).run();
        await env.DB.prepare("UPDATE floor_objects SET x = x + ?, y = y + ?, x2 = x2 + ?, y2 = y2 + ?").bind(sx, sy, sx, sy).run();
        const levels = await getLevels(env.DB);
        if (levels.length) await putSetting(env.DB, "levels", JSON.stringify(levels.map(l => ({ ...l, x: l.x + sx, y: l.y + sy }))));
      }
      await putSetting(env.DB, "room_width", w);
      await putSetting(env.DB, "room_depth", h);
      return Response.json(await listSeating(env.DB));
    }

    case "style-all-tables": {
      // One tablecloth colour for every table (null = plain linen).
      const c = payload?.color;
      if (c != null && c !== "" && !isHexColor(c)) return new Response("Invalid colour", { status: 400 });
      await env.DB.prepare("UPDATE seating_tables SET color = ?").bind(c || null).run();
      return Response.json(await listSeating(env.DB));
    }

    case "save-chair-color": {
      // The venue's chair colour (each table can override it with its own chairColor).
      const c = payload?.color;
      if (c != null && c !== "" && !isHexColor(c)) return new Response("Invalid colour", { status: 400 });
      await putSetting(env.DB, "chair_color", c || "");
      return Response.json(await listSeating(env.DB));
    }

    // Several tables/items at once (a group move or nudge, or pasted copies), optionally with a
    // room resize that shifts everything first (as save-room does). Positions sent are final ones
    // (after any shift). One D1 batch, so it all saves or none of it does.
    case "save-items": {
      const p = payload || {};
      const tables = Array.isArray(p.tables) ? p.tables : [], objects = Array.isArray(p.objects) ? p.objects : [];
      // `levels` (optional): the whole list of lofts, e.g. after one is added, moved or resized.
      let levels = null;
      if (p.levels !== undefined) {
        levels = cleanLevels(p.levels);
        if (!levels) return new Response("Invalid lofts", { status: 400 });
      }
      if (tables.length + objects.length === 0 && !levels) return new Response("Nothing to save", { status: 400 });
      if (tables.length > 300 || objects.length > 300) return new Response("Too many items", { status: 400 });
      const stmts = [];
      if (p.room) {
        const w = Math.round(Number(p.room.w)), h = Math.round(Number(p.room.h));
        if (!(w >= 300 && w <= 5000 && h >= 300 && h <= 5000)) return new Response("Room must be between 6 m and 100 m each way", { status: 400 });
        const sx = Math.round(Number(p.room.shiftX) || 0), sy = Math.round(Number(p.room.shiftY) || 0);
        if (Math.abs(sx) > 5000 || Math.abs(sy) > 5000) return new Response("Invalid shift", { status: 400 });
        if (sx || sy) {
          stmts.push(env.DB.prepare("UPDATE seating_tables SET x = x + ?, y = y + ?").bind(sx, sy));
          stmts.push(env.DB.prepare("UPDATE floor_objects SET x = x + ?, y = y + ?, x2 = x2 + ?, y2 = y2 + ?").bind(sx, sy, sx, sy));
        }
        stmts.push(putStatement(env.DB, "room_width", w), putStatement(env.DB, "room_depth", h));
        // The lofts move with everything else (unless this save sends a new list, already shifted).
        if ((sx || sy) && !levels) {
          const cur = await getLevels(env.DB);
          if (cur.length) stmts.push(putStatement(env.DB, "levels", JSON.stringify(cur.map(l => ({ ...l, x: l.x + sx, y: l.y + sy })))));
        }
      }
      if (levels) stmts.push(putStatement(env.DB, "levels", JSON.stringify(levels)));
      for (const t of tables) stmts.push(tableStatement(env.DB, t || {}));
      for (const o of objects) stmts.push(objectStatement(env.DB, o || {}));
      await env.DB.batch(stmts);
      return Response.json(await listSeating(env.DB));
    }

    // Removes a loft and everything on it (guests at its tables become unseated).
    case "delete-level": {
      const id = String(payload?.id || "");
      const levels = await getLevels(env.DB);
      if (!levels.some(l => l.id === id)) return new Response("No such loft", { status: 404 });
      await env.DB.batch([
        env.DB.prepare("DELETE FROM seat_assignments WHERE table_id IN (SELECT id FROM seating_tables WHERE level = ?)").bind(id),
        env.DB.prepare("DELETE FROM seating_tables WHERE level = ?").bind(id),
        env.DB.prepare("DELETE FROM floor_objects WHERE level = ?").bind(id),
        putStatement(env.DB, "levels", JSON.stringify(levels.filter(l => l.id !== id)))
      ]);
      return Response.json(await listSeating(env.DB));
    }

    // Deletes several tables/items at once; guests seated at a deleted table become unseated.
    case "delete-items": {
      const ids = v => (Array.isArray(v) ? v.map(x => String(x || "").trim()).filter(Boolean) : []);
      const tableIds = ids(payload?.tableIds), objectIds = ids(payload?.objectIds);
      if (tableIds.length + objectIds.length === 0) return new Response("Nothing to delete", { status: 400 });
      if (tableIds.length > 300 || objectIds.length > 300) return new Response("Too many items", { status: 400 });
      const stmts = [];
      for (const id of tableIds) {
        stmts.push(env.DB.prepare("DELETE FROM seat_assignments WHERE table_id = ?").bind(id));
        stmts.push(env.DB.prepare("DELETE FROM seating_tables WHERE id = ?").bind(id));
      }
      for (const id of objectIds) stmts.push(env.DB.prepare("DELETE FROM floor_objects WHERE id = ?").bind(id));
      await env.DB.batch(stmts);
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

    case "email-status":
      // For Settings and the Email guests panel: where RSVP alerts go, and how
      // many emails the Gmail relay can still send today (null if the relay is
      // an older version without the quota check, or unreachable).
      return Response.json({ notifyEmail: env.ADMIN_NOTIFY_EMAIL || "", ...(await getEmailQuota(env)) });

    case "send-emails": {
      // One small batch per request. The admin page splits the recipient list
      // and calls this repeatedly (showing progress), because a Pages Function
      // on the free plan may only make ~50 outgoing requests per invocation
      // and each email is 1-2 fetches to the Apps Script relay.
      const codes = Array.isArray(payload?.codes) ? payload.codes.map(c => String(c).trim().toUpperCase()).filter(Boolean) : [];
      if (codes.length === 0 || codes.length > EMAIL_BATCH_SIZE) return new Response(`Send 1-${EMAIL_BATCH_SIZE} households per request`, { status: 400 });
      const subject = String(payload?.subject || "").trim();
      const message = String(payload?.message || "").trim();
      if (!subject || subject.length > 200) return new Response("Subject is required (max 200 characters)", { status: 400 });
      if (!message || message.length > 5000) return new Response("Message is required (max 5000 characters)", { status: 400 });
      return Response.json({ results: await sendEmailBatch(env, codes, record => ({ subject, html: renderUpdateEmail(record, subject, message) })) });
    }

    case "send-reminders": {
      // Same batching as send-emails; the message is an optional personal note.
      // Households that have replied in the meantime are skipped, never nagged.
      const codes = Array.isArray(payload?.codes) ? payload.codes.map(c => String(c).trim().toUpperCase()).filter(Boolean) : [];
      if (codes.length === 0 || codes.length > EMAIL_BATCH_SIZE) return new Response(`Send 1-${EMAIL_BATCH_SIZE} households per request`, { status: 400 });
      const subject = String(payload?.subject || "").trim();
      const note = String(payload?.message || "").trim();
      if (!subject || subject.length > 200) return new Response("Subject is required (max 200 characters)", { status: 400 });
      if (note.length > 2000) return new Response("Note too long (max 2000 characters)", { status: 400 });
      const settings = await getSiteSettings(env.DB);
      const events = resolveEvents(settings);
      return Response.json({ results: await sendEmailBatch(env, codes, record => ({ subject, html: renderReminderEmail(record, settings.deadlines, note, events) }), { skipReplied: true }) });
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
    INSERT INTO households (invite_code, household_name, members, invited_events, allow_plus_one, personal_note, contact_email, contact_phone, created_at, response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(invite_code) DO UPDATE SET
      household_name = excluded.household_name,
      members = excluded.members,
      invited_events = excluded.invited_events,
      allow_plus_one = excluded.allow_plus_one,
      personal_note = excluded.personal_note,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone
  `).bind(
    code,
    householdName,
    JSON.stringify(members),
    JSON.stringify(p.invitedEvents),
    p.allowPlusOne ? 1 : 0,
    p.personalNote || "",
    String(p.contactEmail || "").trim(),
    String(p.contactPhone || "").trim(),
    createdAt,
    existingResponse
  ).run();

  return listAllRecords(db);
}

async function saveTable(db, p) {
  await tableStatement(db, p).run();
  return listSeating(db);
}

// The upsert for one table, cleaned up. Used on its own (save-table) and in batches (save-items).
// A new row's created_at is now; an existing row keeps its own (ON CONFLICT doesn't touch it).
function tableStatement(db, p) {
  const id = String(p.id || "").trim() || genId();
  const label = String(p.label || "").trim() || "Table";
  const shape = ["rect", "oval", "banquet"].includes(p.shape) ? p.shape : "round";
  const x = Number.isFinite(Number(p.x)) ? Number(p.x) : 100;
  const y = Number.isFinite(Number(p.y)) ? Number(p.y) : 100;
  const size = Math.max(30, Number(p.size) || 90);
  const size2 = p.size2 != null && Number.isFinite(Number(p.size2)) ? Math.max(30, Number(p.size2)) : null;
  const rotation = Number(p.rotation) || 0;
  const capacity = Math.max(1, Number(p.capacity) || 8);
  const color = isHexColor(p.color) ? p.color : null;
  const chairColor = isHexColor(p.chairColor) ? p.chairColor : null;
  const level = isLevelId(p.level) ? p.level : null;
  const createdAt = new Date().toISOString();

  return db.prepare(`
    INSERT INTO seating_tables (id, label, shape, x, y, size, size2, rotation, capacity, created_at, color, chair_color, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label, shape = excluded.shape, x = excluded.x, y = excluded.y,
      size = excluded.size, size2 = excluded.size2, rotation = excluded.rotation, capacity = excluded.capacity,
      color = excluded.color, chair_color = excluded.chair_color, level = excluded.level
  `).bind(id, label, shape, x, y, size, size2, rotation, capacity, createdAt, color, chairColor, level);
}

// An app_settings upsert, for use inside a D1 batch.
function putStatement(db, key, value) {
  return db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));
}

// Basic shapes, walls, and the room features with their own 2D drawing / 3D model.
// Line-like types (wall, curtain, window) use x/y -> x2/y2; the rest x/y/size.
const FLOOR_OBJECT_TYPES = ["circle", "rect", "triangle", "line", "fireplace", "stairs", "curtain", "window", "pillar", "post"];

async function saveFloorObject(db, p) {
  await objectStatement(db, p).run();
  return listSeating(db);
}

// The upsert for one floor item, cleaned up (see tableStatement).
function objectStatement(db, p) {
  const id = String(p.id || "").trim() || genId();
  const type = FLOOR_OBJECT_TYPES.includes(p.type) ? p.type : "rect";
  const label = String(p.label || "").trim();
  const x = Number.isFinite(Number(p.x)) ? Number(p.x) : 100;
  const y = Number.isFinite(Number(p.y)) ? Number(p.y) : 100;
  const size = Math.min(5000, Math.max(10, Number(p.size) || 60));
  const x2 = p.x2 != null && Number.isFinite(Number(p.x2)) ? Number(p.x2) : null;
  const y2 = p.y2 != null && Number.isFinite(Number(p.y2)) ? Number(p.y2) : null;
  const rotation = p.rotation != null && Number.isFinite(Number(p.rotation)) ? ((Number(p.rotation) % 360) + 360) % 360 : null;
  const color = isHexColor(p.color) ? p.color : null;
  // Rectangles can be deeper or shallower than they are wide (0.5 m to 100 m); other shapes have no depth.
  const depth = type === "rect" && p.depth != null && Number.isFinite(Number(p.depth)) ? Math.min(5000, Math.max(10, Number(p.depth))) : null;
  const level = isLevelId(p.level) ? p.level : null;
  const createdAt = new Date().toISOString();

  return db.prepare(`
    INSERT INTO floor_objects (id, type, label, x, y, size, x2, y2, created_at, rotation, color, depth, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, label = excluded.label, x = excluded.x, y = excluded.y,
      size = excluded.size, x2 = excluded.x2, y2 = excluded.y2, rotation = excluded.rotation, color = excluded.color,
      depth = excluded.depth, level = excluded.level
  `).bind(id, type, label, x, y, size, x2, y2, createdAt, rotation, color, depth, level);
}

const EMAIL_BATCH_SIZE = 10;

// Sends one email per household (sequentially, to stay well inside the
// relay's and Gmail's rate limits) and reports each household's outcome, so
// the admin page can show exactly who didn't get it.
async function sendEmailBatch(env, codes, render, { skipReplied = false } = {}) {
  const placeholders = codes.map(() => "?").join(",");
  const { results: rows } = await env.DB.prepare(`SELECT * FROM households WHERE invite_code IN (${placeholders})`).bind(...codes).all();
  const byCode = Object.fromEntries(rows.map(r => [r.invite_code, rowToRecord(r)]));
  const out = [];
  for (const code of codes) {
    const record = byCode[code];
    if (!record) { out.push({ code, status: "skipped", reason: "not found" }); continue; }
    if (skipReplied && record.response) { out.push({ code, status: "skipped", reason: "already replied" }); continue; }
    const to = recipientFor(record);
    if (!to) { out.push({ code, status: "skipped", reason: "no email" }); continue; }
    try {
      const { subject, html } = render(record);
      await sendEmail(env, { to, subject, html });
      out.push({ code, status: "sent" });
    } catch (e) {
      out.push({ code, status: "failed", reason: String(e.message || e).slice(0, 200) });
    }
  }
  return out;
}

// Constant-time password check. A plain `!==` can return sooner the earlier
// the first mismatched character is, which in theory leaks how much of a
// guess is right. Hashing both sides first gives timingSafeEqual (a Workers
// extension to Web Crypto) two equal-length inputs, so the compare takes the
// same time regardless of the guess's content or length.
async function passwordMatches(given, expected) {
  if (typeof given !== "string" || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, expected].map(s => crypto.subtle.digest("SHA-256", enc.encode(s)))
  );
  return crypto.subtle.timingSafeEqual(a, b);
}
