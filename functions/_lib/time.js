// Time-zone helpers shared by the API and email templates (no dependencies:
// Workers ship the full Intl time-zone database).

export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// Today's calendar date ('YYYY-MM-DD') in the given time zone.
export function todayYmdIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
