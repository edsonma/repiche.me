// 3D viewer (look-only): you stand in front of the wall, first person, Minecraft-ish.
// Loaded on demand (dynamic import) so the normal page never pays for it.
//
// Cost control:
//  - the whole wall (texture + scribbles) is ONE canvas texture on ONE box; no per-scribble geometry
//  - one directional light with one shadow map (1024 on phones, 2048 on desktop)
//  - pixel ratio capped, frames are only rendered when something changed (clouds tick at ~12 fps)
//  - nothing runs while the tab is hidden; everything is disposed on close
import * as THREE from '/vendor/three.js';

const PX_PER_M = 200;       // 200 board px = 1 meter
const MAX_H_PX = 1400;      // tallest part of the board shown in 3D (7 m)
const MIN_H_PX = 700;
const THICK = 0.4;          // wall thickness (m)
const EYE = 1.6;            // eye height (m)
const Z_MIN = THICK / 2 + 1.1, Z_MAX = 9;   // how near / far you can stand (always in front of the wall)
const YAW_MAX = 1.35, PITCH_MAX = 0.9;      // you can look around a bit, never turn your back
const SPEED = 3;            // m/s

// ---------- tiny seeded RNG so textures are the same every time ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- procedural wall textures drawn over the wall color (canvas 2D, no image files) ----------
function paintSurface(ctx, W, H, texture, color) {
  const r = rng(7);
  ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
  const grain = (n, a, light) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = light ? `rgba(255,255,255,${a * r()})` : `rgba(0,0,0,${a * r()})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
  };
  const blotches = (n, rad, a, light) => {
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H, rr = rad * (0.4 + r());
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      const c = light ? '255,255,255' : '0,0,0';
      g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
  };
  if (texture === 'brick') {
    const bh = 40, bw = 120;
    for (let row = 0, y = 0; y < H; row++, y += bh) {
      for (let x = -(row % 2) * bw / 2; x < W; x += bw) {
        const t = r();
        ctx.fillStyle = t < 0.5 ? `rgba(255,255,255,${0.07 * r()})` : `rgba(0,0,0,${0.12 * r()})`;
        ctx.fillRect(x, y, bw, bh);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let row = 0, y = 0; y <= H; row++, y += bh) {
      ctx.moveTo(0, y + 1.5); ctx.lineTo(W, y + 1.5);
      for (let x = -(row % 2) * bw / 2; x < W; x += bw) { ctx.moveTo(x, y); ctx.lineTo(x, y + bh); }
    }
    ctx.stroke(); grain(W * H / 120, 0.35, false);
  } else if (texture === 'concrete') {
    blotches(70, 160, 0.10, false); blotches(60, 140, 0.08, true); grain(W * H / 60, 0.25, false); grain(W * H / 120, 0.2, true);
  } else if (texture === 'wood') {
    for (let x = 0; x < W; x += 150) { ctx.fillStyle = `rgba(0,0,0,${0.05 + 0.1 * r()})`; ctx.fillRect(x, 0, 150, H); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x, 0, 3, H); }
    for (let i = 0; i < W * 0.9; i++) { ctx.fillStyle = `rgba(0,0,0,${0.18 * r()})`; ctx.fillRect(r() * W, r() * H, 1, 20 + r() * 160); }
  } else if (texture === 'paper') {
    grain(W * H / 40, 0.18, false); grain(W * H / 80, 0.25, true); blotches(30, 220, 0.04, false);
  } else if (texture === 'grunge') {
    blotches(90, 220, 0.16, false); blotches(50, 180, 0.10, true); grain(W * H / 50, 0.3, false);
  } else if (texture === 'tiles') {
    const t = 80;
    for (let y = 0; y < H; y += t) for (let x = 0; x < W; x += t) {
      const g = ctx.createLinearGradient(x, y, x + t, y + t);
      g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
      ctx.fillStyle = g; ctx.fillRect(x, y, t, t);
    }
    ctx.strokeStyle = 'rgba(240,240,240,.75)'; ctx.lineWidth = 4; ctx.beginPath();
    for (let x = 0; x <= W; x += t) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += t) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke(); grain(W * H / 200, 0.2, false);
  } else if (texture === 'metal') {
    for (let i = 0; i < H * 3; i++) { ctx.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.12 * r()})` : `rgba(0,0,0,${0.12 * r()})`; ctx.fillRect(0, r() * H, W, 1 + r() * 2); }
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = 0; x <= W; x += 300) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
  }
}

// ---------- scribbles drawn onto the same canvas ----------
function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function paintScribbles(ctx, posts, boardW, boardH) {
  ctx.textBaseline = 'top';
  for (const p of posts) {
    if (p.y > boardH) continue;
    const fs = p.size;
    ctx.font = `${p.bold ? 'bold ' : ''}${fs}px '${p.font}', cursive`;
    const lines = wrapLines(ctx, p.text, boardW);
    const lh = fs * 1.15;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bh = lh * lines.length;
    const left = (p.x / 100) * (boardW - bw);
    ctx.save();
    ctx.translate(left + bw / 2, p.y + bh / 2);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.fillStyle = p.color;
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    lines.forEach((l, i) => ctx.fillText(l, -bw / 2, -bh / 2 + i * lh + (lh - fs) / 2));
    ctx.restore();
  }
}

// ---------- blocky (Minecraft-style) pixel textures for the ground ----------
function pixelTexture(base, vary, size = 16, seed = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), r = rng(seed);
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    const k = (r() - 0.5) * vary;
    x.fillStyle = `rgb(${Math.max(0, Math.min(255, base[0] + k))},${Math.max(0, Math.min(255, base[1] + k * 1.2))},${Math.max(0, Math.min(255, base[2] + k * 0.6))})`;
    x.fillRect(i, j, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  return t;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,220,.9)'); g.addColorStop(0.25, 'rgba(255,230,160,.35)'); g.addColorStop(1, 'rgba(255,220,150,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#fffbe6'; x.fillRect(48, 48, 32, 32); // square sun, like the game
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export async function open3D({ posts, background, wallW, wallH, fonts = [], onClose = () => {} }) {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const boardH = Math.min(MAX_H_PX, Math.max(MIN_H_PX, Math.ceil(wallH)));
  const Wm = wallW / PX_PER_M, Hm = boardH / PX_PER_M;
  const clipped = posts.some((p) => p.y > boardH);

  // ---- overlay ----
  const root = document.createElement('div');
  root.className = 'v3d';
  root.innerHTML = `
    <div class="v3d-msg">Carregando o muro…</div>
    <button class="v3d-close" aria-label="Sair do 3D" title="Sair (Esc)">✕</button>
    <div class="v3d-hint">${isTouch ? 'Arraste para olhar · use os botões para andar' : 'Arraste para olhar · A/D ou ←/→ andam ao longo do muro · W/S ou ↑/↓ chegam perto/longe'}${clipped ? '<br>Mostrando só o topo do muro (primeiros ' + MAX_H_PX + ' px).' : ''}</div>
    <div class="v3d-pad" aria-label="Andar">
      <button data-k="up">▲</button><button data-k="left">◀</button><button data-k="down">▼</button><button data-k="right">▶</button>
    </div>`;
  document.body.appendChild(root);
  const msg = root.querySelector('.v3d-msg');

  // make sure the scribble fonts are ready before drawing them onto the texture
  try { await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(`28px "${f}"`))), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fallback font */ }

  // ---- renderer ----
  const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const HORIZON = 0xbcd6ee;
  scene.fog = new THREE.Fog(HORIZON, 45, 170);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
  camera.rotation.order = 'YXZ';
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // ---- sky: gradient dome + sun glow, blocky clouds ----
  const sunDir = new THREE.Vector3(0.7, 0.62, 0.5).normalize(); // right, ~35 deg up: lights the wall face, visible when you turn right
  const skyGroup = new THREE.Group(); scene.add(skyGroup);
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(300, 24, 16)),
    track(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: sunDir } },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 d; uniform vec3 sun;
        void main(){
          float h = clamp(d.y, 0., 1.);
          vec3 zen = vec3(.16,.40,.82), hor = vec3(.74,.86,.95);
          vec3 c = mix(hor, zen, pow(h, .55));
          float s = max(dot(normalize(d), sun), 0.);
          c += vec3(1.,.88,.62) * (pow(s, 48.) * .55 + pow(s, 6.) * .12);
          gl_FragColor = vec4(c, 1.);
        }`,
    })),
  );
  sky.renderOrder = -2; skyGroup.add(sky);
  const sunSprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(glowTexture()), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })));
  sunSprite.scale.set(60, 60, 1); sunSprite.position.copy(sunDir).multiplyScalar(250); sunSprite.renderOrder = -1; skyGroup.add(sunSprite);

  const CLOUDS = 14, CLOUD_RANGE = 180;
  const cloudMesh = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1, 1, 1)), track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false, toneMapped: false })), CLOUDS * 3);
  const cr = rng(42), cloudData = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  for (let i = 0; i < CLOUDS; i++) {
    const cx = (cr() - 0.5) * CLOUD_RANGE * 2, cy = 55 + cr() * 25, cz = -20 - cr() * 150;
    for (let k = 0; k < 3; k++) cloudData.push({ x: cx + (k - 1) * 9 + (cr() - 0.5) * 4, y: cy + (k === 1 ? 1.5 : 0), z: cz + (cr() - 0.5) * 6, sx: 14 + cr() * 10, sy: 3 + cr() * 2, sz: 8 + cr() * 6 });
  }
  const writeClouds = () => cloudData.forEach((c, i) => { m4.compose(v3.set(c.x, c.y, c.z), q, s3.set(c.sx, c.sy, c.sz)); cloudMesh.setMatrixAt(i, m4); cloudMesh.instanceMatrix.needsUpdate = true; });
  writeClouds(); cloudMesh.frustumCulled = false; scene.add(cloudMesh);

  // ---- lights: one sun (the only shadow caster) + soft sky fill ----
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.4);
  sun.position.copy(sunDir).multiplyScalar(30);
  sun.target.position.set(0, 1, 0);
  sun.castShadow = true;
  const ss = isTouch ? 1024 : 2048;
  sun.shadow.mapSize.set(ss, ss);
  const sc = sun.shadow.camera; sc.left = -Wm / 2 - 6; sc.right = Wm / 2 + 6; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x8a7a55, 1.7));

  // ---- ground: blocky grass + a dirt walkway in front of the wall ----
  const grassTex = track(pixelTexture([92, 150, 58], 38, 16, 3)); grassTex.repeat.set(240, 240);
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(480, 480)), track(new THREE.MeshLambertMaterial({ map: grassTex })));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const dirtTex = track(pixelTexture([134, 96, 62], 30, 16, 9)); dirtTex.repeat.set(Wm + 6, 3);
  const path = new THREE.Mesh(track(new THREE.PlaneGeometry(Wm + 6, 3)), track(new THREE.MeshLambertMaterial({ map: dirtTex })));
  path.rotation.x = -Math.PI / 2; path.position.set(0, 0.01, THICK / 2 + 1.5); path.receiveShadow = true; scene.add(path);

  // ---- the wall: one box, front face = texture + scribbles ----
  const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize);
  const k = Math.min(1, maxTex / Math.max(wallW, boardH));
  const cv = document.createElement('canvas'); cv.width = Math.round(wallW * k); cv.height = Math.round(boardH * k);
  const cx = cv.getContext('2d'); cx.scale(k, k);
  paintSurface(cx, wallW, boardH, background.texture, background.color);
  paintScribbles(cx, posts, wallW, boardH);
  const wallTex = track(new THREE.CanvasTexture(cv));
  wallTex.colorSpace = THREE.SRGBColorSpace; wallTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const side = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(background.color).multiplyScalar(0.7) }));
  const front = track(new THREE.MeshLambertMaterial({ map: wallTex }));
  const wall = new THREE.Mesh(track(new THREE.BoxGeometry(Wm, Hm, THICK)), [side, side, side, side, front, side]);
  wall.position.set(0, Hm / 2, 0); wall.castShadow = true; wall.receiveShadow = true; scene.add(wall);

  // ---- a few blocky trees (their shadows fall across the wall, which sells the sun) ----
  const trunkM = track(new THREE.MeshLambertMaterial({ color: 0x6b4a2b })), leafM = track(new THREE.MeshLambertMaterial({ color: 0x3f8a3a }));
  const trunkG = track(new THREE.BoxGeometry(0.4, 2.4, 0.4)), leafG = track(new THREE.BoxGeometry(2, 1.6, 2)), leafTopG = track(new THREE.BoxGeometry(1.2, 1.0, 1.2));
  const tree = (x, z, s = 1) => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(trunkG, trunkM); t.position.y = 1.2; const l1 = new THREE.Mesh(leafG, leafM); l1.position.y = 3.2; const l2 = new THREE.Mesh(leafTopG, leafM); l2.position.y = 4.4;
    [t, l1, l2].forEach((m) => { m.castShadow = true; g.add(m); });
    g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  };
  tree(-Wm / 2 + 1.2, 5.2, 1.25); tree(Wm / 2 - 2.5, 6.2, 1.5); tree(Wm / 2 + 3, 1.5, 1.1); tree(-Wm / 2 - 3.5, 2.5, 1.2);
  tree(-3, -6, 1.6); tree(4.5, -8, 1.8); tree(-Wm / 2 - 2, -5, 1.4); // behind the wall: only seen over/around it

  // ---- player ----
  const st = { x: 0, z: 7.5, yaw: 0, pitch: 0.05 };
  camera.position.set(st.x, EYE, st.z);
  const keys = new Set();
  let dirty = true, running = true, raf = 0, last = performance.now(), cloudAcc = 0;
  const resize = () => {
    const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
  };
  resize();
  const onKey = (e, down) => {
    const k2 = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' }[e.key.toLowerCase()];
    if (e.key === 'Escape' && down) { close(); return; }
    if (k2) { e.preventDefault(); down ? keys.add(k2) : keys.delete(k2); }
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  window.addEventListener('resize', resize);
  const onVis = () => { last = performance.now(); dirty = true; };
  document.addEventListener('visibilitychange', onVis);

  // look around by dragging (mouse or finger)
  let drag = null;
  const cvs = renderer.domElement;
  cvs.style.touchAction = 'none';
  cvs.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    st.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, st.yaw + (e.clientX - drag.x) * 0.0045));
    st.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, st.pitch + (e.clientY - drag.y) * 0.0035));
    drag.x = e.clientX; drag.y = e.clientY; dirty = true;
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  cvs.addEventListener('pointerup', endDrag); cvs.addEventListener('pointercancel', endDrag);
  cvs.addEventListener('wheel', (e) => { e.preventDefault(); move(0, -e.deltaY * 0.004); }, { passive: false });

  // on-screen pad (hold to walk)
  root.querySelectorAll('.v3d-pad button').forEach((b) => {
    const key = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(key); });
    const up = () => keys.delete(key);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });
  root.querySelector('.v3d-close').addEventListener('click', () => close());

  // move relative to where you look, then keep you in front of the wall and inside its ends
  function move(strafe, fwd) {
    const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
    st.x += strafe * cy + fwd * -sy;
    st.z += strafe * -sy + fwd * -cy;
    st.x = Math.max(-Wm / 2 - 0.4, Math.min(Wm / 2 + 0.4, st.x));
    st.z = Math.max(Z_MIN, Math.min(Z_MAX, st.z));
    dirty = true;
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const sx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const fz = (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0);
    if (sx || fz) move(sx * SPEED * dt, fz * SPEED * dt);
    cloudAcc += dt;
    if (cloudAcc > 1 / 12) { // clouds drift slowly; ~12 fps is plenty
      for (const c of cloudData) { c.x += cloudAcc * 1.2; if (c.x > CLOUD_RANGE + 30) c.x -= CLOUD_RANGE * 2 + 60; }
      writeClouds(); cloudAcc = 0; dirty = true;
    }
    if (!dirty) return;
    camera.position.set(st.x, EYE + Math.sin(now / 260) * (sx || fz ? 0.025 : 0), st.z);
    camera.rotation.set(st.pitch, st.yaw, 0);
    skyGroup.position.copy(camera.position);
    renderer.render(scene, camera);
    dirty = false;
    if (msg) { msg.remove(); }
  }
  raf = requestAnimationFrame(frame);

  function close() {
    if (!running) return;
    running = false; cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
    window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis);
    disposables.forEach((d) => d.dispose && d.dispose());
    cloudMesh.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    root.remove(); onClose();
  }
  return { close };
}
