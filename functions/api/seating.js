import { rowToTable, rowToFloorObject, getSeatingRevealSetting, isSeatingRevealed } from "../_lib/db.js";

// Guest-facing: returns the full floor plan (every table + every landmark)
// so a guest can see the whole room, but WHO's sitting where stays scoped —
// mySeats only ever contains this invite code's own household. Tables carry
// no guest-identifying info themselves (position/shape/label/capacity are
// host-authored, not personal data), so showing all of them is safe; the
// canvas also only ever highlights/labels the requester's own seat(s), never
// anyone else's, so nothing here leaks another household's assignment.
//
// Also gated behind the admin-configured seating-reveal setting (locked /
// scheduled / open) — enforced HERE, not just hidden in the guest UI, so a
// guest can't just inspect network requests to see their seat early.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });

  const household = await env.DB.prepare("SELECT members FROM households WHERE invite_code = ?").bind(code).first();
  if (!household) return new Response("Not found", { status: 404 });

  const reveal = await getSeatingRevealSetting(env.DB);
  if (!isSeatingRevealed(reveal)) {
    return Response.json({ tables: [], mySeats: [], objects: [], locked: true, revealAt: reveal.mode === "scheduled" ? reveal.revealAt : null });
  }

  const { results: assignmentRows } = await env.DB.prepare(
    "SELECT member_id, table_id, seat_index FROM seat_assignments WHERE invite_code = ?"
  ).bind(code).all();

  if (assignmentRows.length === 0) return Response.json({ tables: [], mySeats: [], objects: [] });

  const memberNameById = Object.fromEntries(JSON.parse(household.members).map(m => [m.id, m.name]));
  const { results: tableRows } = await env.DB.prepare("SELECT * FROM seating_tables").all();
  const { results: objectRows } = await env.DB.prepare("SELECT * FROM floor_objects").all();

  const mySeats = assignmentRows
    .filter(r => memberNameById[r.member_id])
    .map(r => ({ memberId: r.member_id, memberName: memberNameById[r.member_id], tableId: r.table_id, seatIndex: r.seat_index }));

  return Response.json({ tables: tableRows.map(rowToTable), mySeats, objects: objectRows.map(rowToFloorObject) });
}
