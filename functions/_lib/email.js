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
