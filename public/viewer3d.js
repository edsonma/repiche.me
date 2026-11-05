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
const Z_MIN = THICK / 2 + 1.1, Z_MAX = 13;  // how near / far you can stand (always in front of the wall)
const PITCH_MAX = 1.5;                       // free look like Minecraft; only walking is limited
const SEG_PX = 3360;                         // the wall is built from segments so each texture stays sharp
const SPEED = 3;            // m/s

// ---------- tiny seeded RNG so textures are the same every time ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- procedural wall textures drawn over the wall color (canvas 2D, no image files) ----------
function paintSurface(ctx, W, H, texture, color, seed = 7) {
  const r = rng(seed);
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
function paintScribbles(ctx, posts, boardW, boardH, x0 = -1e9, x1 = 1e9, opacity = () => 1) {
  ctx.textBaseline = 'top';
  for (const p of posts) {
    if (p.y > boardH) continue;
    const fs = p.size;
    ctx.font = `${p.bold ? 'bold ' : ''}${fs}px '${p.font}', cursive`;
    const lines = wrapLines(ctx, p.text, boardW);
    const lh = fs * 1.15;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bh = lh * lines.length + (p.sig ? 18 : 0);
    const left = (p.x / 100) * (boardW - bw);
    if (left + bw + fs < x0 || left - fs > x1) continue; // not on this segment
    ctx.save();
    ctx.translate(left + bw / 2, p.y + bh / 2);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.globalAlpha = opacity(p); // fading (anonymous) scribbles are fainter
    ctx.fillStyle = p.color;
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    lines.forEach((l, i) => ctx.fillText(l, -bw / 2, -bh / 2 + i * lh + (lh - fs) / 2));
    if (p.sig) { ctx.font = "600 14px system-ui, sans-serif"; ctx.fillText('— ' + p.sig, -bw / 2, -bh / 2 + lines.length * lh + 4); }
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

// ---------- the lost visitor's conversation ----------
const QUESTION = 'Onde está a galera original do piche.me? Procurei o dia todo e não achei ninguém…';
const ANSWERS = [
  { t: 'Brigaram.', r: 'Brigaram?! Não encontrei registro nenhum disso… 😅 Mas olha só quem fez parte:' },
  { t: 'Cada um foi resolver sua vida.', r: 'Pode ser! A vida adulta chega pra todo mundo. Olha só quem fez parte:' },
  { t: 'Moram juntos.', r: 'Moram juntos?! Que república seria essa! 😂 Também não achei nada disso. Olha a galera:' },
  { t: 'Nenhuma das anteriores.', r: 'Hm… então o mistério continua. Mas pelo menos sei quem eram:' },
];
// Only what the sources say: Correio Braziliense (2011) and the deriva~telar article (FAU-USP).
// The other four are named as part of the original team; no role is known, so none is invented.
const MEMBERS = [
  { name: 'Túlio Ornelas', role: 'Engenheiro de software e um dos fundadores', note: 'A ideia surgiu ao assistir a um documentário sobre a queda do Muro de Berlim.', src: 'Correio Braziliense, 2011' },
  { name: 'Wesley Rocha', role: 'Designer de interfaces', note: 'Falou ao jornal sobre os planos de ampliar os recursos de rede social do site.', src: 'Correio Braziliense, 2011' },
  { name: 'Renan', role: 'Integrante da equipe original', note: 'Cargo não informado nas fontes consultadas.', src: 'Equipe do piche.me' },
  { name: 'Karina Macedo', role: 'Integrante da equipe original', note: 'Cargo não informado nas fontes consultadas.', src: 'Equipe do piche.me' },
  { name: 'Rodrigo Ramalho', role: 'Integrante da equipe original', note: 'Cargo não informado nas fontes consultadas.', src: 'Equipe do piche.me' },
  { name: 'Celio Latorraca', role: 'Integrante da equipe original', note: 'Cargo não informado nas fontes consultadas.', src: 'Equipe do piche.me' },
];
const FACTS = 'Criado em 2011 por um grupo de amigos de Brasília, num único fim de semana. Segundo os perfis de LinkedIn dos criadores, o site saiu do ar em 2015. Não há fonte pública dizendo onde cada um está hoje.';
const REFS = [
  ['Correio Braziliense (2011)', 'https://www.correiobraziliense.com.br/app/noticia/tecnologia/2011/07/01/interna_tecnologia,259239/site-permite-que-internautas-deixem-mensagem-em-muros-vira-febre-na-rede.shtml'],
  ['deriva~telar, FAU-USP', 'https://deriva-telar.fau.usp.br/piche-me/'],
  ['piche.me em 26/10/2011 (Web Archive)', 'http://web.archive.org/web/20111026051021/http://piche.me/'],
];
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- happy background music ----------
// An original little tune synthesized live with the Web Audio API: no audio files, no samples and no
// existing song, so there is nothing to license. C major, 118 bpm, 8-bar loop (square lead, triangle
// arpeggio + bass, soft drums).
export function createMusic() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const STEP = 60 / 118 / 2; // one eighth note
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const BARS = [ // bass root + chord tones (C G Am F C G F G)
    { r: 48, t: [60, 64, 67] }, { r: 43, t: [59, 62, 67] }, { r: 45, t: [57, 60, 64] }, { r: 41, t: [60, 65, 69] },
    { r: 48, t: [60, 64, 67] }, { r: 43, t: [59, 62, 67] }, { r: 41, t: [60, 65, 69] }, { r: 43, t: [59, 62, 67] },
  ];
  const N = null;
  const MELODY = [
    76, N, 79, 76, 72, N, 74, 76,   79, N, 74, N, 71, 74, 79, N,
    81, N, 76, 81, 84, N, 81, 76,   77, N, 81, 77, 72, N, 77, N,
    76, 76, 79, N, 84, N, 79, 76,   74, N, 79, 74, 71, N, 67, N,
    77, N, 81, N, 84, 81, 77, 72,   79, N, 74, 76, 79, N, N, N,
  ];
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const env = (g, t, vol, dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
  function tone(type, midi, t, dur, vol, cutoff = 4000) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type; o.frequency.value = hz(midi); f.type = 'lowpass'; f.frequency.value = cutoff;
    env(g, t, vol, dur); o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function hit(t, dur, vol, type, freq) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
    env(g, t, vol, dur); src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.05);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 0.5, 0.18); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
  }
  function schedule(i, t) {
    const bar = (i >> 3) % 8, s = i & 7, c = BARS[bar];
    const m = MELODY[bar * 8 + s];
    if (m != null) tone('square', m, t, STEP * (MELODY[(bar * 8 + s + 1) % 64] == null ? 1.8 : 0.9), 0.06, 3200);
    tone('triangle', c.t[[0, 1, 2, 1, 0, 1, 2, 1][s]], t, STEP * 0.9, 0.06);
    if (s === 0 || s === 4) tone('triangle', c.r, t, STEP * 1.9, 0.2, 900);
    if (s === 2 || s === 6) tone('triangle', c.r + 7, t, STEP * 0.9, 0.12, 900);
    if (s === 0 || s === 4) kick(t);
    if (s === 2 || s === 6) hit(t, 0.1, 0.09, 'bandpass', 1800);
    if (s & 1) hit(t, 0.03, 0.035, 'highpass', 7000);
  }
  let timer = null, next = 0, idx = 0, muted = false;
  const tick = () => { while (next < ctx.currentTime + 0.35) { schedule(idx, next); next += STEP; idx++; } };
  const level = () => master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return {
    start() { ctx.resume(); if (!timer) { next = ctx.currentTime + 0.1; idx = 0; tick(); timer = setInterval(tick, 100); } level(); },
    resume() { if (ctx.state !== 'running') ctx.resume(); },
    pause() { ctx.suspend(); },
    setMuted(m) { muted = m; level(); },
    stop() { clearInterval(timer); timer = null; ctx.close(); },
  };
}

export async function open3D({ posts, background, wallW, wallH, fonts = [], opacity = () => 1, onClose = () => {} }) {
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
    <button class="v3d-talk" hidden>💬 Falar com ele${isTouch ? '' : ' <kbd>E</kbd>'}</button>
    <div class="v3d-bubble" hidden></div>
    <div class="v3d-cardwrap" hidden></div>
    <button class="v3d-music" aria-label="Música" title="Música ligada/desligada">🔊</button>
    <div class="v3d-hint">${isTouch ? 'Círculo à esquerda: andar · arraste à direita: olhar' : '<b>Clique</b> para capturar o mouse · WASD anda · Espaço pula · Shift corre · Esc solta o mouse (Esc de novo sai)'}${clipped ? '<br>Mostrando só o topo do muro (primeiros ' + MAX_H_PX + ' px).' : ''}</div>
    ${isTouch ? '<div class="v3d-joy" aria-label="Andar"><div class="knob"></div></div><button class="v3d-jump" aria-label="Pular">⤒</button>' : ''}`;
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
  const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 80;
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

  // ---- the wall: a row of boxes (segments), each with its own canvas texture on the front ----
  const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize);
  const kTex = Math.min(0.75, maxTex / Math.max(SEG_PX, boardH)); // 0.75 keeps memory low and still looks crisp
  const side = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(background.color).multiplyScalar(0.7) }));
  const segCount = Math.ceil(wallW / SEG_PX);
  for (let i = 0; i < segCount; i++) {
    const x0 = i * SEG_PX, sw = Math.min(SEG_PX, wallW - x0);
    const cv = document.createElement('canvas'); cv.width = Math.round(sw * kTex); cv.height = Math.round(boardH * kTex);
    const g2 = cv.getContext('2d'); g2.scale(kTex, kTex);
    paintSurface(g2, sw, boardH, background.texture, background.color, 7 + i);
    g2.save(); g2.translate(-x0, 0); paintScribbles(g2, posts, wallW, boardH, x0, x0 + sw, opacity); g2.restore();
    const tex = track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const front = track(new THREE.MeshLambertMaterial({ map: tex }));
    const seg = new THREE.Mesh(track(new THREE.BoxGeometry(sw / PX_PER_M, Hm, THICK)), [side, side, side, side, front, side]);
    seg.position.set(-Wm / 2 + (x0 + sw / 2) / PX_PER_M, Hm / 2, 0); seg.castShadow = true; seg.receiveShadow = true; scene.add(seg);
  }

  // ---- blocky trees, instanced (3 draw calls for all of them); their shadows fall across the wall ----
  const blockers = []; // circles you can't walk through: { x, z, r }
  const treeSpots = [];
  const tr = rng(99);
  const NPC_X = 2.2, NPC_Z = 3.6;
  for (let x = -Wm / 2 + 2; x < Wm / 2; x += 5 + tr() * 7) { // in front of the wall
    const z = 4.5 + tr() * 6, s2 = 1.1 + tr() * 0.6;
    if (Math.hypot(x - NPC_X, z - NPC_Z) > 3 && Math.hypot(x, z - 7.5) > 2.5) treeSpots.push({ x, z, s: s2 });
  }
  for (let x = -Wm / 2 - 4; x < Wm / 2 + 4; x += 4 + tr() * 6) treeSpots.push({ x, z: -(4 + tr() * 14), s: 1.3 + tr() * 0.7 }); // behind (seen over the wall)
  const trunkM = track(new THREE.MeshLambertMaterial({ color: 0x6b4a2b })), leafM = track(new THREE.MeshLambertMaterial({ color: 0x3f8a3a }));
  const trunks = new THREE.InstancedMesh(track(new THREE.BoxGeometry(0.4, 2.4, 0.4)), trunkM, treeSpots.length);
  const leaves = new THREE.InstancedMesh(track(new THREE.BoxGeometry(2, 1.6, 2)), leafM, treeSpots.length);
  const tops = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1.2, 1, 1.2)), leafM, treeSpots.length);
  treeSpots.forEach((t, i) => {
    const put = (mesh, y) => { m4.compose(v3.set(t.x, y * t.s, t.z), q, s3.set(t.s, t.s, t.s)); mesh.setMatrixAt(i, m4); };
    put(trunks, 1.2); put(leaves, 3.2); put(tops, 4.4);
    if (t.z > 0) blockers.push({ x: t.x, z: t.z, r: 1.1 * t.s });
  });
  [trunks, leaves, tops].forEach((m) => { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; scene.add(m); });

  // ---- the lost visitor: a blocky character looking around for everyone ----
  const npc = (() => {
    const grp = new THREE.Group();
    const mat = (c) => track(new THREE.MeshLambertMaterial({ color: c }));
    const skin = mat(0xe3b08a), suit = mat(0x1d1d2b), shirt = mat(0xf0f0f0), hair = mat(0x2b1d14), pants = mat(0x15151f), white = mat(0xffffff), dark = mat(0x111111);
    const box = (w, h, d, m, x, y, z, parent = grp) => { const b = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), m); b.position.set(x, y, z); b.castShadow = true; parent.add(b); return b; };
    box(0.22, 0.75, 0.24, pants, -0.13, 0.375, 0); box(0.22, 0.75, 0.24, pants, 0.13, 0.375, 0); // legs
    box(0.52, 0.72, 0.3, suit, 0, 1.11, 0); box(0.18, 0.5, 0.02, shirt, 0, 1.2, 0.16);              // torso + shirt front
    const head = new THREE.Group(); head.position.set(0, 1.47, 0); grp.add(head);
    box(0.42, 0.42, 0.42, skin, 0, 0.21, 0, head); box(0.44, 0.14, 0.44, hair, 0, 0.46, -0.01, head); // head + hair
    box(0.11, 0.09, 0.02, white, -0.1, 0.25, 0.215, head); box(0.11, 0.09, 0.02, white, 0.1, 0.25, 0.215, head);
    box(0.05, 0.07, 0.02, dark, -0.1, 0.25, 0.225, head); box(0.05, 0.07, 0.02, dark, 0.1, 0.25, 0.225, head);
    box(0.14, 0.04, 0.02, dark, 0, 0.09, 0.215, head);
    const mkArm = (sx) => { const a = new THREE.Group(); a.position.set(sx * 0.35, 1.42, 0); grp.add(a); box(0.14, 0.62, 0.14, suit, 0, -0.3, 0, a); box(0.12, 0.12, 0.12, skin, 0, -0.66, 0, a); return a; };
    const armL = mkArm(-1), armR = mkArm(1);
    // the question mark above his head
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g3 = c.getContext('2d'); g3.font = 'bold 120px "Arial Black", Arial, sans-serif'; g3.textAlign = 'center'; g3.textBaseline = 'middle';
    g3.lineWidth = 14; g3.strokeStyle = '#000'; g3.strokeText('?', 64, 70); g3.fillStyle = '#ffd400'; g3.fillText('?', 64, 70);
    const qTex = track(new THREE.CanvasTexture(c)); qTex.colorSpace = THREE.SRGBColorSpace;
    const q2 = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: qTex, transparent: true })));
    q2.scale.set(0.75, 0.75, 1); q2.position.set(0, 2.45, 0); grp.add(q2);
    grp.position.set(NPC_X, 0, NPC_Z); scene.add(grp);
    blockers.push({ x: NPC_X, z: NPC_Z, r: 0.6 });
    return {
      update(t, talking = false, px = 0, pz = 0) { // looks left and right (can't find anyone), shrugs, the ? bobs
        if (talking) { // turns to you and waves his arms while you talk
          grp.rotation.y = Math.atan2(px - NPC_X, pz - NPC_Z); head.rotation.y = 0; head.rotation.x = 0.08;
          armL.rotation.z = 0.9 + Math.sin(t * 6) * 0.25; armR.rotation.z = -0.9 - Math.sin(t * 6 + 1) * 0.25;
          q2.position.y = 2.45 + Math.sin(t * 3) * 0.08; return;
        }
        head.rotation.y = Math.sin(t * 1.25) * 1.05; head.rotation.x = Math.sin(t * 0.6) * 0.12;
        grp.rotation.y = Math.sin(t * 0.45) * 0.5;
        armL.rotation.z = 0.55 + Math.max(0, Math.sin(t * 1.25)) * 0.5; armR.rotation.z = -0.55 - Math.max(0, -Math.sin(t * 1.25)) * 0.5;
        q2.position.y = 2.45 + Math.sin(t * 3) * 0.08;
      },
    };
  })();

  // ---- player ----
  const st = { x: 0, z: 7.5, yaw: 0, pitch: 0.05, h: 0, vy: 0 };
  camera.position.set(st.x, EYE, st.z);
  const keys = new Set();
  let dirty = true, running = true, raf = 0, last = performance.now(), cloudAcc = 0;
  const resize = () => {
    const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
  };
  resize();
  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'sprint', ' ': 'jump' };
  let locked = false;
  const onKey = (e, down) => {
    if (e.key === 'Escape') { // while the mouse is captured, Esc just releases it; an open conversation closes first
      if (down) { if (talk) closeTalk(); else if (!locked) close(); }
      return;
    }
    if (down && talk === 'ask' && /^[1-4]$/.test(e.key)) { answer(Number(e.key) - 1); return; }
    if (down && !talk && nearNpc && e.key.toLowerCase() === 'e') { e.preventDefault(); openTalk(); return; }
    const k2 = KEYMAP[e.key.toLowerCase()];
    if (k2) { e.preventDefault(); down ? keys.add(k2) : keys.delete(k2); }
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);
  const onVis = () => { last = performance.now(); dirty = true; keys.clear(); if (music) document.hidden ? music.pause() : music.resume(); };
  document.addEventListener('visibilitychange', onVis);

  // Mouse (desktop): click to capture it, then it looks around freely, like Minecraft.
  // Finger (phone) or a browser without pointer lock: drag to look.
  const cvs = renderer.domElement;
  cvs.style.touchAction = 'none';
  const onLockChange = () => { locked = document.pointerLockElement === cvs; root.classList.toggle('locked', locked); dirty = true; };
  const onMouse = (e) => {
    if (!locked) return;
    st.yaw -= e.movementX * 0.0022;
    st.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, st.pitch - e.movementY * 0.0022));
    dirty = true;
  };
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('mousemove', onMouse);
  let drag = null;
  cvs.addEventListener('pointerdown', (e) => {
    if (talk) return;
    if (e.pointerType === 'mouse' && cvs.requestPointerLock) { try { cvs.requestPointerLock(); } catch { /* ignore */ } return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // like Minecraft: drag right = look right, drag up = look up
    st.yaw -= (e.clientX - drag.x) * 0.005;
    st.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, st.pitch - (e.clientY - drag.y) * 0.005));
    drag.x = e.clientX; drag.y = e.clientY; dirty = true;
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  cvs.addEventListener('pointerup', endDrag); cvs.addEventListener('pointercancel', endDrag);

  // left thumb: circular joystick (like Minecraft on phones). Analog: push further = walk faster; edge = run.
  const joy = { x: 0, y: 0, mag: 0 };
  const joyEl = root.querySelector('.v3d-joy');
  if (joyEl) {
    const knob = joyEl.querySelector('.knob'), R = 46;
    let id = null, cx0 = 0, cy0 = 0;
    const setVec = (e) => {
      let dx = e.clientX - cx0, dy = e.clientY - cy0; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      if (d / R < 0.15) { joy.x = joy.y = joy.mag = 0; } else { joy.x = dx / R; joy.y = -dy / R; joy.mag = Math.hypot(joy.x, joy.y); }
    };
    const reset = (e) => { if (e.pointerId !== id) return; id = null; joy.x = joy.y = joy.mag = 0; knob.style.transform = ''; };
    joyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault(); id = e.pointerId; joyEl.setPointerCapture(id);
      const r = joyEl.getBoundingClientRect(); cx0 = r.left + r.width / 2; cy0 = r.top + r.height / 2; setVec(e);
    });
    joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === id) setVec(e); });
    joyEl.addEventListener('pointerup', reset); joyEl.addEventListener('pointercancel', reset);
  }
  const jumpEl = root.querySelector('.v3d-jump');
  if (jumpEl) {
    jumpEl.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpEl.setPointerCapture(e.pointerId); keys.add('jump'); });
    const up = () => keys.delete('jump');
    jumpEl.addEventListener('pointerup', up); jumpEl.addEventListener('pointercancel', up);
  }

  // music (original, synthesized): starts with the view, can be muted; the choice is remembered
  const music = createMusic();
  const musicBtn = root.querySelector('.v3d-music');
  let musicOn = true;
  try { musicOn = localStorage.getItem('repiche.3d.music') !== '0'; } catch { /* storage unavailable */ }
  const paintMusicBtn = () => { musicBtn.textContent = musicOn ? '🔊' : '🔇'; };
  paintMusicBtn();
  if (!music) musicBtn.hidden = true;
  else {
    music.setMuted(!musicOn); music.start();
    musicBtn.addEventListener('click', () => {
      musicOn = !musicOn; music.setMuted(!musicOn); music.resume(); paintMusicBtn();
      try { localStorage.setItem('repiche.3d.music', musicOn ? '1' : '0'); } catch { /* ignore */ }
    });
    root.addEventListener('pointerdown', () => music.resume()); // iOS only starts audio inside a touch
  }
  // ---- talking to the lost visitor ----
  let talk = null;      // null | 'ask' (speech bubble) | 'card' (the big window)
  let nearNpc = false;
  const talkBtn = root.querySelector('.v3d-talk'), bubble = root.querySelector('.v3d-bubble'), cardWrap = root.querySelector('.v3d-cardwrap');
  function openTalk() {
    if (talk) return;
    talk = 'ask'; keys.clear(); joy.x = joy.y = joy.mag = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    bubble.innerHTML = `<p class="who">Visitante perdido</p><p class="q">${esc(QUESTION)}</p>` +
      ANSWERS.map((a, i) => `<button type="button" data-i="${i}"><b>${i + 1}</b> ${esc(a.t)}</button>`).join('');
    bubble.hidden = false; talkBtn.hidden = true; dirty = true;
  }
  function answer(i) {
    if (talk !== 'ask') return;
    talk = 'card'; bubble.hidden = true;
    cardWrap.innerHTML = `<div class="v3d-card" role="dialog" aria-label="A galera do piche.me">
      <p class="react">“${esc(ANSWERS[i].r)}”</p>
      <h2>A galera do piche.me</h2>
      <div class="members">${MEMBERS.map((m) => `<div class="member"><b>${esc(m.name)}</b><span class="role">${esc(m.role)}</span><span class="note">${esc(m.note)}</span><span class="src">Fonte: ${esc(m.src)}</span></div>`).join('')}</div>
      <p class="facts">${esc(FACTS)}</p>
      <p class="refs">${REFS.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`).join(' · ')}</p>
      <button type="button" class="closecard">Fechar</button></div>`;
    cardWrap.hidden = false; dirty = true;
  }
  function closeTalk() { talk = null; bubble.hidden = true; cardWrap.hidden = true; talkBtn.hidden = !nearNpc; dirty = true; }
  talkBtn.addEventListener('click', openTalk);
  bubble.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) answer(Number(b.dataset.i)); });
  cardWrap.addEventListener('click', (e) => { if (e.target === cardWrap || e.target.closest('.closecard')) closeTalk(); });

  root.querySelector('.v3d-close').addEventListener('click', () => { if (document.pointerLockElement) document.exitPointerLock(); close(); });

  // walk relative to where you look. You can look anywhere, but can't leave the front of the wall,
  // go past its ends, or walk through trees / the lost guy.
  function move(strafe, fwd) {
    const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
    st.x += strafe * cy + fwd * -sy;
    st.z += strafe * -sy + fwd * -cy;
    st.x = Math.max(-Wm / 2 - 0.4, Math.min(Wm / 2 + 0.4, st.x));
    st.z = Math.max(Z_MIN, Math.min(Z_MAX, st.z));
    for (const b of blockers) {
      const dx = st.x - b.x, dz = st.z - b.z, d = Math.hypot(dx, dz), min = b.r + 0.3;
      if (d < min && d > 1e-4) { st.x = b.x + (dx / d) * min; st.z = b.z + (dz / d) * min; }
    }
    dirty = true;
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    let sx = talk ? 0 : (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0) + joy.x; // standing still while talking
    let fz = talk ? 0 : (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0) + joy.y;
    const nn = Math.hypot(sx, fz); if (nn > 1) { sx /= nn; fz /= nn; } // never faster diagonally
    const spd = SPEED * (keys.has('sprint') || joy.mag > 0.92 ? 1.8 : 1);
    if (sx || fz) move(sx * spd * dt, fz * spd * dt);
    // Minecraft-style jump (Space)
    if (keys.has('jump') && st.h === 0) st.vy = 5;
    if (st.h > 0 || st.vy > 0) { st.vy -= 16 * dt; st.h = Math.max(0, st.h + st.vy * dt); if (st.h === 0) st.vy = 0; dirty = true; }
    cloudAcc += dt;
    if (cloudAcc > 1 / 15) { // clouds drift and the guy looks around; ~15 fps is plenty
      npc.update(now / 1000, !!talk, st.x, st.z);
      for (const c of cloudData) { c.x += cloudAcc * 1.2; if (c.x > CLOUD_RANGE + 30) c.x -= CLOUD_RANGE * 2 + 60; }
      writeClouds(); cloudAcc = 0; dirty = true;
    }
    if (!dirty) return;
    camera.position.set(st.x, EYE + st.h + (st.h === 0 ? Math.sin(now / 260) * (sx || fz ? 0.025 : 0) : 0), st.z);
    // keep the (small, sharp) shadow window centered on the player, snapped so shadows don't shimmer
    const snap = Math.round(st.x / 2) * 2;
    sun.position.set(snap + sunDir.x * 30, sunDir.y * 30, sunDir.z * 30); sun.target.position.set(snap, 1, 0); sun.target.updateMatrixWorld();
    camera.rotation.set(st.pitch, st.yaw, 0);
    skyGroup.position.copy(camera.position);
    const near = Math.hypot(st.x - NPC_X, st.z - NPC_Z) < 3.4; // close enough to chat
    if (near !== nearNpc) { nearNpc = near; talkBtn.hidden = !near || !!talk; }
    root.dataset.view = [st.x, st.z, st.yaw, st.pitch].map((v) => v.toFixed(3)).join(','); // read by the tests
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
    document.removeEventListener('pointerlockchange', onLockChange); document.removeEventListener('mousemove', onMouse);
    if (document.pointerLockElement) document.exitPointerLock();
    disposables.forEach((d) => d.dispose && d.dispose());
    if (music) music.stop();
    cloudMesh.dispose(); trunks.dispose(); leaves.dispose(); tops.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    root.remove(); onClose();
  }
  return { close };
}
