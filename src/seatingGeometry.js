// Pure floor-plan geometry shared by the 2D seat map (src/App.jsx) and the 3D
// venue view (src/FloorPlan3D.jsx), so both always agree on where a table and
// each of its chairs are. No React, no three.js.

// The room's default size in floor-plan units. The admin can resize the room
// (app_settings room_width / room_depth); everything takes the room as { w, h }.
export const SEAT_LW = 1000;
export const SEAT_LH = 700;
export const DEFAULT_ROOM = { w: SEAT_LW, h: SEAT_LH };
// 50 plan units = 1 metre (a round table of 90 units is ~1.8 m across; the 50-unit dot grid is 1 m).
export const UNITS_PER_M = 50;
export const ROOM_MIN = 300, ROOM_MAX = 5000; // 6 m .. 100 m
export function roomOf(r) { return r && r.w > 0 && r.h > 0 ? r : DEFAULT_ROOM; }
export function metres(units) { const m = Math.round((units / UNITS_PER_M) * 10) / 10; return `${Number.isInteger(m) ? m : m.toFixed(1)} m`; }
// Smallest room (snapped to 0.5 m) that still holds every table and item, with a margin
// (default 1 m) on the right/bottom.
export function layoutExtent(tables, objects, margin = UNITS_PER_M) {
  const { maxX, maxY } = layoutBounds(tables, objects);
  return { w: Math.max(ROOM_MIN, snapUpHalfM(maxX + margin)), h: Math.max(ROOM_MIN, snapUpHalfM(maxY + margin)) };
}
// Raw outer bounds of everything placed (tables include their chairs). Empty layout: all 0.
export function layoutBounds(tables, objects) {
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  const add = (x0, y0, x1, y1) => { minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); };
  for (const t of tables || []) { const { w, h } = tableDims(t); const r = Math.hypot(w, h) / 2 + 14; add(t.x - r, t.y - r, t.x + r, t.y + r); }
  for (const o of objects || []) {
    const r = o.type === "fireplace" || o.type === "stairs" ? Math.hypot(featureDims(o).w, featureDims(o).d) / 2 : (o.size || 0) / 2;
    const rd = o.type === "rect" ? objectDepth(o) / 2 : r;
    add(o.x - r, o.y - rd, o.x + r, o.y + rd);
    if (o.x2 != null) add(o.x2 - 6, o.y2 - 6, o.x2 + 6, o.y2 + 6);
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}
export function snapUpHalfM(v) { return Math.ceil(v / (UNITS_PER_M / 2)) * (UNITS_PER_M / 2); }
export function snapDownHalfM(v) { return Math.floor(v / (UNITS_PER_M / 2)) * (UNITS_PER_M / 2); }

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// Every table shape reduces to a width/height box plus whether it's
// round-cornered (ellipse) or sharp (rect) — hit-testing, seat layout,
// drawing, and the occupancy-badge offset all read off this one function.
export function tableDims(t) {
  switch (t.shape) {
    case "oval": return { w: t.size, h: t.size2 || t.size * 1.4, round: true };
    case "rect": return { w: t.size, h: t.size * 0.55, round: false };
    case "banquet": return { w: t.size2 || t.size * 2.5, h: t.size, round: false };
    default: return { w: t.size, h: t.size, round: true }; // 'round'
  }
}

export function triangleVertices(o) {
  const r = o.size / 2;
  return [-90, 30, 150].map(deg => {
    const rad = (deg * Math.PI) / 180;
    return [o.x + Math.cos(rad) * r, o.y + Math.sin(rad) * r];
  });
}

// A table's rotation in radians (clockwise on the plan, as degrees are stored).
export function tableAngle(t) { return ((Number(t.rotation) || 0) * Math.PI) / 180; }

// Seat layout, shared by drawing and by the admin seat-picker panel so seat
// N always means the same physical chair everywhere it's referenced.
// Offsets from the table's centre, in the plan's frame (rotation applied).
export function getSeatPositions(t) {
  const a = tableAngle(t), c = Math.cos(a), s = Math.sin(a);
  return getSeatPositionsLocal(t).map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}
// The same seats in the table's own (unrotated) frame.
export function getSeatPositionsLocal(t) {
  const n = Math.max(1, t.capacity | 0);
  const positions = [];
  const { w, h, round } = tableDims(t);
  if (round) {
    const rx = w / 2, ry = h / 2;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      positions.push({ x: Math.cos(ang) * (rx + 12), y: Math.sin(ang) * (ry + 12) });
    }
  } else {
    const perSide = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const onTop = i < perSide;
      const idx = onTop ? i : i - perSide;
      const countInRow = onTop ? perSide : n - perSide;
      positions.push({ x: -w / 2 + (w / (countInRow + 1)) * (idx + 1), y: (onTop ? -1 : 1) * (h / 2 + 12) });
    }
  }
  return positions;
}

// ---- Room features & colours ----
// Line-like floor items are drawn between two end points (x,y)-(x2,y2) and can be
// stretched by dragging either end, like a wall.
export const LINE_TYPES = ["line", "curtain", "window"];
export function isLineObject(o) { return LINE_TYPES.includes(o.type); }

// Fireplace/stairs have a w×d footprint and a facing direction. Local frame:
// width along local x, depth along local y, "forward" = local +y (the
// fireplace's front / the direction the stairs climb). featureAngle() is that
// forward direction in canvas radians.
// A rectangle item's depth (front to back); `size` is its width. Older items (and every other
// shape) have no depth of their own, so they're as deep as they are wide.
export function objectDepth(o) { return o.type === "rect" && Number(o.depth) > 0 ? Number(o.depth) : o.size; }

export function featureDims(o) {
  return o.type === "fireplace" ? { w: o.size, d: o.size * 0.38 } : { w: o.size * 0.55, d: o.size };
}
export function featureAngle(o, room = DEFAULT_ROOM) {
  const { w: RW, h: RH } = roomOf(room);
  if (o.rotation != null && Number.isFinite(Number(o.rotation))) return (Number(o.rotation) * Math.PI) / 180;
  // Not set: face away from (fireplace) or climb toward (stairs) the nearest wall.
  const walls = [[o.x, Math.PI], [RW - o.x, 0], [o.y, -Math.PI / 2], [RH - o.y, Math.PI / 2]];
  const [, toWall] = walls.reduce((a, b) => (b[0] < a[0] ? b : a));
  return o.type === "fireplace" ? toWall + Math.PI : toWall;
}

// Curated colours for tablecloths, chairs and floor items (plus a custom colour).
export const FLOOR_COLORS = [
  ["White", "#FBFAF5"], ["Ivory", "#F3EBDD"], ["Champagne", "#E6D5B5"], ["Blush", "#EBCFC8"],
  ["Dusty rose", "#C99A93"], ["Sage", "#A9B89C"], ["Eucalyptus", "#7E9483"], ["Dark green", "#2F3B30"],
  ["Navy", "#2B3550"], ["Charcoal", "#3C3C3A"]
];
export const CHAIR_COLORS = [
  ["Natural timber", "#B88A55"], ["Gold", "#C9A25C"], ["Dark timber", "#6B4A2E"], ["White", "#ECE8E0"], ["Black", "#2B2A28"]
];
export const DEFAULT_CHAIR_COLOR = "#B88A55";
// Dark or light text, whichever reads better on a fill colour.
export function textColorOn(hex) {
  const n = parseInt(String(hex || "#ffffff").slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.55 ? "#FBF7EF" : "#202B22";
}
