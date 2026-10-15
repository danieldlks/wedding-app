import { rowToRecord, getGuestSiteSettings } from "../_lib/db.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });

  const row = await env.DB.prepare("SELECT * FROM households WHERE invite_code = ?").bind(code).first();
  if (!row) return new Response("Not found", { status: 404 });

  // `site` rides along with the household record so the guest pages get the
  // admin-set RSVP deadlines etc. without a second request. It's kept out of
  // the record itself on the client (see init() in src/App.jsx).
  return Response.json({ ...rowToRecord(row), site: await getGuestSiteSettings(env.DB) });
}
