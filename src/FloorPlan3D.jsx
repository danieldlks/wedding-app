// Lazy-loaded 3D venue view. three.js and everything below only download when
// someone opens the 3D view (see the React.lazy import in src/App.jsx), so
// guests who never open it don't pay for it.
import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { SEAT_LW, SEAT_LH, clamp, tableDims, triangleVertices } from "./seatingGeometry.js";

// Schematic 3D orbit view of the same seating_tables/floor_objects data the
// 2D SeatingCanvas draws — see GitHub issue #4. Deliberately flat-shaded
// blocks in the existing palette, no walls/ceiling: this is a "which table
// is where" orbit toy for the venue-display lobby screen, not a room replica.
const FP3D_SCALE = 1 / 45; // logical floor-plan units -> three.js world units
const FP3D_TABLE_H = 0.9;
const FP3D_OBJ_H = 0.5;
const FP3D_TABLE_TOP = "#FBF7EF"; // paper — the tabletop guests would look down at
const FP3D_TABLE_SIDE = "#D8C8A5"; // gold-soft — reads as a "skirt", cheap depth cue with only flat colors
const FP3D_TABLE_EDGE = "#A9814C";
const FP3D_OBJECT_COLOR = "#C9B790"; // sits between gold-soft and paper-2, reads as a landmark not a table
const FP3D_WALL_COLOR = "#3A3F37";
const FP3D_FLOOR_COLOR = "#F3EDDF";
const FP3D_LABEL_CHIP = "#FBF7EF";
const FP3D_LABEL_TEXT = "#202B22";

function fp3dLogicalToWorld(x, y) { return [x * FP3D_SCALE, y * FP3D_SCALE]; }

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

// One mesh (with an edge outline as a child) per table, positioned/sized off
// the same tableDims() the 2D canvas uses so the two views can't drift apart.
// Top/side get two flat colors (not a texture) so the table reads as a
// distinct object against the floor instead of a flat-lit grey blob.
function buildFp3dTableMesh(t) {
  const { w, h, round } = tableDims(t);
  const [wx, wy] = fp3dLogicalToWorld(w, h);
  const topMat = new THREE.MeshLambertMaterial({ color: FP3D_TABLE_TOP });
  const sideMat = new THREE.MeshLambertMaterial({ color: FP3D_TABLE_SIDE });
  let geo, materials;
  if (round) {
    geo = new THREE.CylinderGeometry(0.5, 0.5, FP3D_TABLE_H, 40).scale(wx, 1, wy);
    materials = [sideMat, topMat, sideMat]; // CylinderGeometry groups: side, top, bottom
  } else {
    geo = new THREE.BoxGeometry(wx, FP3D_TABLE_H, wy);
    // BoxGeometry groups are one per face (+x,-x,+y,-y,+z,-z); remap so only
    // the top (+y, group index 2) uses the light material, everything else stays "side".
    geo.groups.forEach((g, i) => { g.materialIndex = i === 2 ? 1 : 0; });
    materials = [sideMat, topMat];
  }
  const mesh = new THREE.Mesh(geo, materials);
  const [px, py] = fp3dLogicalToWorld(t.x, t.y);
  mesh.position.set(px, FP3D_TABLE_H / 2, py);
  mesh.userData = { tableId: t.id };
  const edgeMat = new THREE.LineBasicMaterial({ color: FP3D_TABLE_EDGE });
  if (round) {
    // A full EdgesGeometry on a 40-segment cylinder draws every vertical
    // side seam, which reads as barrel-stripes rather than a table rim —
    // just the top perimeter reads as "round table" without the clutter.
    const rimPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      rimPts.push(new THREE.Vector3(Math.cos(a) * wx / 2, FP3D_TABLE_H / 2, Math.sin(a) * wy / 2));
    }
    mesh.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), edgeMat));
  } else {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat));
  }
  mesh.add(makeFp3dLabelObject(t.label, { kind: "table", tableId: t.id }).translateY(FP3D_TABLE_H / 2 + 0.55));
  return mesh;
}

// Floor landmarks (bar, doors, walls/barriers) as low, non-interactive blocks
// — same shapes as drawFloorPlan()'s 2D pass, just extruded a little.
function buildFp3dObjectMesh(o) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: o.type === "line" ? FP3D_WALL_COLOR : FP3D_OBJECT_COLOR });
  let mesh;
  if (o.type === "line") {
    const dx = o.x2 - o.x, dy = o.y2 - o.y;
    const [lenX, lenY] = fp3dLogicalToWorld(dx, dy);
    const len = Math.max(0.05, Math.hypot(lenX, lenY));
    mesh = new THREE.Mesh(new THREE.BoxGeometry(len, FP3D_OBJ_H, 0.14), mat);
    const [mx, my] = fp3dLogicalToWorld((o.x + o.x2) / 2, (o.y + o.y2) / 2);
    mesh.position.set(mx, FP3D_OBJ_H / 2, my);
    mesh.rotation.y = -Math.atan2(dy, dx);
  } else if (o.type === "rect") {
    const [sx, sy] = fp3dLogicalToWorld(o.size, o.size);
    mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, FP3D_OBJ_H, sy), mat);
    const [px, py] = fp3dLogicalToWorld(o.x, o.y);
    mesh.position.set(px, FP3D_OBJ_H / 2, py);
  } else if (o.type === "triangle") {
    const shape = new THREE.Shape();
    triangleVertices(o).forEach(([vx, vy], i) => {
      const [lx, ly] = fp3dLogicalToWorld(vx - o.x, vy - o.y);
      i === 0 ? shape.moveTo(lx, ly) : shape.lineTo(lx, ly);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: FP3D_OBJ_H, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    mesh = new THREE.Mesh(geo, mat);
    const [px, py] = fp3dLogicalToWorld(o.x, o.y);
    mesh.position.set(px, FP3D_OBJ_H / 2, py);
  } else { // 'circle'
    const [r] = fp3dLogicalToWorld(o.size / 2, 0);
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, FP3D_OBJ_H, 28), mat);
    const [px, py] = fp3dLogicalToWorld(o.x, o.y);
    mesh.position.set(px, FP3D_OBJ_H / 2, py);
  }
  group.add(mesh);
  if (o.label) group.add(makeFp3dLabelObject(o.label, { kind: "object" }).translateY(FP3D_OBJ_H + 0.4).translateX(mesh.position.x).translateZ(mesh.position.z));
  return group;
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
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FP3D_FLOOR_COLOR);

    const [roomW, roomH] = fp3dLogicalToWorld(SEAT_LW, SEAT_LH);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    const center = new THREE.Vector3(roomW / 2, 0, roomH / 2);
    camera.position.set(center.x, Math.max(roomW, roomH) * 0.62, center.z + Math.max(roomW, roomH) * 0.75);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
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
    controls.maxDistance = Math.max(roomW, roomH) * 2.2;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(roomW * 0.3, Math.max(roomW, roomH), roomH * 0.7);
    scene.add(dirLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(roomW, roomH),
      new THREE.MeshLambertMaterial({ color: FP3D_FLOOR_COLOR })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomW / 2, 0, roomH / 2);
    scene.add(floor);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = null;
    function onPointerDown(e) { downPos = [e.clientX, e.clientY]; }
    function onPointerUp(e) {
      if (downPos && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4) return; // was a drag/orbit, not a click
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...tableMeshesRef.current.values()], false)[0];
      const tableId = hit ? hit.object.userData.tableId : null;
      setClickedTableId(tableId);
      selectRef.current?.(tableId);
    }
    function onPointerMove(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...tableMeshesRef.current.values()], false)[0];
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
      if (sceneRef.current) sceneRef.current.hoveredTableId = hit ? hit.object.userData.tableId : null;
    }
    function onPointerLeave() {
      if (sceneRef.current) sceneRef.current.hoveredTableId = null;
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    let raf = 0;
    function tick() {
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      if (sceneRef.current) fp3dDeclutterLabels(sceneRef.current);
      raf = requestAnimationFrame(tick);
    }
    tick();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      sceneRef.current.size = { w, h };
    });
    ro.observe(mount);

    sceneRef.current = {
      scene, camera, controls, contentGroup, center,
      labels: [], size: { w: width, h: height }, activeTableId: null, hoveredTableId: null,
      initialCamPos: camera.position.clone(), initialTarget: center.clone()
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(labelRenderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Rebuild the table/object meshes whenever the floor plan data changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.contentGroup.traverse(obj => {
      if (obj.isCSS2DObject) { obj.element.remove(); return; } // CSS2DRenderer never removes stale elements on its own
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => { m.map?.dispose(); m.dispose(); });
      }
    });
    s.contentGroup.clear();
    tableMeshesRef.current = new Map();
    (objects || []).forEach(o => s.contentGroup.add(buildFp3dObjectMesh(o)));
    (tables || []).forEach(t => {
      const mesh = buildFp3dTableMesh(t);
      tableMeshesRef.current.set(t.id, mesh);
      s.contentGroup.add(mesh);
    });
    s.labels = [];
    s.contentGroup.traverse(obj => { if (obj.isCSS2DObject) s.labels.push(obj); });
  }, [tables, objects]);

  // Recolor for the externally-driven (guest search) or locally-clicked
  // selection, and fly the camera to whichever table is focused.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const activeId = focusTableId || clickedTableId;
    s.activeTableId = activeId;
    tableMeshesRef.current.forEach((mesh, id) => {
      const isActive = id === activeId;
      const [sideMat, topMat] = mesh.material;
      topMat.color.set(isActive ? focusColor : FP3D_TABLE_TOP);
      sideMat.color.set(isActive ? focusColor : FP3D_TABLE_SIDE);
    });
    const targetMesh = activeId ? tableMeshesRef.current.get(activeId) : null;
    const target = targetMesh ? targetMesh.position.clone() : s.center;
    const dist = s.camera.position.distanceTo(s.controls.target) || 6;
    const dir = s.camera.position.clone().sub(s.controls.target).normalize();
    const toDist = targetMesh ? Math.min(dist, 5) : dist;
    fp3dAnimateCamera(s, target, target.clone().add(dir.multiplyScalar(toDist)));
  }, [focusTableId, focusColor, clickedTableId]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
});

function fp3dZoomBy(s, factor) {
  if (!s) return;
  const dir = s.camera.position.clone().sub(s.controls.target);
  const dist = clamp(dir.length() * factor, s.controls.minDistance, s.controls.maxDistance);
  s.camera.position.copy(s.controls.target).add(dir.normalize().multiplyScalar(dist));
}

export default FloorPlan3D;
