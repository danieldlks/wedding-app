import { genId, putSetting } from "./db.js";
import { DEFAULT_REGISTRY_SETTINGS, REGISTRY_EVENTS, REGISTRY_AUDIENCES } from "../../src/registryRules.js";

// Gift registry storage. Settings live in app_settings:
//   registry_enabled  — 'on' shows the registry to guests (absent = off)
//   registry_event    — 'engagement' | 'wedding' | 'both' (absent = 'engagement')
//   registry_audience — 'replied' | 'attending' (absent = 'replied')
// Items and reservations have their own tables (see schema.sql). Who can see
// the registry is decided by registryAccess() in src/registryRules.js.

export async function getRegistrySettings(db) {
  const { results } = await db.prepare(
    "SELECT key, value FROM app_settings WHERE key IN ('registry_enabled', 'registry_event', 'registry_audience')"
  ).all();
  const m = Object.fromEntries(results.map(r => [r.key, r.value]));
  return {
    enabled: m.registry_enabled === "on",
    event: REGISTRY_EVENTS.includes(m.registry_event) ? m.registry_event : DEFAULT_REGISTRY_SETTINGS.event,
    audience: REGISTRY_AUDIENCES.includes(m.registry_audience) ? m.registry_audience : DEFAULT_REGISTRY_SETTINGS.audience
  };
}

export async function saveRegistrySettings(db, p) {
  if ("enabled" in p) await putSetting(db, "registry_enabled", p.enabled ? "on" : "");
  if ("event" in p) {
    if (!REGISTRY_EVENTS.includes(p.event)) throw new RegistryError("Invalid event");
    await putSetting(db, "registry_event", p.event);
  }
  if ("audience" in p) {
    if (!REGISTRY_AUDIENCES.includes(p.audience)) throw new RegistryError("Invalid audience");
    await putSetting(db, "registry_audience", p.audience);
  }
}

export class RegistryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    shop: row.shop || "",
    url: row.url || "",
    imageUrl: row.image_url || "",
    price: row.price_cents == null ? null : row.price_cents / 100,
    category: row.category || "",
    quantity: row.quantity,
    note: row.note || "",
    mostWanted: !!row.most_wanted,
    createdAt: row.created_at
  };
}

const ITEM_ORDER = "ORDER BY most_wanted DESC, created_at ASC";

// Guest view: every item with how many are still needed, plus this household's
// own reservations. Never says which other household reserved what.
export async function guestRegistry(db, inviteCode) {
  const { results: itemRows } = await db.prepare(`SELECT * FROM registry_items ${ITEM_ORDER}`).all();
  const { results: totals } = await db.prepare(
    "SELECT item_id, SUM(quantity) AS reserved, MIN(bought) AS all_bought FROM registry_reservations GROUP BY item_id"
  ).all();
  const { results: mineRows } = await db.prepare(
    "SELECT id, item_id, quantity, bought FROM registry_reservations WHERE invite_code = ? ORDER BY created_at ASC"
  ).bind(inviteCode).all();
  const byItem = Object.fromEntries(totals.map(t => [t.item_id, t]));
  return {
    items: itemRows.map(r => {
      const t = byItem[r.id];
      const reserved = t ? Number(t.reserved) : 0;
      return { ...rowToItem(r), reserved, remaining: Math.max(0, r.quantity - reserved), allBought: !!t && t.all_bought === 1 && reserved >= r.quantity };
    }),
    mine: mineRows.map(r => ({ id: r.id, itemId: r.item_id, quantity: r.quantity, bought: !!r.bought }))
  };
}

// Admin view: items with every reservation and the household that made it.
export async function adminRegistry(db) {
  const { results: itemRows } = await db.prepare(`SELECT * FROM registry_items ${ITEM_ORDER}`).all();
  const { results: resRows } = await db.prepare(`
    SELECT r.id, r.item_id, r.invite_code, r.quantity, r.bought, r.created_at, h.household_name
    FROM registry_reservations r LEFT JOIN households h ON h.invite_code = r.invite_code
    ORDER BY r.created_at ASC
  `).all();
  const byItem = {};
  for (const r of resRows) {
    (byItem[r.item_id] ||= []).push({
      id: r.id, inviteCode: r.invite_code, householdName: r.household_name || r.invite_code,
      quantity: r.quantity, bought: !!r.bought, createdAt: r.created_at
    });
  }
  return {
    settings: await getRegistrySettings(db),
    items: itemRows.map(r => {
      const reservations = byItem[r.id] || [];
      const reserved = reservations.reduce((s, x) => s + x.quantity, 0);
      return { ...rowToItem(r), reservations, reserved, remaining: Math.max(0, r.quantity - reserved) };
    })
  };
}

// One household can hold one reservation per item (for one or more of it).
// The insert only happens if enough are still needed, checked in the same
// statement, so two guests reserving the last one at once can't both get it.
export async function reserveItem(db, inviteCode, itemId, quantity) {
  const n = Number(quantity);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new RegistryError("Invalid quantity");
  const item = await db.prepare("SELECT id FROM registry_items WHERE id = ?").bind(itemId).first();
  if (!item) throw new RegistryError("That gift is no longer on the registry", 404);
  const existing = await db.prepare("SELECT id FROM registry_reservations WHERE item_id = ? AND invite_code = ?").bind(itemId, inviteCode).first();
  if (existing) throw new RegistryError("You've already reserved this gift", 409);
  const result = await db.prepare(`
    INSERT INTO registry_reservations (id, item_id, invite_code, quantity, bought, created_at)
    SELECT ?, ?, ?, ?, 0, ?
    WHERE (SELECT quantity FROM registry_items WHERE id = ?)
        - COALESCE((SELECT SUM(quantity) FROM registry_reservations WHERE item_id = ?), 0) >= ?
  `).bind(genId(), itemId, inviteCode, n, new Date().toISOString(), itemId, itemId, n).run();
  if (!result.meta?.changes) throw new RegistryError("Someone else has just reserved this gift", 409);
}

export async function releaseReservation(db, inviteCode, reservationId) {
  await db.prepare("DELETE FROM registry_reservations WHERE id = ? AND invite_code = ?").bind(reservationId, inviteCode).run();
}

export async function setReservationBought(db, inviteCode, reservationId, bought) {
  await db.prepare("UPDATE registry_reservations SET bought = ? WHERE id = ? AND invite_code = ?").bind(bought ? 1 : 0, reservationId, inviteCode).run();
}

function cleanHttpUrl(v, label) {
  const s = String(v || "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { throw new RegistryError(`${label} isn't a valid web address`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new RegistryError(`${label} must start with http:// or https://`);
  if (s.length > 2000) throw new RegistryError(`${label} is too long`);
  return u.toString();
}

export async function saveItem(db, p) {
  const name = String(p.name || "").trim();
  if (!name || name.length > 150) throw new RegistryError("Give the gift a name (up to 150 characters)");
  const shop = String(p.shop || "").trim();
  if (shop.length > 60) throw new RegistryError("Shop name is too long (max 60 characters)");
  const category = String(p.category || "").trim();
  if (category.length > 40) throw new RegistryError("Category is too long (max 40 characters)");
  const note = String(p.note || "").trim();
  if (note.length > 300) throw new RegistryError("Note is too long (max 300 characters)");
  const url = cleanHttpUrl(p.url, "Shop link");
  const imageUrl = cleanHttpUrl(p.imageUrl, "Photo link");
  let priceCents = null;
  if (p.price !== "" && p.price != null) {
    const n = Number(p.price);
    if (!Number.isFinite(n) || n < 0 || n >= 1_000_000) throw new RegistryError("Price must be a number");
    priceCents = Math.round(n * 100);
  }
  const quantity = Number(p.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new RegistryError("Quantity must be between 1 and 99");

  const id = String(p.id || "").trim() || genId();
  const existing = await db.prepare("SELECT created_at FROM registry_items WHERE id = ?").bind(id).first();
  if (existing) {
    const t = await db.prepare("SELECT COALESCE(SUM(quantity), 0) AS reserved FROM registry_reservations WHERE item_id = ?").bind(id).first();
    if (quantity < Number(t.reserved)) throw new RegistryError(`Guests have already reserved ${t.reserved} of this, so the quantity can't go below that`);
  }
  await db.prepare(`
    INSERT INTO registry_items (id, name, shop, url, image_url, price_cents, category, quantity, note, most_wanted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, shop = excluded.shop, url = excluded.url, image_url = excluded.image_url,
      price_cents = excluded.price_cents, category = excluded.category, quantity = excluded.quantity,
      note = excluded.note, most_wanted = excluded.most_wanted
  `).bind(id, name, shop, url, imageUrl, priceCents, category, quantity, note, p.mostWanted ? 1 : 0, existing?.created_at || new Date().toISOString()).run();
}

export async function deleteItem(db, id) {
  await db.prepare("DELETE FROM registry_reservations WHERE item_id = ?").bind(id).run();
  await db.prepare("DELETE FROM registry_items WHERE id = ?").bind(id).run();
}

export async function adminRemoveReservation(db, id) {
  await db.prepare("DELETE FROM registry_reservations WHERE id = ?").bind(id).run();
}
