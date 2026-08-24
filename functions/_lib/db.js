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
