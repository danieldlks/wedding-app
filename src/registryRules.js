// Who can see the gift registry. Shared by the guest pages (src/App.jsx, to
// show or hide the menu card) and the server (functions/api/registry.js, which
// enforces it), so the two can never disagree.
//
// settings = { enabled, event: "engagement" | "wedding" | "both", audience: "replied" | "attending" }
// record   = a household record ({ invitedEvents, response: { members: [{ attending: { [eventId]: bool } }] } })

export const REGISTRY_EVENTS = ["engagement", "wedding", "both"];
export const REGISTRY_AUDIENCES = ["replied", "attending"];
export const DEFAULT_REGISTRY_SETTINGS = { enabled: false, event: "engagement", audience: "replied" };

// The event ids the registry is attached to that this household is invited to.
export function registryEventsFor(record, settings) {
  const s = { ...DEFAULT_REGISTRY_SETTINGS, ...(settings || {}) };
  const invited = record?.invitedEvents || [];
  return s.event === "both" ? invited.slice() : invited.filter(id => id === s.event);
}

// "visible" | "needs-rsvp" (invited, but hasn't replied yet) | "hidden".
export function registryAccess(record, settings) {
  const s = { ...DEFAULT_REGISTRY_SETTINGS, ...(settings || {}) };
  if (!s.enabled || !record) return "hidden";
  const events = registryEventsFor(record, s);
  if (events.length === 0) return "hidden";
  if (!record.response) return "needs-rsvp";
  if (s.audience === "replied") return "visible";
  const members = record.response.members || [];
  return members.some(m => events.some(id => m.attending?.[id])) ? "visible" : "hidden";
}

export function registryVisibleTo(record, settings) {
  return registryAccess(record, settings) === "visible";
}
