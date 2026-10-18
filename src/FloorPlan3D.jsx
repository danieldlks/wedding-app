// Lazy-loaded 3D venue view. three.js and everything below only download when
// someone opens the 3D view (see the React.lazy import in src/App.jsx), so
// guests who never open it don't pay for it.
import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SEAT_LW, SEAT_LH, clamp, tableDims, triangleVertices, getSeatPositions } from "./seatingGeometry.js";

// A furnished "dollhouse" of the reception room, built from the same
// seating_tables / floor_objects data the 2D SeatingCanvas draws (issue #4).
// Everything is generated in code — the wood, linen and board textures are
// painted onto canvases at load time — so the realistic look adds nothing to
// download. Walls face inward only, so from outside the near walls vanish and
// you look into the room (like a Matterport dollhouse view).
//
// Scale: 1 world unit ≈ 0.9 m (a 90-unit round table on the plan ≈ 1.8 m).
const FP3D_SCALE = 1 / 45; // logical floor-plan units -> three.js world units
const FP3D_TABLE_H = 0.84;  // tabletop height
const FP3D_WALL_H = 3.4;
const FP3D_CHAIR_GAP = 0.3; // chair centre distance beyond the table edge
const FP3D_LABEL_CHIP = "#FBF7EF";
const FP3D_LABEL_TEXT = "#202B22";
const FP3D_LINEN = "#FBFAF5";
const FP3D_BG = "#F3EDDF";

function fp3dLogicalToWorld(x, y) { return [x * FP3D_SCALE, y * FP3D_SCALE]; }

/* ---------------- device quality tier ----------------
   high: real-time soft shadows. low: older/smaller phones get a lower
   resolution, no shadow maps (soft "blob" shadows under furniture instead,
   which every tier gets) and no MSAA, so it stays smooth and cool. */
function fp3dQuality() {
  const small = Math.min(window.screen?.width || 1024, window.screen?.height || 768) < 600;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  if (small && (cores <= 4 || memory <= 3)) return { tier: "low", pixelRatio: 1.25, shadows: false, antialias: false };
  if (small) return { tier: "medium", pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true, shadowSize: 1024, antialias: true };
  return { tier: "high", pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true, shadowSize: 2048, antialias: true };
}

/* ---------------- procedural textures (no downloads) ---------------- */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  return tex;
}
function drawGrain(ctx, x, y, w, h, rnd, dark, count) {
  ctx.strokeStyle = dark;
  for (let i = 0; i < count; i++) {
    const gy = y + rnd() * h;
    ctx.globalAlpha = 0.08 + rnd() * 0.12;
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    for (let gx = x; gx <= x + w; gx += w / 8) ctx.lineTo(gx, gy + Math.sin(gx * 0.03 + i) * 1.5 + (rnd() - 0.5));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// Light oak floorboards: 8 rows of planks with staggered end joints and grain.
function oakFloorTexture(repeat) {
  return canvasTexture(1024, (ctx, S) => {
    const rnd = seededRandom(7), rows = 8, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * S * 0.5;
      while (x < S) {
        const len = S * (0.35 + rnd() * 0.45);
        const tone = 168 + Math.round(rnd() * 26);
        ctx.fillStyle = `rgb(${tone + 30},${tone + 4},${tone - 40})`;
        ctx.fillRect(x, r * rh, len, rh);
        drawGrain(ctx, x, r * rh, len, rh, rnd, "#7A5A34", 14);
        ctx.fillStyle = "rgba(70,48,24,.55)"; ctx.fillRect(x, r * rh, 2, rh); // end joint
        x += len;
      }
      ctx.fillStyle = "rgba(70,48,24,.6)"; ctx.fillRect(0, r * rh, S, 2); // long seam
    }
  }, { repeat });
}
// Whitewashed vertical barn boards.
function barnBoardTexture(repeat) {
  return canvasTexture(512, (ctx, S) => {
    const rnd = seededRandom(11), boards = 5, bw = S / boards;
    for (let b = 0; b < boards; b++) {
      const tone = 232 + Math.round(rnd() * 12);
      ctx.fillStyle = `rgb(${tone},${tone - 6},${tone - 16})`;
      ctx.fillRect(b * bw, 0, bw, S);
      ctx.save(); ctx.translate(b * bw, S); ctx.rotate(-Math.PI / 2);
      drawGrain(ctx, 0, 0, S, bw, rnd, "#9A8462", 10);
      ctx.restore();
      ctx.fillStyle = "rgba(90,72,48,.35)"; ctx.fillRect(b * bw, 0, 2, S);
    }
  }, { repeat });
}
// Darker timber parquet for a dance floor.
function parquetTexture(repeat) {
  return canvasTexture(512, (ctx, S) => {
    const rnd = seededRandom(23), n = 4, cell = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tone = 92 + Math.round(rnd() * 22);
      ctx.fillStyle = `rgb(${tone + 22},${tone},${tone - 22})`;
      ctx.fillRect(i * cell, j * cell, cell, cell);
      ctx.save(); ctx.translate(i * cell, j * cell);
      if ((i + j) % 2) { ctx.translate(cell, 0); ctx.rotate(Math.PI / 2); }
      for (let k = 0; k < 4; k++) drawGrain(ctx, 0, (k * cell) / 4, cell, cell / 4, rnd, "#2E1E10", 4);
      ctx.fillStyle = "rgba(30,20,10,.5)";
      for (let k = 1; k < 4; k++) ctx.fillRect(0, (k * cell) / 4, cell, 1.5);
      ctx.restore();
      ctx.strokeStyle = "rgba(25,16,8,.7)"; ctx.lineWidth = 2; ctx.strokeRect(i * cell, j * cell, cell, cell);
    }
  }, { repeat });
}
// Soft round contact shadow, used under every table and chair.
function blobShadowTexture() {
  return canvasTexture(128, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(40,28,16,.55)"); g.addColorStop(0.55, "rgba(40,28,16,.22)"); g.addColorStop(1, "rgba(40,28,16,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }, { srgb: false });
}

/* ---------------- labels (DOM text, decluttered) ---------------- */
// Canvas-texture sprites go blurry no matter how you tune them: minified
// (zoomed out) they alias into a grey smudge, magnified (zoomed in close)
// the same fixed-resolution bitmap gets stretched soft. Real DOM text via
// CSS2DRenderer has neither problem — it's rasterized fresh by the browser
// every frame at whatever size it's shown, and it billboards for free.
function makeFp3dLabelObject(text, meta) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    font: 700 13px 'Work Sans', sans-serif; color: ${FP3D_LABEL_TEXT};
    background: ${FP3D_LABEL_CHIP}; padding: 3px 9px; border-radius: 4px;
    white-space: nowrap; pointer-events: none; user-select: none;
    box-shadow: 0 1px 3px rgba(32,43,34,.25); transition: opacity .15s;
  `;
  const obj = new CSS2DObject(el);
  obj.userData = meta; // { kind: 'table'|'object', tableId? } — read by fp3dDeclutterLabels()
  return obj;
}

// Labels are fixed-size DOM chips, so zooming out shrinks the tables but not
// their labels and neighbours start colliding (issue #6). Rather than hide
// everything past an arbitrary camera distance — whether labels overlap
// depends on table spacing and viewport size, not just zoom — this checks
// actual on-screen overlap every frame and fades out any label that would
// cover a higher-priority one. Priority: selected table, hovered table, other
// tables, then landmarks; ties prefer whatever is already showing (so labels
// don't flicker while orbiting), then whichever is nearer the camera.
const _fp3dLabelPos = new THREE.Vector3();
function fp3dDeclutterLabels(s) {
  const { camera, labels, size, activeTableId, hoveredTableId } = s;
  const pad = 3;
  const entries = [];
  for (const obj of labels) {
    const el = obj.element;
    if (el.style.display === "none") continue; // already culled by CSS2DRenderer (off-screen/behind camera)
    if (!obj.userData.w) { obj.userData.w = el.offsetWidth; obj.userData.h = el.offsetHeight; } // text never changes after build, so measure once
    _fp3dLabelPos.setFromMatrixPosition(obj.matrixWorld);
    const dist = _fp3dLabelPos.distanceToSquared(camera.position);
    _fp3dLabelPos.project(camera);
    const cx = (_fp3dLabelPos.x + 1) / 2 * size.w, cy = (1 - _fp3dLabelPos.y) / 2 * size.h;
    const hw = obj.userData.w / 2 + pad, hh = obj.userData.h / 2 + pad;
    const id = obj.userData.tableId;
    const rank = id != null && id === activeTableId ? 0
      : id != null && id === hoveredTableId ? 1
      : obj.userData.kind === "table" ? 2 : 3;
    entries.push({ el, rank, dist, shown: el.style.opacity !== "0", x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh });
  }
  entries.sort((a, b) => a.rank - b.rank || b.shown - a.shown || a.dist - b.dist);
  const placed = [];
  for (const e of entries) {
    const show = e.rank <= 1 || !placed.some(p => e.x0 < p.x1 && e.x1 > p.x0 && e.y0 < p.y1 && e.y1 > p.y0);
    if (show) placed.push(e);
    const opacity = show ? "1" : "0";
    if (e.el.style.opacity !== opacity) e.el.style.opacity = opacity;
  }
}

/* ---------------- furniture ---------------- */
// One chair, merged into a single geometry (frame) + one for the cushion, so
// every chair in the room is drawn with two instanced draw calls. Faces +z
// (its back is at -z); rotated per seat to face its table.
function buildChairGeometries() {
  const parts = [];
  const leg = (x, z, h) => new THREE.BoxGeometry(0.04, h, 0.04).translate(x, h / 2, z);
  const s = 0.2, seatY = 0.46;
  parts.push(leg(-s, s, seatY), leg(s, s, seatY));                       // front legs
  parts.push(leg(-s, -s, seatY + 0.5), leg(s, -s, seatY + 0.5));         // back legs run up into the back posts
  parts.push(new THREE.BoxGeometry(0.44, 0.04, 0.44).translate(0, seatY, 0)); // seat frame
  parts.push(new THREE.BoxGeometry(0.44, 0.05, 0.03).translate(0, seatY + 0.47, -s)); // top rail
  parts.push(new THREE.BoxGeometry(0.44, 0.03, 0.03).translate(0, seatY + 0.26, -s)); // mid rail
  for (const x of [-0.1, 0, 0.1]) parts.push(new THREE.BoxGeometry(0.025, 0.24, 0.02).translate(x, seatY + 0.36, -s)); // spindles
  const frame = mergeGeometries(parts);
  const cushion = new THREE.BoxGeometry(0.4, 0.05, 0.38).translate(0, seatY + 0.045, 0.01);
  return { frame, cushion };
}

// Where each chair goes, in the SAME order as getSeatPositions() (so "seat 3"
// is the same physical chair in 2D, 3D and the admin seat picker), but pushed
// out to a realistic distance from the table edge and turned to face it.
function chairPlacements(t) {
  const { w, h, round } = tableDims(t);
  const [ww, wh] = fp3dLogicalToWorld(w, h);
  const [cx, cz] = fp3dLogicalToWorld(t.x, t.y);
  return getSeatPositions(t).map((p, i) => {
    let x, z, yaw;
    if (round) {
      const ang = Math.atan2(p.y, p.x);
      x = Math.cos(ang) * (ww / 2 + FP3D_CHAIR_GAP);
      z = Math.sin(ang) * (wh / 2 + FP3D_CHAIR_GAP);
      yaw = Math.atan2(-x, -z); // face the centre
    } else {
      const sideSign = Math.sign(p.y) || 1;
      x = p.x * FP3D_SCALE;
      z = sideSign * (wh / 2 + FP3D_CHAIR_GAP);
      yaw = sideSign > 0 ? Math.PI : 0;
    }
    return { x: cx + x, z: cz + z, yaw, seatIndex: i };
  });
}

// Linen-draped table (cloth falls to the floor) with a low centrepiece.
// The cloth mesh is what gets clicked/raycast and recoloured when selected.
function buildTable(t, mats) {
  const { w, h, round } = tableDims(t);
  const [ww, wh] = fp3dLogicalToWorld(w, h);
  const [px, pz] = fp3dLogicalToWorld(t.x, t.y);
  const cloth = new THREE.MeshStandardMaterial({ color: FP3D_LINEN, roughness: 0.92 });
  let geo;
  if (round) {
    // Slight flare towards the floor reads as fabric rather than a solid drum.
    geo = new THREE.CylinderGeometry(0.5, 0.53, FP3D_TABLE_H, 48, 1).scale(ww, 1, wh);
  } else {
    geo = new THREE.BoxGeometry(ww, FP3D_TABLE_H, wh);
  }
  const mesh = new THREE.Mesh(geo, cloth);
  mesh.position.set(px, FP3D_TABLE_H / 2, pz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { tableId: t.id };
  // Centrepiece: a glass vase with a posy of greenery and two candles.
  const vase = new THREE.Mesh(mats.vaseGeo, mats.glass); vase.position.set(0, FP3D_TABLE_H / 2 + 0.11, 0);
  const posy = new THREE.Mesh(mats.posyGeo, mats.greenery); posy.position.set(0, FP3D_TABLE_H / 2 + 0.3, 0); posy.castShadow = true;
  mesh.add(vase, posy);
  for (const dx of [-0.22, 0.22]) {
    const candle = new THREE.Mesh(mats.candleGeo, mats.candle); candle.position.set(dx, FP3D_TABLE_H / 2 + 0.07, 0.05);
    mesh.add(candle);
  }
  mesh.add(makeFp3dLabelObject(t.label, { kind: "table", tableId: t.id }).translateY(FP3D_TABLE_H / 2 + 0.95));
  return mesh;
}

// Landmarks: styled by what they're called (the admin's label), falling back
// to a neutral timber plinth. Walls/barriers ("line") become timber half-walls.
function landmarkKind(o) {
  const l = (o.label || "").toLowerCase();
  if (o.type === "line") return "wall";
  if (/dance/.test(l)) return "dance";
  if (/\bbar\b|drinks|bev/.test(l)) return "bar";
  if (/stage|band|\bdj\b|music/.test(l)) return "stage";
  if (/door|entr|exit|way in|way out/.test(l)) return "door";
  if (/cake|gift|sign|photo|booth|guest ?book|dessert|buffet|food/.test(l)) return "side";
  return "plinth";
}
function footprintGeometry(o, height) {
  if (o.type === "rect") { const [sx, sz] = fp3dLogicalToWorld(o.size, o.size); return new THREE.BoxGeometry(sx, height, sz).translate(0, height / 2, 0); }
  if (o.type === "circle") { const [r] = fp3dLogicalToWorld(o.size / 2, 0); return new THREE.CylinderGeometry(r, r, height, 40).translate(0, height / 2, 0); }
  const shape = new THREE.Shape();
  triangleVertices(o).forEach(([vx, vy], i) => {
    const [lx, ly] = fp3dLogicalToWorld(vx - o.x, vy - o.y);
    i === 0 ? shape.moveTo(lx, -ly) : shape.lineTo(lx, -ly);
  });
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2);
}
function buildLandmark(o, mats) {
  const group = new THREE.Group();
  const kind = landmarkKind(o);
  let labelY = 1.0;
  if (kind === "wall") {
    const dx = o.x2 - o.x, dy = o.y2 - o.y;
    const [lx, ly] = fp3dLogicalToWorld(dx, dy);
    const len = Math.max(0.05, Math.hypot(lx, ly));
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.05, 0.12), mats.timber);
    const [mx, mz] = fp3dLogicalToWorld((o.x + o.x2) / 2, (o.y + o.y2) / 2);
    wall.position.set(mx, 0.525, mz); wall.rotation.y = -Math.atan2(dy, dx);
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
    if (o.label) group.add(makeFp3dLabelObject(o.label, { kind: "object" }).translateX(mx).translateZ(mz).translateY(1.4));
    return group;
  }
  const [px, pz] = fp3dLogicalToWorld(o.x, o.y);
  let mesh;
  if (kind === "dance") {
    mesh = new THREE.Mesh(footprintGeometry(o, 0.03), mats.parquet);
    mesh.receiveShadow = true; labelY = 0.5;
  } else if (kind === "bar") {
    mesh = new THREE.Mesh(footprintGeometry(o, 1.1), mats.timberDark);
    const top = new THREE.Mesh(footprintGeometry(o, 0.05), mats.barTop); top.position.y = 1.1; mesh.add(top);
    labelY = 1.6;
  } else if (kind === "stage") {
    mesh = new THREE.Mesh(footprintGeometry(o, 0.32), mats.timberDark); labelY = 0.9;
  } else if (kind === "door") {
    // A timber door frame (two posts + lintel) standing on a mat.
    mesh = new THREE.Mesh(footprintGeometry(o, 0.015), mats.mat);
    const [half] = fp3dLogicalToWorld(Math.min(o.size, 80) / 2, 0);
    for (const sx of [-half, half]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.3, 0.1), mats.timberDark); post.position.set(sx, 1.15, 0); post.castShadow = true; mesh.add(post); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.1, 0.12, 0.12), mats.timberDark); lintel.position.set(0, 2.3, 0); mesh.add(lintel);
    labelY = 2.7;
  } else if (kind === "side") {
    mesh = new THREE.Mesh(footprintGeometry(o, 0.8), mats.linen); labelY = 1.3;
  } else {
    mesh = new THREE.Mesh(footprintGeometry(o, 0.4), mats.timber); labelY = 0.9;
  }
  mesh.position.set(px, 0, pz);
  mesh.castShadow = kind !== "dance"; mesh.receiveShadow = true;
  group.add(mesh);
  if (o.label) group.add(makeFp3dLabelObject(o.label, { kind: "object" }).translateX(px).translateZ(pz).translateY(labelY));
  return group;
}

// The room shell: oak floor, inward-facing whitewashed board walls with a
// skirting, and festoon string lights across the room. FrontSide-only walls
// are invisible from behind, so whichever walls are nearest the camera simply
// disappear and you see into the room.
function buildRoom(roomW, roomD, mats) {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), mats.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set(roomW / 2, 0, roomD / 2);
  floor.receiveShadow = true;
  group.add(floor);
  const walls = [
    { len: roomW, pos: [roomW / 2, 0, 0], rotY: 0 },              // back (faces +z)
    { len: roomW, pos: [roomW / 2, 0, roomD], rotY: Math.PI },    // front (faces -z)
    { len: roomD, pos: [0, 0, roomD / 2], rotY: Math.PI / 2 },    // left (faces +x)
    { len: roomD, pos: [roomW, 0, roomD / 2], rotY: -Math.PI / 2 } // right (faces -x)
  ];
  for (const w of walls) {
    const boardMat = mats.wall.clone();
    boardMat.map = mats.wall.map.clone(); boardMat.map.repeat.set(w.len / 3, 1); boardMat.map.needsUpdate = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w.len, FP3D_WALL_H), boardMat);
    wall.position.set(w.pos[0], FP3D_WALL_H / 2, w.pos[2]); wall.rotation.y = w.rotY;
    wall.receiveShadow = true;
    const skirting = new THREE.Mesh(new THREE.PlaneGeometry(w.len, 0.18), mats.skirting);
    skirting.position.set(w.pos[0], 0.09, w.pos[2]); skirting.rotation.y = w.rotY;
    skirting.translateZ(0.005);
    group.add(wall, skirting);
  }
  // Festoon lights: strands across the room's width with a gentle sag.
  const bulbs = [], wire = [];
  const strands = Math.max(3, Math.round(roomD / 3.2));
  for (let k = 0; k < strands; k++) {
    const z = (roomD / (strands + 1)) * (k + 1);
    const n = Math.round(roomW / 0.75);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = t * roomW, y = FP3D_WALL_H - 0.25 - 0.55 * (1 - (2 * t - 1) ** 2);
      pts.push(new THREE.Vector3(x, y, z));
      if (i > 0 && i < n) bulbs.push([x, y - 0.08, z]);
    }
    wire.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mats.wire));
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8), mats.bulb, bulbs.length);
  const m = new THREE.Matrix4();
  bulbs.forEach(([x, y, z], i) => bulbMesh.setMatrixAt(i, m.makeTranslation(x, y, z)));
  group.add(bulbMesh, ...wire);
  return group;
}

function makeMaterials(roomW, roomD) {
  return {
    floor: new THREE.MeshStandardMaterial({ map: oakFloorTexture([roomW / 3.6, roomD / 3.6]), roughness: 0.62, metalness: 0 }),
    // Vertical walls catch little of the overhead light, so a touch of self-light keeps them reading as whitewash, not grey.
    wall: new THREE.MeshStandardMaterial({ map: barnBoardTexture([1, 1]), roughness: 0.95, emissive: "#F2EBDD", emissiveIntensity: 0.38 }),
    skirting: new THREE.MeshStandardMaterial({ color: "#8A6A48", roughness: 0.8 }),
    parquet: new THREE.MeshStandardMaterial({ map: parquetTexture([3, 3]), roughness: 0.35, metalness: 0.05 }),
    timber: new THREE.MeshStandardMaterial({ map: oakFloorTexture([1, 1]), roughness: 0.7 }),
    timberDark: new THREE.MeshStandardMaterial({ color: "#6B4A2E", roughness: 0.7 }),
    barTop: new THREE.MeshStandardMaterial({ color: "#3B2A1C", roughness: 0.35 }),
    linen: new THREE.MeshStandardMaterial({ color: FP3D_LINEN, roughness: 0.92 }),
    mat: new THREE.MeshStandardMaterial({ color: "#9A8A6E", roughness: 1 }),
    chairFrame: new THREE.MeshStandardMaterial({ color: "#B88A55", roughness: 0.55 }),
    cushion: new THREE.MeshStandardMaterial({ color: "#F4EFE4", roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: "#D9E6E0", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 }),
    greenery: new THREE.MeshStandardMaterial({ color: "#6E7F63", roughness: 0.9, flatShading: true }),
    candle: new THREE.MeshStandardMaterial({ color: "#FFF6E0", emissive: "#FFB85C", emissiveIntensity: 0.25, roughness: 0.6 }),
    bulb: new THREE.MeshBasicMaterial({ color: "#FFE2A8" }),
    wire: new THREE.LineBasicMaterial({ color: "#3A3F37" }),
    blob: new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
    vaseGeo: new THREE.CylinderGeometry(0.07, 0.06, 0.22, 16),
    posyGeo: new THREE.IcosahedronGeometry(0.16, 1).scale(1.3, 0.75, 1.3),
    candleGeo: new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10),
  };
}

function fp3dAnimateCamera(s, toTarget, toCamPos) {
  const fromTarget = s.controls.target.clone();
  const fromCamPos = s.camera.position.clone();
  const start = performance.now();
  const myGen = (s.focusGen || 0) + 1;
  s.focusGen = myGen;
  function step(now) {
    if (!s.camera || s.focusGen !== myGen) return;
    const t = Math.min(1, (now - start) / 500);
    const eased = 1 - Math.pow(1 - t, 3);
    s.controls.target.lerpVectors(fromTarget, toTarget, eased);
    s.camera.position.lerpVectors(fromCamPos, toCamPos, eased);
    s.invalidate();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function fp3dZoomBy(s, factor) {
  if (!s) return;
  const dir = s.camera.position.clone().sub(s.controls.target);
  const dist = clamp(dir.length() * factor, s.controls.minDistance, s.controls.maxDistance);
  s.camera.position.copy(s.controls.target).add(dir.normalize().multiplyScalar(dist));
  s.invalidate();
}

function applyTableHighlight(tableMeshes, activeId, focusColor) {
  tableMeshes.forEach((mesh, id) => {
    const isActive = id === activeId;
    mesh.material.color.set(isActive ? focusColor : FP3D_LINEN);
    mesh.material.emissive.set(isActive ? focusColor : "#000000");
    mesh.material.emissiveIntensity = isActive ? 0.25 : 0;
  });
}

const FloorPlan3D = forwardRef(function FloorPlan3D({ tables, objects, focusTableId, focusColor = "#A9814C", onSelectTable }, ref) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const tableMeshesRef = useRef(new Map());
  const selectRef = useRef(onSelectTable);
  selectRef.current = onSelectTable;
  const [clickedTableId, setClickedTableId] = useState(null);

  useImperativeHandle(ref, () => ({
    zoomIn() { fp3dZoomBy(sceneRef.current, 1 / 1.25); },
    zoomOut() { fp3dZoomBy(sceneRef.current, 1.25); },
    recenter() {
      const s = sceneRef.current;
      if (!s) return;
      fp3dAnimateCamera(s, s.initialTarget.clone(), s.initialCamPos.clone());
    }
  }), []);

  // One-time scene/camera/renderer/controls setup; torn down on unmount.
  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth || 600, height = mount.clientHeight || 420;
    const quality = fp3dQuality();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FP3D_BG);

    const [roomW, roomD] = fp3dLogicalToWorld(SEAT_LW, SEAT_LH);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    const center = new THREE.Vector3(roomW / 2, 0, roomD / 2);
    camera.position.set(center.x, Math.max(roomW, roomD) * 0.62, center.z + Math.max(roomW, roomD) * 0.75);

    const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias });
    renderer.setPixelRatio(quality.pixelRatio);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (quality.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.domElement.dataset.quality = quality.tier; // for tests/debugging
    mount.appendChild(renderer.domElement);

    // Renders real DOM text for table/landmark labels, overlaid on the WebGL
    // canvas — see makeFp3dLabelObject() for why (canvas-texture sprites blur).
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    Object.assign(labelRenderer.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
    mount.style.position = "relative";
    mount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the floor
    controls.minDistance = 3;
    controls.maxDistance = Math.max(roomW, roomD) * 2.2;
    controls.update();

    // Warm, soft "afternoon in a barn" light: sky/ground fill plus one sun
    // through the windows that casts the shadows.
    scene.add(new THREE.HemisphereLight("#FFF4E2", "#8A6A48", 1.1));
    scene.add(new THREE.AmbientLight("#FFFFFF", 0.18));
    const sun = new THREE.DirectionalLight("#FFE6C4", 1.7);
    sun.position.set(roomW * 0.2, 14, roomD * 0.1);
    sun.target.position.set(roomW / 2, 0, roomD / 2);
    scene.add(sun, sun.target);
    if (quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      const half = Math.max(roomW, roomD) * 0.65;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 40 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.02;
      sun.shadow.radius = 4;
    }

    const mats = makeMaterials(roomW, roomD);
    scene.add(buildRoom(roomW, roomD, mats));
    const chairGeo = buildChairGeometries();

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);

    // Render on demand: only when something changed (camera moved, hover,
    // selection, data, resize), instead of 60 times a second forever — easier
    // on phone batteries. Damping keeps it going until the camera settles.
    let raf = 0;
    function frame() {
      raf = 0;
      const moving = controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      if (sceneRef.current) fp3dDeclutterLabels(sceneRef.current);
      if (moving) invalidate();
    }
    function invalidate() { if (!raf) raf = requestAnimationFrame(frame); }
    controls.addEventListener("change", invalidate);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = null;
    function hitTable(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...tableMeshesRef.current.values()], false)[0];
      return hit ? hit.object.userData.tableId : null;
    }
    function onPointerDown(e) { downPos = [e.clientX, e.clientY]; }
    function onPointerUp(e) {
      if (downPos && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4) return; // was a drag/orbit, not a click
      const tableId = hitTable(e);
      setClickedTableId(tableId);
      selectRef.current?.(tableId);
    }
    function onPointerMove(e) {
      if (e.buttons) return; // orbiting — skip the raycast
      const id = hitTable(e);
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      if (sceneRef.current && sceneRef.current.hoveredTableId !== id) { sceneRef.current.hoveredTableId = id; invalidate(); }
    }
    function onPointerLeave() {
      if (sceneRef.current && sceneRef.current.hoveredTableId) { sceneRef.current.hoveredTableId = null; invalidate(); }
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      sceneRef.current.size = { w, h };
      invalidate();
    });
    ro.observe(mount);

    sceneRef.current = {
      scene, camera, controls, contentGroup, center, mats, chairGeo, invalidate, renderer,
      labels: [], size: { w: width, h: height }, activeTableId: null, hoveredTableId: null,
      initialCamPos: camera.position.clone(), initialTarget: center.clone()
    };
    invalidate();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener("change", invalidate);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      scene.traverse(obj => {
        obj.geometry?.dispose();
        (Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []).forEach(m => { m.map?.dispose(); m.dispose(); });
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(labelRenderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Rebuild furniture whenever the floor plan data changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.contentGroup.traverse(obj => {
      if (obj.isCSS2DObject) { obj.element.remove(); return; } // CSS2DRenderer never removes stale elements on its own
      // Shared geometries/materials (s.mats, s.chairGeo) are reused across rebuilds; only per-build ones are disposed.
      if (obj.userData.ownsGeometry) obj.geometry.dispose();
      if (obj.userData.ownsMaterial) obj.material.dispose();
    });
    s.contentGroup.clear();
    tableMeshesRef.current = new Map();
    (objects || []).forEach(o => {
      const g = buildLandmark(o, s.mats);
      g.traverse(obj => { if (obj.isMesh) obj.userData.ownsGeometry = true; });
      s.contentGroup.add(g);
    });
    const chairs = [];
    const blobs = [];
    (tables || []).forEach(t => {
      const mesh = buildTable(t, s.mats);
      mesh.userData.ownsGeometry = true; mesh.userData.ownsMaterial = true;
      tableMeshesRef.current.set(t.id, mesh);
      s.contentGroup.add(mesh);
      const { w, h } = tableDims(t);
      const [ww, wh] = fp3dLogicalToWorld(w, h);
      blobs.push({ x: mesh.position.x, z: mesh.position.z, sx: ww * 1.25, sz: wh * 1.25 });
      chairPlacements(t).forEach(c => { chairs.push({ ...c, tableId: t.id }); blobs.push({ x: c.x, z: c.z, sx: 0.65, sz: 0.65 }); });
    });
    // All chairs: two instanced meshes (frame + cushion) for the whole room.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const frames = new THREE.InstancedMesh(s.chairGeo.frame, s.mats.chairFrame, Math.max(1, chairs.length));
    const cushions = new THREE.InstancedMesh(s.chairGeo.cushion, s.mats.cushion, Math.max(1, chairs.length));
    frames.count = cushions.count = chairs.length;
    chairs.forEach((c, i) => {
      m.compose(new THREE.Vector3(c.x, 0, c.z), q.setFromAxisAngle(up, c.yaw), one);
      frames.setMatrixAt(i, m); cushions.setMatrixAt(i, m);
    });
    frames.castShadow = cushions.castShadow = true;
    frames.receiveShadow = cushions.receiveShadow = true;
    s.contentGroup.add(frames, cushions);
    s.chairs = chairs;
    // Soft contact shadows under everything (the only shadows on low-tier devices).
    const blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), s.mats.blob, Math.max(1, blobs.length));
    blobMesh.count = blobs.length;
    blobs.forEach((b, i) => blobMesh.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, 0.004, b.z), q.identity(), new THREE.Vector3(b.sx, 1, b.sz))));
    blobMesh.userData.ownsGeometry = true;
    blobMesh.renderOrder = 1;
    s.contentGroup.add(blobMesh);

    s.labels = [];
    s.contentGroup.traverse(obj => { if (obj.isCSS2DObject) s.labels.push(obj); });
    // Rebuilt meshes start plain: re-apply the current selection colour, but
    // don't move the camera (the venue display re-polls the plan every few seconds).
    applyTableHighlight(tableMeshesRef.current, s.activeTableId, s.focusColor || focusColor);
    s.invalidate();
  }, [tables, objects]);

  // Recolor for the externally-driven (guest search) or locally-clicked
  // selection, and fly the camera to whichever table is focused.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const activeId = focusTableId || clickedTableId;
    s.activeTableId = activeId;
    s.focusColor = focusColor;
    applyTableHighlight(tableMeshesRef.current, activeId, focusColor);
    const targetMesh = activeId ? tableMeshesRef.current.get(activeId) : null;
    const target = targetMesh ? targetMesh.position.clone().setY(0) : s.center;
    const dist = s.camera.position.distanceTo(s.controls.target) || 6;
    const dir = s.camera.position.clone().sub(s.controls.target).normalize();
    const toDist = targetMesh ? Math.min(dist, 5) : dist;
    fp3dAnimateCamera(s, target, target.clone().add(dir.multiplyScalar(toDist)));
    s.invalidate();
  }, [focusTableId, focusColor, clickedTableId]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
});

export default FloorPlan3D;
