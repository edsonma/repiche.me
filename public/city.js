// The town around the wall for the 3D view: buildings, streets, trees, sea/sand/parks.
// Input is the compact JSON the server makes from OpenStreetMap (or genericCity() for walls with no place):
//   { b: [[height, [x,z,...], colour?]], r: [[width, [x,z,...]]], a: [[kind, [x,z,...]]], t: [x,z,...] }
// in metres around the wall's place (x east, z south).
//
// Real places: the map is turned and moved so the wall stands about 10 m from the nearest real street, parallel to it,
// with the street in front of you. Only buildings that would sit on the wall itself are left out.
//
// Cost control: everything is merged into a few meshes per 80 m "chunk", so the GPU skips what is off screen.
import * as THREE from '/vendor/three.js';

const CHUNK = 80;
const num = (n) => typeof n === 'number' && Number.isFinite(n);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---- a generic town street for walls without a place (same format as the OSM data) ----
export function genericCity() {
  const r = rng(2011), b = [], rd = [];
  rd.push([9, [-160, 6, 160, 6]], [9, [-160, 96, 160, 96]], [7, [-48, 6, -48, 160]], [7, [62, 6, 62, 160]]);
  for (const [z0, depthMax] of [[13, 22], [37, 24], [103, 22]]) {
    for (let x = -150; x < 150;) {
      const w = 8 + r() * 9, d = 12 + r() * (depthMax - 12), h = 6 + Math.floor(r() * 7) * 3.2;
      if (Math.abs(x + w / 2 + 48) < 9 || Math.abs(x + w / 2 - 62) < 9) { x += 10; continue; } // leave the cross streets open
      b.push([h, [x, z0, x + w, z0, x + w, z0 + d, x, z0 + d]]);
      x += w + (r() < 0.25 ? 4 + r() * 6 : 0.6);
    }
  }
  return { b, r: rd };
}

// 3 m x 3 m facade cell with a window; tinted per building by vertex colours
export function windowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 96, 96);
  g.fillStyle = '#9fb4c4'; g.fillRect(22, 18, 52, 50);
  g.fillStyle = '#6d8296'; g.fillRect(22, 18, 52, 12);
  g.fillStyle = '#e8e8e8'; g.fillRect(22, 66, 52, 5);
  g.strokeStyle = '#d6d6d6'; g.lineWidth = 3; g.strokeRect(21, 17, 54, 52); g.beginPath(); g.moveTo(48, 18); g.lineTo(48, 68); g.stroke();
  return c;
}

// glass curtain wall: mostly glazing with thin mullions and a floor slab line
export function glassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 96, 96); grd.addColorStop(0, '#b9d3e6'); grd.addColorStop(1, '#7ea3bf');
  g.fillStyle = grd; g.fillRect(0, 0, 96, 96);
  g.fillStyle = '#e9eef2'; g.fillRect(0, 0, 96, 6); g.fillRect(0, 0, 3, 96); g.fillRect(48, 0, 2, 96);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(8, 12, 30, 60);
  return c;
}
// small-windowed masonry
export function brickTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 96, 96);
  g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 1;
  for (let y = 0; y < 96; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(96, y); g.stroke(); for (let x = (y / 6) % 2 ? 0 : 8; x < 96; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 6); g.stroke(); } }
  g.fillStyle = '#5d6b78'; g.fillRect(30, 22, 36, 42); g.fillStyle = '#eee'; g.fillRect(28, 64, 40, 4);
  g.strokeStyle = '#ddd'; g.lineWidth = 3; g.strokeRect(29, 21, 38, 44);
  return c;
}

// small shop/amenity sign floating at the door
function labelSprite(text, track) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,20,28,.82)'; g.beginPath(); g.roundRect(2, 6, 252, 52, 14); g.fill();
  g.fillStyle = '#fff'; g.font = '700 28px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let t = text; while (g.measureText(t).width > 236 && t.length > 3) t = t.slice(0, -2);
  g.fillText(t === text ? t : t + '…', 128, 33);
  const tex = track(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })));
  sp.scale.set(5, 1.25, 1);
  return sp;
}

// point inside a ring (x,z pairs)
function inRing(x, z, q) {
  let inside = false;
  for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
    if ((q[i + 1] > z) !== (q[j + 1] > z) && x < ((q[j] - q[i]) * (z - q[i + 1])) / (q[j + 1] - q[i + 1]) + q[i]) inside = !inside;
  }
  return inside;
}

// the nearest real street (wider than a footpath) to the wall's place, as { d, px, pz, ux, uz }
function nearestStreet(roads) {
  let best = null;
  for (const [w, pts] of roads) {
    if (!num(w) || w < 3 || !Array.isArray(pts)) continue;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / len2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px, pz);
      if (!best || d < best.d) { const len = Math.sqrt(len2); best = { d, px, pz, ux: dx / len, uz: dz / len, w }; }
    }
  }
  return best;
}

// Build everything. Returns what the viewer needs: solids/polys for collision, trees, a map transform, counts.
export function buildCity({ city, real, Wm, THICK, scene, track, maxAniso = 4 }) {
  const out = { polys: [], treeSpots: [], buildings: 0, roadSegs: 0, terrain: 0, xf: { a: 1, b: 0, c: 0, d: 1 }, aligned: false };

  // ---- how the map is placed relative to the wall ----
  let M = { a: 1, b: 0, c: 0, d: 1, tx: 0, tz: 16 };
  const st = real ? nearestStreet(city.r || []) : null;
  if (st && st.d < 150) {
    // rotate so the street runs along x; put the wall on the near side (the street is at +z, in front of you)
    let a = st.ux, b = st.uz, c = -st.uz, d = st.ux;            // (x,z) -> (u.x*x + u.z*z, -u.z*x + u.x*z): street direction -> +x
    const sideOfOrigin = c * st.px * -1 + d * st.pz * -1;        // z of the origin relative to the street, after rotation
    if (sideOfOrigin > 0) { a = -a; b = -b; c = -c; d = -d; }   // origin must be on the -z side: turn 180 degrees
    const fx = a * st.px + b * st.pz, fz = c * st.px + d * st.pz; // the nearest street point after rotation
    M = { a, b, c, d, tx: -fx, tz: -fz + 10 };                  // street centre line 10 m in front of the wall
    out.aligned = true;
  } else if (real) {
    // no street nearby: just make the busier half of the map lie in front of the wall
    const heavy = (city.b || []).reduce((n, [, p]) => n + (Array.isArray(p) && p.length > 1 && p[1] > 0 ? 1 : -1), 0);
    const F = heavy < 0 ? -1 : 1; M = { a: F, b: 0, c: 0, d: F, tx: 0, tz: 16 };
  } else {
    const heavy = city.b.reduce((n, [, p]) => n + (p[1] > 0 ? 1 : -1), 0);
    const F = heavy < 0 ? -1 : 1; M = { a: F, b: 0, c: 0, d: F, tx: 0, tz: 16 };
  }
  out.xf = { a: M.a, b: M.b, c: M.c, d: M.d };
  const tf = (pts) => { const o = new Array(pts.length); for (let i = 0; i < pts.length; i += 2) { const x = pts[i], z = pts[i + 1]; o[i] = M.a * x + M.b * z + M.tx; o[i + 1] = M.c * x + M.d * z + M.tz; } return o; };
  const zone = out.aligned
    ? { x0: -Wm / 2 - 2, x1: Wm / 2 + 2, z0: -THICK / 2 - 1.5, z1: 7.5 }
    : { x0: -Wm / 2 - 6, x1: Wm / 2 + 6, z0: -3, z1: 16 };
  const inZone = (x, z) => x > zone.x0 && x < zone.x1 && z > zone.z0 && z < zone.z1;
  const cell = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

  // ---- buildings: real footprints, heights, floors they start at, roofs, colours, materials; one mesh per chunk and material ----
  const pal = [0xd9c8a9, 0xc9b79c, 0xe2d6c1, 0xb9a58a, 0xd4b8a0, 0xcfd2c4, 0xc7a9a0, 0xe6dccb];
  const chunks = new Map();
  const chunkOf = (m, key) => { let c = m.get(key); if (!c) { c = { pos: [], nor: [], col: [], uvs: [] }; m.set(key, c); } return c; };
  const tint = new THREE.Color(), hsl = {};
  const parseColour = (str, into) => { try { into.set(str); into.getHSL(hsl); into.setHSL(hsl.h, Math.min(hsl.s, 0.65), Math.min(0.88, Math.max(0.32, hsl.l))); return true; } catch { return false; } };
  const roofCol = new THREE.Color(), flatRoof = new THREE.Color(0x8c8a85), tiles = new THREE.Color(0xa95a43), wallCol = new THREE.Color();
  const list = (city.b || []).slice(0, 900).filter((e) => num(e[0]) && Array.isArray(e[1]) && e[1].length >= 6 && e[1].length <= 160 && e[1].every(num));
  const entries = list.map(([h, pts, colour, ex]) => ({ h, pts: tf(pts), colour, ex: ex && typeof ex === 'object' ? ex : {} }));
  const parts = entries.filter((e) => e.ex.p).map((e) => { let x = 0, z = 0; for (let i = 0; i < e.pts.length; i += 2) { x += e.pts[i]; z += e.pts[i + 1]; } return [x / (e.pts.length / 2), z / (e.pts.length / 2)]; });
  for (const en of entries) {
    const { h, pts, colour, ex } = en;
    if (!ex.p && parts.some(([px, pz]) => inRing(px, pz, pts))) continue; // the outline is replaced by its 3D parts
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, cx = 0, cz = 0;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); cx += pts[i]; cz += pts[i + 1]; }
    cx /= pts.length / 2; cz /= pts.length / 2;
    if (x1 > zone.x0 && x0 < zone.x1 && z1 > zone.z0 && z0 < zone.z1) continue; // would sit on the wall
    try {
      const y0 = num(ex.mh) ? ex.mh : 0;
      const pitched = ['gabled', 'hipped', 'pyramidal', 'half-hipped'].includes(ex.rs);
      const rh = pitched ? Math.min(num(ex.rh) ? ex.rh : 2.5, Math.max(0.5, (h - y0) * 0.6)) : 0;
      const wallTop = Math.max(y0 + 2, h - rh);
      const sh = new THREE.Shape();
      for (let i = 0; i < pts.length; i += 2) (i ? sh.lineTo : sh.moveTo).call(sh, pts[i], -pts[i + 1]);
      for (const hole of Array.isArray(ex.ho) ? ex.ho : []) {
        if (!Array.isArray(hole) || hole.length < 6 || !hole.every(num)) continue;
        const hp = tf(hole), path = new THREE.Path();
        for (let i = 0; i < hp.length; i += 2) (i ? path.lineTo : path.moveTo).call(path, hp[i], -hp[i + 1]);
        sh.holes.push(path);
      }
      const eg = new THREE.ExtrudeGeometry(sh, { depth: wallTop - y0, bevelEnabled: false });
      eg.rotateX(-Math.PI / 2); eg.translate(0, y0, 0);
      const mat = ex.m === 'glass' || ex.m === 'brick' ? ex.m : 'plain';
      const hasCol = typeof colour === 'string' && parseColour(colour, wallCol);
      if (!hasCol) wallCol.set(mat === 'brick' ? 0xb5694f : mat === 'glass' ? 0xe3edf3 : pal[Math.abs(Math.floor(cx * 7 + cz * 3)) % pal.length]);
      const hasRoofCol = typeof ex.rc === 'string' && parseColour(ex.rc, roofCol);
      const g2 = eg.index ? eg.toNonIndexed() : eg;
      const ch = chunkOf(chunks, `${cell(cx, cz)}|${mat}`);
      const p = g2.attributes.position.array, n = g2.attributes.normal.array, u = g2.attributes.uv.array;
      const topCol = hasRoofCol ? roofCol : (pitched ? tiles : flatRoof);
      for (let i = 0; i < p.length; i++) { ch.pos.push(p[i]); ch.nor.push(n[i]); }
      for (let i = 0; i < p.length / 3; i++) {
        const up = n[i * 3 + 1] > 0.9;                     // flat tops get a plain roof colour and a blank bit of the texture
        const col = up ? topCol : wallCol;
        ch.col.push(col.r, col.g, col.b);
        if (up) ch.uvs.push(0.03, 0.03); else ch.uvs.push(u[i * 2], u[i * 2 + 1]);
      }
      eg.dispose(); if (g2 !== eg) g2.dispose();
      if (pitched) { // roof: pyramid on the footprint centre; a real gable (ridge along the long side) on rectangles
        const T = [], rc2 = hasRoofCol ? roofCol : tiles;
        const apex = (ax, az) => { for (let i = 0; i < pts.length; i += 2) { const j = (i + 2) % pts.length; T.push(pts[i], wallTop, pts[i + 1], pts[j], wallTop, pts[j + 1], ax, wallTop + rh, az); } };
        const rect = pts.length === 8 || (pts.length === 10 && pts[0] === pts[8] && pts[1] === pts[9]);
        if (ex.rs === 'gabled' && rect) {
          const e0 = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]), e1 = Math.hypot(pts[4] - pts[2], pts[5] - pts[3]);
          const P = (i) => [pts[i], pts[i + 1]], q = [P(0), P(2), P(4), P(6)];
          const A = e0 < e1 ? [q[0], q[1], q[2], q[3]] : [q[1], q[2], q[3], q[0]]; // A0-A1 and A2-A3 are the short edges
          // the ridge joins the midpoints of the two short edges
          const R1 = [(A[0][0] + A[1][0]) / 2, (A[0][1] + A[1][1]) / 2], R2 = [(A[2][0] + A[3][0]) / 2, (A[2][1] + A[3][1]) / 2];
          const top = wallTop + rh, ty = wallTop;
          const tri3 = (a, ya, b, yb, c3, yc) => T.push(a[0], ya, a[1], b[0], yb, b[1], c3[0], yc, c3[1]);
          tri3(A[0], ty, A[1], ty, R1, top); tri3(A[2], ty, A[3], ty, R2, top);                                         // gable ends
          tri3(A[1], ty, A[2], ty, R1, top); tri3(A[2], ty, R2, top, R1, top);                                          // long slope 1
          tri3(A[3], ty, A[0], ty, R2, top); tri3(A[0], ty, R1, top, R2, top);                                          // long slope 2
        } else apex(cx, cz);
        if (T.length) {
          const rg = new THREE.BufferGeometry();
          rg.setAttribute('position', new THREE.Float32BufferAttribute(T, 3)); rg.computeVertexNormals();
          const rn = rg.attributes.normal.array;
          for (let i = 0; i < T.length; i++) { ch.pos.push(T[i]); ch.nor.push(rn[i]); }
          for (let i = 0; i < T.length / 3; i++) { ch.col.push(rc2.r, rc2.g, rc2.b); ch.uvs.push(0.03, 0.03); }
          rg.dispose();
        }
      }
      out.polys.push({ pts, x0, x1, z0, z1 });
      out.buildings++;
    } catch { /* a broken footprint: skip it */ }
  }
  if (chunks.size) {
    const mk = (canvasFn, aniso) => { const t = track(new THREE.CanvasTexture(canvasFn())); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 3, 1 / 3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return track(new THREE.MeshLambertMaterial({ vertexColors: true, map: t })); };
    const mats = { plain: mk(windowTexture, maxAniso), glass: mk(glassTexture, maxAniso), brick: mk(brickTexture, maxAniso) };
    for (const [key, ch] of chunks) {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(ch.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(ch.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(ch.uvs, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[key.split('|')[1]] || mats.plain); m.receiveShadow = true; scene.add(m);
    }
  }

  // ---- named shops and amenities from the map, as small signs at the door ----
  if (real && Array.isArray(city.p)) {
    const spots = [];
    for (const e of city.p.slice(0, 60)) {
      if (!Array.isArray(e) || !num(e[0]) || !num(e[1]) || typeof e[2] !== 'string') continue;
      const q = tf([e[0], e[1]]);
      if (inZone(q[0], q[1])) continue;
      spots.push({ x: q[0], z: q[1], name: e[2].slice(0, 28), d: Math.hypot(q[0], q[1]) });
    }
    spots.sort((p1, p2) => p1.d - p2.d);
    for (const s of spots.slice(0, 30)) { const sp = labelSprite(s.name, track); sp.position.set(s.x, 3.4, s.z); scene.add(sp); out.labels = (out.labels || 0) + 1; }
  }

  // ---- terrain from the map: sea, lakes, sand, parks (real places only) ----
  if (real && Array.isArray(city.a)) {
    const tp = [], tc = [];
    const tri = (ax, az, bx, bz, cx, cz, y, c) => { tp.push(ax, y, az, bx, y, bz, cx, y, cz); for (let k = 0; k < 3; k++) tc.push(c.r, c.g, c.b); };
    const WATER = new THREE.Color(0x3f86bf), SAND = new THREE.Color(0xe6d6a2), GREEN = new THREE.Color(0x73a957);
    const Y = { g: 0.006, s: 0.01, w: 0.014 }, COL = { g: GREEN, s: SAND, w: WATER };
    for (let [kind, pts] of city.a.slice(0, 150)) {
      if (!['c', 'w', 's', 'g'].includes(kind) || !Array.isArray(pts) || pts.length < 4 || pts.length > 80 || !pts.every(num)) continue;
      pts = tf(pts);
      if (kind === 'c') {  // the sea is on the right-hand side of a coastline (the transform is a rotation, so that stays true)
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
          if (inZone((ax + bx) / 2, (az + bz) / 2)) continue;
          const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len, D = 700, B = 18;
          tri(ax, az, bx, bz, bx + nx * D, bz + nz * D, Y.w, WATER); tri(ax, az, bx + nx * D, bz + nz * D, ax + nx * D, az + nz * D, Y.w, WATER);
          tri(ax, az, bx, bz, bx - nx * B, bz - nz * B, Y.s, SAND); tri(ax, az, bx - nx * B, bz - nz * B, ax - nx * B, az - nz * B, Y.s, SAND);
        }
        continue;
      }
      let cx = 0, cz = 0; for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cz += pts[i + 1]; }
      if (inZone(cx / (pts.length / 2), cz / (pts.length / 2))) continue;
      try {
        const sh = new THREE.Shape();
        for (let i = 0; i < pts.length; i += 2) (i ? sh.lineTo : sh.moveTo).call(sh, pts[i], -pts[i + 1]);
        const sg = new THREE.ShapeGeometry(sh); sg.rotateX(-Math.PI / 2);
        const ng = sg.index ? sg.toNonIndexed() : sg, p = ng.attributes.position.array;
        for (let i = 0; i + 8 < p.length; i += 9) tri(p[i], p[i + 2], p[i + 3], p[i + 5], p[i + 6], p[i + 8], Y[kind], COL[kind]);
        sg.dispose(); if (ng !== sg) ng.dispose();
      } catch { /* skip a broken polygon */ }
    }
    if (tp.length) {
      const tg = track(new THREE.BufferGeometry());
      tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      tg.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
      tg.computeVertexNormals();
      const tm = new THREE.Mesh(tg, track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
      tm.frustumCulled = false; tm.receiveShadow = true; scene.add(tm);
      out.terrain = tp.length / 9;
    }
  }

  // ---- streets: sidewalk edge, asphalt, dashed centre line (wide streets), footpaths ----
  const SIDE = new THREE.Color(0xbdbab0), ASPH = new THREE.Color(0x45464b), PATH = new THREE.Color(0xc9b99a), LINE = new THREE.Color(0xe9e4c8);
  const rch = new Map();
  for (let [w, pts] of (city.r || []).slice(0, 300)) {
    if (!num(w) || !Array.isArray(pts) || pts.length < 4 || pts.length > 80 || !pts.every(num)) continue;
    pts = tf(pts);
    const half = Math.min(9, Math.max(0.5, w / 2));
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      if (inZone((ax + bx) / 2, (az + bz) / 2) || inZone(ax, az) || inZone(bx, bz)) continue;
      const ch = chunkOf(rch, cell((ax + bx) / 2, (az + bz) / 2)); // reuse the same bucket shape (pos + col)
      const quad = (px, pz, qx, qz, hf, y, c) => {
        const dx = qx - px, dz = qz - pz, len = Math.hypot(dx, dz) || 1, nx = (-dz / len) * hf, nz = (dx / len) * hf;
        ch.pos.push(px + nx, y, pz + nz, qx + nx, y, qz + nz, px - nx, y, pz - nz, qx + nx, y, qz + nz, qx - nx, y, qz - nz, px - nx, y, pz - nz);
        for (let k = 0; k < 6; k++) ch.col.push(c.r, c.g, c.b);
      };
      out.roadSegs++;
      if (w < 3) { quad(ax, az, bx, bz, half, 0.03, PATH); continue; }
      quad(ax, az, bx, bz, half + 1.6, 0.03, SIDE);
      quad(ax, az, bx, bz, half, 0.06, ASPH);
      if (w >= 6) {
        const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let t = 0; t + 2 <= len && t < 400; t += 5) quad(ax + ux * t, az + uz * t, ax + ux * (t + 2), az + uz * (t + 2), 0.1, 0.09, LINE);
      }
    }
  }
  if (rch.size) {
    const rmat = track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    for (const ch of rch.values()) {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(ch.col, 3));
      g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, rmat); m.receiveShadow = true; scene.add(m);
    }
  }

  // ---- real trees (OpenStreetMap natural=tree) ----
  if (real && Array.isArray(city.t)) {
    const t = city.t.slice(0, 800);
    const r = rng(7);
    for (let i = 0; i + 1 < t.length; i += 2) {
      if (!num(t[i]) || !num(t[i + 1])) continue;
      const q = tf([t[i], t[i + 1]]);
      if (inZone(q[0], q[1]) || Math.hypot(q[0], q[1]) > 300) continue;
      out.treeSpots.push({ x: q[0], z: q[1], s: 1.1 + r() * 0.7 });
    }
  }
  return out;
}

// push a circle (the player, radius r) out of a building footprint; mutates and returns p
export function pushOutOfPoly(p, poly, r) {
  if (p.x < poly.x0 - r || p.x > poly.x1 + r || p.z < poly.z0 - r || p.z > poly.z1 + r) return p;
  const q = poly.pts;
  let bd = Infinity, bx = 0, bz = 0, inside = false;
  for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
    const ax = q[j], az = q[j + 1], cx = q[i], cz = q[i + 1];
    if ((az > p.z) !== (cz > p.z) && p.x < ((cx - ax) * (p.z - az)) / (cz - az) + ax) inside = !inside;
    const dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(p.x - px, p.z - pz);
    if (d < bd) { bd = d; bx = px; bz = pz; }
  }
  if (!inside && bd >= r) return p;
  let nx = inside ? bx - p.x : p.x - bx, nz = inside ? bz - p.z : p.z - bz;
  const l = Math.hypot(nx, nz);
  if (l < 1e-6) { nx = 1; nz = 0; } else { nx /= l; nz /= l; }
  p.x = bx + nx * r; p.z = bz + nz * r;
  return p;
}
