// Sends mail via the Google Apps Script Web App deployed from apps-script/Code.gs,
// which relays through the couple's own Gmail account. See README.md for setup.
export async function sendEmail(env, { to, subject, html }) {
  if (!env.EMAIL_WEBAPP_URL || !env.EMAIL_SHARED_SECRET) {
    throw new Error("Email webhook is not configured (EMAIL_WEBAPP_URL / EMAIL_SHARED_SECRET)");
  }
  const res = await fetch(env.EMAIL_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.EMAIL_SHARED_SECRET, to, subject, html })
  });
  // Apps Script's ContentService always responds HTTP 200, even for "Unauthorized" /
  // "Invalid JSON" / "Missing to/subject/html" — so res.ok alone can't tell success
  // from failure. The body text is the real signal.
  const text = await res.text();
  if (!res.ok || text.trim() !== "OK") throw new Error(`Email send failed: ${res.status} ${text.slice(0, 200)}`);
}

// Asks the relay how many more emails Gmail will send today
// (MailApp.getRemainingDailyQuota). Relays deployed before this check existed
// answer "Missing to/subject/html", reported as { remaining: null, reason: "relay-outdated" }.
export async function getEmailQuota(env) {
  if (!env.EMAIL_WEBAPP_URL || !env.EMAIL_SHARED_SECRET) return { remaining: null, reason: "not-configured" };
  try {
    const res = await fetch(env.EMAIL_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.EMAIL_SHARED_SECRET, action: "quota" })
    });
    const text = (await res.text()).trim();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON: an older relay or an error page */ }
    if (data && Number.isFinite(data.remaining)) return { remaining: data.remaining };
    return { remaining: null, reason: text.startsWith("Missing to/subject/html") ? "relay-outdated" : "unavailable" };
  } catch {
    return { remaining: null, reason: "unavailable" };
  }
}
