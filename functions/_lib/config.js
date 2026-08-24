// Keep these ids/names in sync with CONFIG.events in src/App.jsx.
// Only used server-side to render human-readable event names in emails.
export const EVENTS = [
  { id: "engagement", name: "Engagement Party" },
  { id: "wedding", name: "Wedding Ceremony & Reception" }
];

export function eventName(id) {
  return EVENTS.find(e => e.id === id)?.name || id;
}
