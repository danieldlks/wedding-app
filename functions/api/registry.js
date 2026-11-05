import { rowToRecord } from "../_lib/db.js";
import { getRegistrySettings, guestRegistry, reserveItem, releaseReservation, setReservationBought, RegistryError } from "../_lib/registry.js";
import { registryAccess, registryEventsFor } from "../../src/registryRules.js";

// Guest-facing gift registry. Gated HERE (switched on, invited to the event it's
// attached to, and RSVP'd — see registryAccess), not just hidden in the guest
// UI, so a guest can't open it early by calling the API directly. Guests only
// ever see how many of each gift are still needed, never who reserved what.

async function loadHousehold(env, code) {
  if (!code) return { error: new Response("Missing code", { status: 400 }) };
  const row = await env.DB.prepare("SELECT * FROM households WHERE invite_code = ?").bind(code).first();
  if (!row) return { error: new Response("Not found", { status: 404 }) };
  const record = rowToRecord(row);
  const settings = await getRegistrySettings(env.DB);
  return { record, settings, access: registryAccess(record, settings) };
}

async function payload(env, record, settings, extra = {}) {
  return { visible: true, events: registryEventsFor(record, settings), ...(await guestRegistry(env.DB, record.inviteCode)), ...extra };
}

export async function onRequestGet({ request, env }) {
  const code = (new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  const { error, record, settings, access } = await loadHousehold(env, code);
  if (error) return error;
  if (access !== "visible") return Response.json({ visible: false, access });
  return Response.json(await payload(env, record, settings));
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const code = String(body.code || "").trim().toUpperCase();
  const { error, record, settings, access } = await loadHousehold(env, code);
  if (error) return error;
  if (access !== "visible") return Response.json({ visible: false, access }, { status: 403 });

  try {
    switch (body.action) {
      case "reserve":
        await reserveItem(env.DB, code, String(body.itemId || ""), body.quantity ?? 1);
        break;
      case "release":
        await releaseReservation(env.DB, code, String(body.reservationId || ""));
        break;
      case "set-bought":
        await setReservationBought(env.DB, code, String(body.reservationId || ""), !!body.bought);
        break;
      default:
        return new Response("Unknown action", { status: 400 });
    }
  } catch (e) {
    if (e instanceof RegistryError) {
      // Send the fresh list back with the error so the page can show what changed.
      return Response.json(await payload(env, record, settings, { error: e.message }), { status: e.status });
    }
    throw e;
  }
  return Response.json(await payload(env, record, settings));
}
