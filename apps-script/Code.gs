/**
 * Email relay for the wedding RSVP app.
 *
 * Deploy: Extensions > Apps Script in a Google account (your own Gmail),
 * paste this file in as Code.gs, then Deploy > New deployment > type "Web app",
 * "Execute as: Me", "Who has access: Anyone". Copy the resulting /exec URL into
 * the Cloudflare Pages secret EMAIL_WEBAPP_URL, and set SHARED_SECRET below to
 * match the Pages secret EMAIL_SHARED_SECRET (use a long random string for both).
 *
 * Free quota: 100 emails/day on a personal Gmail account (higher on Workspace).
 */

const SHARED_SECRET = "REPLACE_WITH_A_LONG_RANDOM_STRING";
const SENDER_NAME = "Daniel & Faith"; // shown as the "from" display name

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("Invalid JSON").setMimeType(ContentService.MimeType.TEXT);
  }

  if (!body.secret || body.secret !== SHARED_SECRET) {
    return ContentService.createTextOutput("Unauthorized").setMimeType(ContentService.MimeType.TEXT);
  }
  if (!body.to || !body.subject || !body.html) {
    return ContentService.createTextOutput("Missing to/subject/html").setMimeType(ContentService.MimeType.TEXT);
  }

  MailApp.sendEmail({
    to: body.to,
    subject: body.subject,
    htmlBody: body.html,
    name: SENDER_NAME
  });

  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}
