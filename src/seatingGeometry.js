// Pure floor-plan geometry shared by the 2D seat map (src/App.jsx) and the 3D
// venue view (src/FloorPlan3D.jsx), so both always agree on where a table and
// each of its chairs are. No React, no three.js.

export const SEAT_LW = 1000;
export const SEAT_LH = 700;

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

// Seat layout, shared by drawing and by the admin seat-picker panel so seat
// N always means the same physical chair everywhere it's referenced.
export function getSeatPositions(t) {
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
