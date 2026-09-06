export function rowToRecord(row) {
  return {
    inviteCode: row.invite_code,
    householdName: row.household_name,
    members: JSON.parse(row.members),
    invitedEvents: JSON.parse(row.invited_events),
    allowPlusOne: !!row.allow_plus_one,
    personalNote: row.personal_note || "",
    createdAt: row.created_at,
    response: row.response ? JSON.parse(row.response) : null
  };
}

export function genId() {
  return Math.random().toString(36).slice(2, 9);
}

export async function genInviteCode(db) {
  for (let i = 0; i < 20; i++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const existing = await db.prepare("SELECT 1 FROM households WHERE invite_code = ?").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique invite code");
}

export async function listAllRecords(db) {
  const { results } = await db.prepare("SELECT * FROM households ORDER BY created_at DESC").all();
  const out = {};
  for (const row of results) out[row.invite_code] = rowToRecord(row);
  return out;
}

export function rowToTable(row) {
  return {
    id: row.id,
    label: row.label,
    shape: row.shape,
    x: row.x,
    y: row.y,
    size: row.size,
    rotation: row.rotation,
    capacity: row.capacity
  };
}

export function rowToFloorObject(row) {
  return {
    id: row.id,
    type: row.type,
    label: row.label || "",
    x: row.x,
    y: row.y,
    size: row.size,
    x2: row.x2,
    y2: row.y2
  };
}

export async function listSeating(db) {
  const { results: tableRows } = await db.prepare("SELECT * FROM seating_tables ORDER BY created_at ASC").all();
  const { results: assignmentRows } = await db.prepare("SELECT member_id, table_id, seat_index FROM seat_assignments").all();
  const { results: objectRows } = await db.prepare("SELECT * FROM floor_objects ORDER BY created_at ASC").all();
  const assignments = {};
  for (const r of assignmentRows) assignments[r.member_id] = { tableId: r.table_id, seatIndex: r.seat_index };
  return { tables: tableRows.map(rowToTable), assignments, objects: objectRows.map(rowToFloorObject) };
}
