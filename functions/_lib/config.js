// The fixed set of events (ids are linked to every invitation and RSVP, so
// adding/removing one is a code change). Names and time zones here are only
// DEFAULTS — the admin edits them in Settings (app_settings
// `event_details_<id>`); use resolveEventNames()/eventTimeZones() from db.js,
// not these, when rendering. Keep ids and defaults in sync with CONFIG.events
// in src/App.jsx.
export const EVENTS = [
  { id: "engagement", name: "Engagement Party", timeZone: "Australia/Adelaide" },
  { id: "wedding", name: "Wedding Ceremony & Reception", timeZone: "Australia/Adelaide" }
];

// Hostnames allowed to use /api/admin. The Cloudflare rate-limiting rule on
// /api/admin only covers the custom domain's zone, so the same site's
// *.pages.dev addresses (the project subdomain and every per-deployment hash
// URL) would otherwise be a way around it. localhost/127.0.0.1 keep
// `npm run pages:dev` working. Keep in sync with CONFIG.siteBaseUrl.
export const ADMIN_HOSTS = ["daniel-and-faith.com", "localhost", "127.0.0.1"];

// Used in guest emails. Keep in sync with CONFIG.coupleNames / CONFIG.siteBaseUrl in src/App.jsx.
export const COUPLE_NAMES = "Daniel & Faith";
export const SITE_BASE_URL = "https://daniel-and-faith.com";
// The site's usual time zone: an announcement's "show until" date is judged in
// it. (Each event's reply-by date uses that event's own time zone.) Keep in
// sync with CONFIG.timeZone in src/App.jsx.
export const TIME_ZONE = "Australia/Adelaide";
