// Keep these ids/names in sync with CONFIG.events in src/App.jsx.
// Only used server-side to render human-readable event names in emails.
export const EVENTS = [
  { id: "engagement", name: "Engagement Party" },
  { id: "wedding", name: "Wedding Ceremony & Reception" }
];

export function eventName(id) {
  return EVENTS.find(e => e.id === id)?.name || id;
}

// Hostnames allowed to use /api/admin. The Cloudflare rate-limiting rule on
// /api/admin only covers the custom domain's zone, so the same site's
// *.pages.dev addresses (the project subdomain and every per-deployment hash
// URL) would otherwise be a way around it. localhost/127.0.0.1 keep
// `npm run pages:dev` working. Keep in sync with CONFIG.siteBaseUrl.
export const ADMIN_HOSTS = ["daniel-and-faith.com", "localhost", "127.0.0.1"];

// Used in guest emails. Keep in sync with CONFIG.coupleNames / CONFIG.siteBaseUrl in src/App.jsx.
export const COUPLE_NAMES = "Daniel & Faith";
export const SITE_BASE_URL = "https://daniel-and-faith.com";
