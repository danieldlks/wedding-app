import { rowToTable, rowToFloorObject } from "../_lib/db.js";

// Guest-facing: given an invite code, return only the table(s) that
// household's own members are seated at (not the whole floor plan) — a
// guest shouldn't be able to see where every other household is sitting.
// Floor objects (bar, doors, walls, etc.) carry no guest info, so they're
// returned in full — they're what makes the mini floor plan read as an
// actual room instead of a table floating in space.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });

  const household = await env.DB.prepare("SELECT members FROM households WHERE invite_code = ?").bind(code).first();
  if (!household) return new Response("Not found", { status: 404 });

  const { results: assignmentRows } = await env.DB.prepare(
    "SELECT member_id, table_id, seat_index FROM seat_assignments WHERE invite_code = ?"
  ).bind(code).all();

  if (assignmentRows.length === 0) return Response.json({ tables: [], mySeats: [], objects: [] });

  const memberNameById = Object.fromEntries(JSON.parse(household.members).map(m => [m.id, m.name]));
  const tableIds = [...new Set(assignmentRows.map(r => r.table_id))];
  const placeholders = tableIds.map(() => "?").join(",");
  const { results: tableRows } = await env.DB.prepare(
    `SELECT * FROM seating_tables WHERE id IN (${placeholders})`
  ).bind(...tableIds).all();
  const { results: objectRows } = await env.DB.prepare("SELECT * FROM floor_objects").all();

  const mySeats = assignmentRows
    .filter(r => memberNameById[r.member_id])
    .map(r => ({ memberId: r.member_id, memberName: memberNameById[r.member_id], tableId: r.table_id, seatIndex: r.seat_index }));

  return Response.json({ tables: tableRows.map(rowToTable), mySeats, objects: objectRows.map(rowToFloorObject) });
}
