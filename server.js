const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
// On Railway, attach a Volume: RAILWAY_VOLUME_MOUNT_PATH is set automatically.
// Without a volume the filesystem is ephemeral and walls vanish on every deploy.
const DATA_DIR =
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
// Optional "photo of the place" for a wall's surface, from Mapillary (open street-level photos, CC BY-SA 4.0).
// Needs a free client token (MAPILLARY_TOKEN). Without it the option simply does not appear.
// MAPILLARY_API / MAPILLARY_HOSTS exist so tests can point at a fake upstream.
const MAPILLARY_TOKEN = process.env.MAPILLARY_TOKEN || '';
const MAPILLARY_API = process.env.MAPILLARY_API || 'https://graph.mapillary.com';
const MAPILLARY_HOSTS = (process.env.MAPILLARY_HOSTS || 'fbcdn.net,mapillary.com').split(',');
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
// Optional "street scene" of the place: buildings and roads from OpenStreetMap (Overpass API), kept as a small
// JSON on our disk and drawn in the 3D view. OSM has no photos; this is a rebuilt 3D map, not a camera image.
const SCENE_DIR = path.join(DATA_DIR, 'scenes');
const OVERPASS_API = process.env.OVERPASS_API || 'https://overpass-api.de/api/interpreter';
const SCENE_HALF_M = 300;      // metres around the (rounded) place
const SCENE_VERSION = 3; // bump when the scene data gains something new: older stored scenes are rebuilt on next use
const SCENE_WAIT_MS = Number(process.env.SCENE_WAIT_MS) || 3000;
const MAX_AREAS = 150, MAX_BUILDINGS = 900, MAX_ROADS = 300, MAX_TREES = 800, MAX_PTS = 40;

// ---- Limits / whitelists -------------------------------------------------
const MAX_TEXT = 140;
const MAX_POSTS_PER_WALL = 2000;
// Board width in px (must match what the client draws). x of a scribble is a % of the free width.
const WALL_W = 10080; // 50 m in the 3D view (200 px = 1 m); a multiple of 3360 so 3D wall segments line up
const MAX_Y = 20000;
// Life of scribbles: anonymous ones fade and vanish after ANON_TTL (+1 day per "apoiar", up to 30);
// signed ones (a claimed signature) are permanent. ANON_TTL_MS exists so tests don't wait a week.
const DAY = 24 * 3600 * 1000;
const ANON_TTL = Number(process.env.ANON_TTL_MS) > 0 ? Number(process.env.ANON_TTL_MS) : 7 * DAY;
const SUPPORT_BONUS = Number(process.env.SUPPORT_BONUS_MS) > 0 ? Number(process.env.SUPPORT_BONUS_MS) : DAY;
const MAX_SUPPORT = 30;
const MAX_NICKS = 20000;
const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u;
const RESERVED_NICKS = new Set(['admin', 'administrador', 'moderador', 'repiche', 'repiche.me', 'piche', 'piche.me', 'sistema']); // px from the top of the wall; x is 0-100 (% of the free width)
const FONTS = [
  'Permanent Marker', 'Rock Salt', 'Special Elite', 'Londrina Solid',
  'Pacifico', 'Bangers', 'Caveat', 'Creepster', 'Fredericka the Great',
  'Press Start 2P', 'Shadows Into Light', 'Indie Flower',
];
// A wall background is { color: '#rrggbb', texture: <id> }; textures are drawn client-side over the color.
const TEXTURES = [
  { id: 'none', label: 'lisa' },
  { id: 'brick', label: 'tijolo' },
  { id: 'concrete', label: 'concreto' },
  { id: 'wood', label: 'madeira' },
  { id: 'paper', label: 'papel' },
  { id: 'grunge', label: 'grunge' },
  { id: 'tiles', label: 'azulejo' },
  { id: 'metal', label: 'metal' },
];
const TEXTURE_IDS = TEXTURES.map((t) => t.id);
const PRESETS = {
  brick: { color: '#8b3a2b', texture: 'brick' },
  concrete: { color: '#7d7d7d', texture: 'concrete' },
  wood: { color: '#7a5230', texture: 'wood' },
  night: { color: '#10173a', texture: 'grunge' },
  paper: { color: '#f1ebd8', texture: 'paper' },
  berlin: { color: '#b9b9b4', texture: 'grunge' },
  asphalt: { color: '#2c2c30', texture: 'concrete' },
  azulejo: { color: '#2b6cb0', texture: 'tiles' },
  metal: { color: '#8a8f98', texture: 'metal' },
};
const SLUG_RE = /^[a-z0-9_-]{1,30}$/;
const BAD_SLUGS = new Set(['__proto__', 'prototype', 'constructor']);
const validSlug = (s) => SLUG_RE.test(s) && !BAD_SLUGS.has(s);
const MAX_WALLS = 3000; // anonymous users can create walls: keep the database bounded
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Accepts a preset name (legacy walls stored 'brick', 'night', ...) or { color, texture }.
function normalizeBackground(b) {
  if (typeof b === 'string' && PRESETS[b]) return { ...PRESETS[b] };
  if (b && typeof b === 'object' && COLOR_RE.test(b.color) && TEXTURE_IDS.includes(b.texture)) {
    return { color: b.color.toLowerCase(), texture: b.texture };
  }
  return null;
}

// ---- Tiny JSON "database" ------------------------------------------------
// walls is a prototype-less object: a wall called "constructor" or "__proto__" can never reach
// Object.prototype (slugs like these match SLUG_RE, so this used to be a real hole).
let db = { walls: Object.create(null), boardW: undefined, nicks: Object.create(null), salt: undefined, rules: 0 };
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (fs.existsSync(DATA_FILE)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.boardW = parsed.boardW;
    db.rules = parsed.rules || 0;
    db.salt = parsed.salt;
    for (const [k, v] of Object.entries(parsed.nicks || {})) if (v && typeof v.h === 'string' && typeof v.name === 'string') db.nicks[k] = v;
    for (const [slug, w] of Object.entries(parsed.walls || {})) {
      if (SLUG_RE.test(slug) && !BAD_SLUGS.has(slug) && w && typeof w === 'object' && Array.isArray(w.posts)) db.walls[slug] = w;
    }
  } catch (err) {
    // Never start "empty" over a file we couldn't read: the next save would destroy it.
    const keep = `${DATA_FILE}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(DATA_FILE, keep); } catch { /* ignore */ }
    console.error(`db.json could not be read (${err.message}); copy kept at ${keep}`);
  }
}
// migrate walls saved with the old string backgrounds
for (const w of Object.values(db.walls)) {
  w.background = normalizeBackground(w.background) || { ...PRESETS.brick };
  // A wall counts as "set up" (named + styled) once it has a scribble or went through creation.
  // Older walls that only exist because someone once visited the URL are not.
  w.setup = w.setup === true || (w.posts || []).length > 0;
  // Older posts had no y (they were stacked newest-first) and x on a 0-70 scale.
  // Give them a fixed spot once, in that same order, so they keep it from now on.
  const legacy = (w.posts || []).filter((p) => typeof p.y !== 'number').sort((a, b) => b.id - a.id);
  let cursor = 24;
  for (const p of legacy) {
    p.x = Math.min(100, Math.round((p.x || 0) / 0.7));
    p.y = cursor;
    cursor += Math.round((p.size || 28) * 1.2) + 14;
  }
}

let saveTimer = null;
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    // write to a temp file then rename, so a crash mid-write can't corrupt the db
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Failed to save db:', err);
  }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

// The board used to be narrower. When it grows, keep every scribble where the viewer saw it:
// left(px) stays the same, shifted so the old content sits in the middle of the new, wider wall.
{
  const oldW = db.boardW || 2400;
  if (oldW !== WALL_W) {
    for (const w of Object.values(db.walls)) {
      for (const p of w.posts || []) {
        const left = (p.x / 100) * oldW + (WALL_W - oldW) / 2;
        p.x = Math.min(100, Math.max(0, Math.round((left / WALL_W) * 1000) / 10));
      }
    }
    db.boardW = WALL_W;
    save();
  }
}

// Signature rules start now: everything that already exists stays permanent (it predates the rule).
{
  let dirty = false;
  if (!db.salt) { db.salt = crypto.randomBytes(16).toString('hex'); dirty = true; }
  if (db.rules !== 1) {
    for (const w of Object.values(db.walls)) for (const p of w.posts) if (p.sig === undefined) p.perm = true;
    db.rules = 1; dirty = true;
  }
  // ids keep counting up even after scribbles vanish (a reused id would confuse open pages)
  for (const w of Object.values(db.walls)) if (!w.nextId) w.nextId = w.posts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  if (dirty) save();
}

const expiresAt = (p) => (p.sig || p.perm ? null : p.createdAt + ANON_TTL + Math.min(p.sup || 0, MAX_SUPPORT) * SUPPORT_BONUS);
const isAlive = (p) => { const e = expiresAt(p); return e === null || e > Date.now(); };
// what the API shows: never the supporter hashes
const pub = (p) => ({
  id: p.id, text: p.text, font: p.font, color: p.color, size: p.size, bold: p.bold, x: p.x, y: p.y, rot: p.rot, createdAt: p.createdAt,
  ...(p.sig ? { sig: p.sig } : {}), sup: p.sup || 0, expiresAt: expiresAt(p),
});
function purge() {
  let n = 0;
  for (const w of Object.values(db.walls)) { const before = w.posts.length; w.posts = w.posts.filter(isAlive); n += before - w.posts.length; }
  if (n) save();
}
purge();
setInterval(purge, 10 * 60 * 1000).unref();
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function getWall(slug, create = false) {
  if (BAD_SLUGS.has(slug)) return undefined;
  if (!db.walls[slug] && create) {
    if (Object.keys(db.walls).length >= MAX_WALLS) return null; // full
    db.walls[slug] = { slug, background: { ...PRESETS.brick }, setup: false, createdAt: Date.now(), posts: [] };
    save();
  }
  return db.walls[slug];
}

// ---- Naive per-IP rate limits ---------------------------------------------
function limiter(ms) {
  const last = new Map();
  setInterval(() => { const cut = Date.now() - ms; for (const [k, t] of last) if (t < cut) last.delete(k); }, 60000).unref(); // no unbounded growth
  return (req, res, next) => {
    const now = Date.now();
    if (now - (last.get(req.ip) || 0) < ms) {
      return res.status(429).json({ error: 'Calma! Espere alguns segundos.' });
    }
    last.set(req.ip, now);
    next();
  };
}
const rateLimit = limiter(3000);    // 1 scribble / 3s
const setupLimit = limiter(2000);   // 1 new wall / 2s
const adminLimit = limiter(1000);   // admin token guesses: 1 / s
// overall budget per IP for every /api call (polling is ~12/min per open tab)
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
const apiBudget = (req, res, next) => {
  const n = (hits.get(req.ip) || 0) + 1; hits.set(req.ip, n);
  if (n > 600) return res.status(429).json({ error: 'Muitas requisições. Tente de novo em um minuto.' });
  next();
};

// ---- App -------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // behind Railway's proxy: req.ip must be the real client IP
app.disable('x-powered-by');
// Security headers. script-src allows only our own files (no inline scripts, no third parties) plus
// 'unsafe-eval', as requested. The app itself no longer needs it: the page template is precompiled.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '4kb' }));
app.use('/api', apiBudget);
// The page template is compiled once at startup into a plain render function, so the browser uses
// Vue's runtime-only build and the CSP needs no 'unsafe-eval'.
const { compile } = require('@vue/compiler-dom');
const { code: renderCode } = compile(fs.readFileSync(path.join(__dirname, 'src', 'app.template.html'), 'utf8'), {
  mode: 'function', whitespace: 'condense', onError: (e) => { throw e; },
});
const RENDER_JS = `window.__appRender = (function () {\n${renderCode}\n})();\n`;
app.get('/render.js', (req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').send(RENDER_JS));
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/three.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/three/build/three.module.min.js'))
);
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist'), { index: false }));
app.use('/vendor/vue.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/vue/dist/vue.runtime.global.prod.js'))
);

app.get('/api/meta', (req, res) =>
  res.json({ fonts: FONTS, textures: TEXTURES, presets: PRESETS, maxText: MAX_TEXT, wallWidth: WALL_W, photos: !!MAPILLARY_TOKEN })
);

// ---- Places -------------------------------------------------------------------
// A wall can optionally be tied to a place, chosen once at creation (picked on the map or from the GPS). The
// coordinates are rounded to 4 decimals (about 11 m): enough for the 3D street to match the real place, not a
// doorstep. The creation form tells people to pick a public place.
function normalizeGeo(g) {
  if (g === undefined || g === null) return null;
  if (typeof g !== 'object') return false;
  const { lat, lon, place } = g;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  const name = typeof place === 'string'
    ? place.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
    : '';
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, ...(name ? { place: name } : {}) };
}

// Fetch one open photo near a (rounded) place and keep it on our disk, so visitors never talk to Mapillary
// and the image can't change under us. Only https URLs on Mapillary's own hosts are followed (no SSRF).
async function fetchPlacePhoto(slug, geo) {
  const d = 0.01;
  const q = new URLSearchParams({
    fields: 'id,thumb_1024_url,creator,captured_at',
    bbox: [geo.lon - d, geo.lat - d, geo.lon + d, geo.lat + d].join(','),
    limit: '10',
    access_token: MAPILLARY_TOKEN,
  });
  const ok = (r) => r && r.ok;
  const r1 = await fetch(`${MAPILLARY_API}/images?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!ok(r1)) throw new Error('mapillary list ' + r1.status);
  const list = ((await r1.json()).data || []);
  const pick = list.find((i) => {
    try { const u = new URL(i.thumb_1024_url); return (u.protocol === 'https:' || process.env.MAPILLARY_API) && MAPILLARY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)); } catch { return false; }
  });
  if (!pick) return null;
  const r2 = await fetch(pick.thumb_1024_url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!ok(r2)) throw new Error('photo ' + r2.status);
  const buf = Buffer.from(await r2.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES || buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a jpeg');
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  fs.writeFileSync(path.join(PHOTO_DIR, slug + '.jpg'), buf);
  const creator = ((pick.creator && pick.creator.username) || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
  return { id: String(pick.id).replace(/\D/g, '').slice(0, 20), creator, year: pick.captured_at ? new Date(pick.captured_at).getUTCFullYear() : null };
}
app.get('/api/walls/:slug/photo', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const w = validSlug(slug) && db.walls[slug];
  if (!w || !w.photo) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400').type('image/jpeg').sendFile(path.join(PHOTO_DIR, slug + '.jpg'), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});

async function fetchScene(slug, geo) {
  const dLat = SCENE_HALF_M / 110540, dLon = SCENE_HALF_M / (111320 * Math.cos((geo.lat * Math.PI) / 180));
  const bb = [geo.lat - dLat, geo.lon - dLon, geo.lat + dLat, geo.lon + dLon].map((n) => n.toFixed(6)).join(',');
  // buildings, roads, and the ground: water, sand (beaches), parks and the coastline itself
  const query = `[out:json][timeout:12];(way["building"](${bb});way["building:part"](${bb});relation["building"](${bb});node["name"]["shop"](${bb});node["name"]["amenity"](${bb});way["highway"](${bb});way["natural"~"^(water|beach|sand|coastline)$"](${bb});way["leisure"~"^(park|garden|pitch|playground)$"](${bb});way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"](${bb});node["natural"="tree"](${bb}););out tags geom(${bb}) 4000;`; // geom(bbox): geometry clipped to the box, points outside come back null
  const r = await fetch(OVERPASS_API, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'repiche.me (graffiti wall; github.com/edsonma/repiche.me)' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!r.ok) throw new Error('overpass ' + r.status);
  const els = ((await r.json()).elements || []);
  const kx = 111320 * Math.cos((geo.lat * Math.PI) / 180), kz = 110540;
  const toXZ = (g, maxPts = MAX_PTS) => {
    const out = [];
    const step = Math.max(1, Math.ceil(g.length / maxPts));
    for (let i = 0; i < g.length; i += step) {
      const p = g[i];
      if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
      const x = (p.lon - geo.lon) * kx, z = -(p.lat - geo.lat) * kz; // north is -z: you face north looking at the wall
      if (Math.abs(x) > 600 || Math.abs(z) > 600) return null;
      out.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
    }
    return out;
  };
  const ROAD_W = { motorway: 11, trunk: 10, primary: 9, secondary: 8, tertiary: 7, residential: 6, unclassified: 6, living_street: 5, service: 4, pedestrian: 4, footway: 1.6, path: 1.6, cycleway: 2, steps: 1.6, track: 3 };
  const b = [], rd = [], ar = [], tr = [], poi = [];
  const num1 = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
  const cssColour = (v) => (typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(v) ? v : null);
  // one building (or building:part) with what OpenStreetMap knows about it: height, floor it starts at, roof, colours, material
  function pushBuilding(t, pts, holes) {
    const lv = num1(t['building:levels']), hh = num1(t.height), mh0 = num1(t.min_height), ml = num1(t['building:min_level']);
    const small = ['garage', 'garages', 'shed', 'roof', 'carport', 'kiosk', 'hut', 'cabin'].includes(t.building);
    let h = Number.isFinite(hh) ? hh : Number.isFinite(lv) ? lv * 3 + 1 : small ? 3 : 6 + (Math.abs(pts[0] * 7 + pts[1] * 13) % 6);
    h = Math.round(Math.min(150, Math.max(2.5, h)) * 10) / 10;
    const ex = {};
    const mh = Number.isFinite(mh0) ? mh0 : Number.isFinite(ml) ? ml * 3 : 0;
    if (mh > 0 && mh < h) ex.mh = Math.round(mh * 10) / 10;
    if (t['building:part']) ex.p = 1;
    let rs = ['gabled', 'hipped', 'pyramidal', 'half-hipped', 'dome', 'skillion', 'flat'].includes(t['roof:shape']) ? t['roof:shape'] : null;
    // houses are almost never flat-roofed; when the map does not say, assume a tiled roof (anything else stays flat)
    if (!rs && ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'cabin'].includes(t.building)) rs = pts.length <= 10 ? 'gabled' : 'hipped';
    if (rs && rs !== 'flat') ex.rs = rs;
    const rhT = num1(t['roof:height']), rl = num1(t['roof:levels']);
    if (Number.isFinite(rhT)) ex.rh = Math.min(12, Math.max(0.5, rhT)); else if (Number.isFinite(rl)) ex.rh = Math.min(12, Math.max(0.5, rl * 2.5));
    const rc = cssColour(t['roof:colour']); if (rc) ex.rc = rc;
    const mat = String(t['building:material'] || t.material || '').toLowerCase();
    if (/glass|steel|metal/.test(mat)) ex.m = 'glass'; else if (/brick|stone|sandstone/.test(mat)) ex.m = 'brick';
    else if (/^(office|commercial|retail|hotel|hospital)$/.test(t.building) && h > 15) ex.m = 'glass';
    if (holes.length) ex.ho = holes.slice(0, 4);
    const colour = cssColour(t['building:colour'] || t.colour);
    b.push([h, pts, colour || null, ...(Object.keys(ex).length ? [ex] : [])]);
  }
  for (const e of els) {
    if (e.type === 'relation' && e.tags && e.tags.building && Array.isArray(e.members) && b.length < MAX_BUILDINGS) {
      // a building with a courtyard (multipolygon): closed outer ring(s) plus inner rings as holes
      const ring = (m) => (m.geometry && m.geometry.length > 3 && m.geometry[0] && m.geometry.at(-1) && m.geometry[0].lat === m.geometry.at(-1).lat && m.geometry[0].lon === m.geometry.at(-1).lon ? toXZ(m.geometry, 80) : null);
      const outer = e.members.filter((m) => m.role === 'outer').map(ring).filter((r) => r && r.length >= 6);
      const inner = e.members.filter((m) => m.role === 'inner').map(ring).filter((r) => r && r.length >= 6);
      for (const o of outer.slice(0, 3)) pushBuilding(e.tags, o, inner);
      continue;
    }
    if (e.type === 'node' && e.tags && e.tags.name && (e.tags.shop || e.tags.amenity) && typeof e.lat === 'number' && typeof e.lon === 'number') {
      const x = (e.lon - geo.lon) * kx, z = -(e.lat - geo.lat) * kz;
      const name = String(e.tags.name).replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
      if (name && poi.length < 60 && Math.abs(x) < 400 && Math.abs(z) < 400) poi.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, name]);
      continue;
    }
    if (e.type === 'node' && e.tags && e.tags.natural === 'tree' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      const x = (e.lon - geo.lon) * kx, z = -(e.lat - geo.lat) * kz;
      if (tr.length < MAX_TREES * 2 && Math.abs(x) < 600 && Math.abs(z) < 600) tr.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
      continue;
    }
    if (e.type !== 'way' || !Array.isArray(e.geometry) || !e.geometry.length) continue;
    const t = e.tags || {};
    if ((t.building || t['building:part']) && b.length < MAX_BUILDINGS) {
      const pts = toXZ(e.geometry, 80);
      if (!pts || pts.length < 6) continue;
      pushBuilding(t, pts, []);
    } else if ((t.natural || t.leisure || t.landuse) && ar.length < MAX_AREAS) {
      // 'c' = coastline (open line, the sea is on its right-hand side); w / s / g = closed water / sand / green areas
      const kind = t.natural === 'coastline' ? 'c' : t.natural === 'water' ? 'w' : (t.natural === 'beach' || t.natural === 'sand') ? 's' : (t.leisure || t.landuse) ? 'g' : null;
      if (!kind) continue;
      // keep what is inside the box; a coastline split by the box edge becomes separate pieces
      const runs = []; let cur = [];
      for (const p of e.geometry) {
        if (p && typeof p.lat === 'number' && typeof p.lon === 'number') cur.push(p); else { if (cur.length) runs.push(cur); cur = []; }
      }
      if (cur.length) runs.push(cur);
      for (const run of (kind === 'c' ? runs : [runs.flat()])) {
        const pts = toXZ(run);
        if (pts && pts.length >= (kind === 'c' ? 4 : 6) && ar.length < MAX_AREAS) ar.push([kind, pts]);
      }
    } else if (t.highway && ROAD_W[t.highway] && rd.length < MAX_ROADS) {
      const pts = toXZ(e.geometry);
      const wTag = parseFloat(t.width), lanes = parseFloat(t.lanes);
      const w = Number.isFinite(wTag) ? wTag : (Number.isFinite(lanes) && ROAD_W[t.highway] >= 4) ? lanes * 3.2 : ROAD_W[t.highway];
      if (pts && pts.length >= 4) rd.push([Math.round(Math.min(20, Math.max(1.5, w)) * 10) / 10, pts]);
    }
  }
  if (!b.length && !rd.length && !ar.length) return null;
  const data = JSON.stringify({ b, r: rd, a: ar, t: tr, p: poi });
  if (data.length > 1800 * 1024) throw new Error('scene too big');
  fs.mkdirSync(SCENE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCENE_DIR, slug + '.json'), data);
  return { buildings: b.length, roads: rd.length, areas: ar.length, trees: tr.length / 2, v: SCENE_VERSION };
}
const photoJobs = new Set();
function ensurePhoto(slug, w) {
  if (photoJobs.has(slug) || w.photo || !w.geo || !MAPILLARY_TOKEN) return;
  photoJobs.add(slug);
  fetchPlacePhoto(slug, w.geo).then((p) => { if (p) { w.photo = p; save(); } }).catch((e) => console.error('photo:', e.message)).finally(() => photoJobs.delete(slug));
}
const sceneJobs = new Map(), sceneFailed = new Map();
async function ensureScene(slug, w) {
  if ((sceneFailed.get(slug) || 0) > Date.now()) return;
  if (!sceneJobs.has(slug)) {
    sceneJobs.set(slug, (async () => {
      try { const sc = await fetchScene(slug, w.geo); if (sc) { w.scene = sc; save(); } else sceneFailed.set(slug, Date.now() + 6 * 3600e3); }
      catch (e) { console.error('scene:', e.message); sceneFailed.set(slug, Date.now() + 10 * 60e3); }
      finally { sceneJobs.delete(slug); }
    })());
  }
  await sceneJobs.get(slug);
}
app.get('/api/walls/:slug/scene', async (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const w = validSlug(slug) && db.walls[slug];
  if (!w) return res.status(404).end();
  if (w.geo && (!w.scene || w.scene.v !== SCENE_VERSION)) { // missing (older wall) or built by an older version: (re)build, but never keep the visitor waiting long
    const job = ensureScene(slug, w);
    await Promise.race([job, new Promise((ok) => setTimeout(ok, SCENE_WAIT_MS))]);
    if (!w.scene) return res.status(202).json({ pending: sceneJobs.has(slug) });
  }
  if (!w.scene) return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('application/json').sendFile(path.join(SCENE_DIR, slug + '.json'), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});

// Walls that have a place (for the map)
app.get('/api/map', (req, res) => {
  res.json(Object.values(db.walls)
    .filter((w) => w.setup && w.geo)
    .map((w) => ({ slug: w.slug, lat: w.geo.lat, lon: w.geo.lon, place: w.geo.place || '', count: w.posts.filter(isAlive).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 500));
});

// Recently active walls (for the navigation modal)
app.get('/api/walls', (req, res) => {
  const walls = Object.values(db.walls)
    .filter((w) => w.setup)
    .map((w) => ({
      slug: w.slug,
      background: w.background,
      count: w.posts.filter(isAlive).length,
      last: w.posts.length ? w.posts[w.posts.length - 1].createdAt : w.createdAt,
    }))
    .sort((a, b) => b.last - a.last)
    .slice(0, 20);
  res.json(walls);
});

// Wall + one page of posts (newest first). ?before=<postId> to paginate.
app.get('/api/walls/:slug', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!validSlug(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });
  // Visiting an unknown URL does not create anything: it just shows a blank, not-yet-set-up wall,
  // so the client can offer the "create your wall" step (name + look) first.
  const wall = BAD_SLUGS.has(slug) ? undefined : db.walls[slug];
  if (!wall) {
    return res.json({ slug, background: { ...PRESETS.brick }, total: 0, posts: [], setup: false });
  }

  // The wall is a 2D board, so every scribble is needed to draw it (oldest first = bottom layer).
  // ?after=<id> returns only newer ones: that's what the 5-second poll uses, so it stays tiny.
  const after = parseInt(req.query.after, 10);
  res.json({
    slug: wall.slug,
    background: wall.background,
    serverNow: Date.now(),
    total: wall.posts.filter(isAlive).length,
    posts: wall.posts.filter((p) => isAlive(p) && (!Number.isFinite(after) || p.id > after)).map(pub),
    setup: !!wall.setup,
    ...(wall.geo ? { geo: wall.geo } : {}),
    ...(wall.photo ? { photo: wall.photo } : {}),
    ...(wall.scene ? { scene: wall.scene } : {}),
  });
});

// The look is chosen once, when the wall is created (POST .../setup), and can't be changed afterwards.
app.post('/api/walls/:slug/background', (req, res) =>
  res.status(403).json({ error: 'O fundo não pode ser alterado depois que o muro é criado.' })
);

// Creation step: pick the name (the URL) and the look before the first scribble.
// 409 if that wall already exists, so nobody can overwrite someone else's wall this way.
const RESERVED = new Set(['api', 'health', 'vendor', 'home', ...BAD_SLUGS]);
app.post('/api/walls/:slug/setup', setupLimit, async (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!validSlug(slug)) {
    return res.status(400).json({ error: 'Nome inválido. Use letras, números, - ou _ (até 30).' });
  }
  if (RESERVED.has(slug)) return res.status(400).json({ error: 'Esse nome é reservado. Escolha outro.' });
  const bg = normalizeBackground((req.body || {}).background);
  if (!bg) return res.status(400).json({ error: 'Fundo inválido.' });
  const geo = normalizeGeo((req.body || {}).geo);
  if (geo === false) return res.status(400).json({ error: 'Lugar inválido.' });
  const existing = db.walls[slug];  // (null-prototype object: only real walls)
  if (existing && existing.setup) return res.status(409).json({ error: 'Esse muro já existe.' });
  const wall = getWall(slug, true);
  if (!wall) return res.status(503).json({ error: 'Muitos muros criados. Tente mais tarde.' });
  // optional extras (a Mapillary photo, the OSM street scene) are fetched AFTER answering: creating a wall must
  // be instant, and these upstream calls can take many seconds.
  const wantPhoto = (req.body || {}).photo === true, wantScene = (req.body || {}).scene === true;
  if (wantPhoto && (!geo || !MAPILLARY_TOKEN)) return res.status(400).json({ error: 'Foto do lugar indisponível.' });
  if (wantScene && !geo) return res.status(400).json({ error: 'O cenário precisa de um lugar.' });
  const again = db.walls[slug]; // someone may have created it while we were fetching
  if (again && again.setup) return res.status(409).json({ error: 'Esse muro já existe.' });
  wall.background = bg;
  if (geo) wall.geo = geo;
  wall.setup = true;
  save();
  if (wantPhoto) ensurePhoto(slug, wall);
  if (wantScene) ensureScene(slug, wall);
  res.status(201).json({ slug, background: wall.background, ...(wall.geo ? { geo: wall.geo } : {}), ...(wantPhoto ? { photoPending: true } : {}), ...(wantScene ? { scenePending: true } : {}) });
});

app.post('/api/walls/:slug/posts', rateLimit, (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!validSlug(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });

  const { text, font, color, size, bold, x, y, rot, sig, token } = req.body || {};
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // no control chars, zero-width or bidi-override characters (they can reorder/hide text); newlines -> space
  const clean = typeof text === 'string'
    ? text.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/ {2,}/g, ' ').trim().slice(0, MAX_TEXT)
    : '';
  if (!clean) return res.status(400).json({ error: 'Escreva algo!' });
  if (!FONTS.includes(font)) return res.status(400).json({ error: 'Fonte inválida.' });
  if (!COLOR_RE.test(color)) return res.status(400).json({ error: 'Cor inválida.' });
  const fontSize = Math.min(72, Math.max(14, parseInt(size, 10) || 28));

  // Optional signature: the first person to use a name claims it (tied to a secret kept in their browser);
  // nobody else can sign with it afterwards. Signed scribbles never fade.
  let nick = '';
  if (typeof sig === 'string' && sig.trim()) {
    nick = sig.normalize('NFKC').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    if (!NICK_RE.test(nick)) return res.status(400).json({ error: 'Assinatura inválida: 2 a 20 letras, números, espaço, ponto, - ou _.' });
    if (RESERVED_NICKS.has(nick.toLowerCase())) return res.status(400).json({ error: 'Esse nome de assinatura é reservado.' });
    if (typeof token !== 'string' || !/^[0-9a-f]{32,128}$/.test(token)) return res.status(400).json({ error: 'Não foi possível identificar este navegador.' });
    const key = nick.toLowerCase(), h = sha(token), owner = db.nicks[key];
    if (owner && owner.h !== h) return res.status(403).json({ error: 'Esse nome de assinatura já tem dono. Escolha outro.' });
    if (!owner) {
      if (Object.keys(db.nicks).length >= MAX_NICKS) return res.status(503).json({ error: 'Assinaturas esgotadas por enquanto.' });
      db.nicks[key] = { name: nick, h };
    }
    nick = db.nicks[key].name;
  }

  const wall = getWall(slug, true);
  if (!wall) return res.status(503).json({ error: 'Muitos muros criados. Tente mais tarde.' });
  const id = wall.nextId || (wall.posts.reduce((m, p) => Math.max(m, p.id), 0) + 1);
  wall.nextId = id + 1;
  const post = {
    id,
    text: clean,
    font,
    color,
    size: fontSize,
    bold: !!bold,
    // Where the author dropped it. Saved as-is so the scribble stays put for everyone, forever.
    // (x/y/rot are chosen randomly only if a client doesn't send them.)
    x: num(x) ? clamp(Math.round(x * 10) / 10, 0, 100) : Math.round(Math.random() * 100),
    y: num(y) ? clamp(Math.round(y), 0, MAX_Y) : Math.round(Math.random() * 600),
    rot: num(rot) ? clamp(Math.round(rot * 10) / 10, -180, 180) : Math.round((Math.random() * 30 - 15) * 10) / 10,
    createdAt: Date.now(),
    ...(nick ? { sig: nick } : {}),
  };
  wall.posts.push(post);
  wall.setup = true;
  if (wall.posts.length > MAX_POSTS_PER_WALL) { // full: drop the oldest fading one first, signed ones last
    const i = wall.posts.findIndex((p) => expiresAt(p) !== null);
    wall.posts.splice(i >= 0 ? i : 0, 1);
  }
  save();
  res.status(201).json(pub(post));
});

// "Apoiar": +1 day of life for a fading (anonymous) scribble, once per browser and per network, max 30.
const supportLimit = limiter(1500);
app.post('/api/walls/:slug/posts/:id/support', supportLimit, (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!validSlug(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });
  const token = (req.body || {}).token;
  if (typeof token !== 'string' || !/^[0-9a-f]{32,128}$/.test(token)) return res.status(400).json({ error: 'Não foi possível identificar este navegador.' });
  const wall = db.walls[slug];
  const p = wall && wall.posts.find((q) => q.id === parseInt(req.params.id, 10));
  if (!p || !isAlive(p)) return res.status(404).json({ error: 'Essa pichação não existe mais.' });
  if (expiresAt(p) === null) return res.status(400).json({ error: 'Essa pichação já é permanente.' });
  if ((p.sup || 0) >= MAX_SUPPORT) return res.status(409).json({ error: 'Essa pichação já recebeu o apoio máximo.' });
  const th = sha(token).slice(0, 12), ih = sha(db.salt + req.ip).slice(0, 12);
  p.supBy = p.supBy || [];
  if (p.supBy.includes(th) || p.supBy.includes(ih)) return res.status(409).json({ error: 'Você já apoiou essa pichação.' });
  p.supBy.push(th, ih);
  p.sup = (p.sup || 0) + 1;
  save();
  res.json(pub(p));
});

// Moderation: scribbles are permanent for everyone, except the site admin. Off unless ADMIN_TOKEN (>=16 chars) is set.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
app.delete('/api/walls/:slug/posts/:id', adminLimit, (req, res) => {
  if (ADMIN_TOKEN.length < 16) return res.status(404).json({ error: 'Não encontrado.' });
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m || !crypto.timingSafeEqual(digest(m[1]), digest(ADMIN_TOKEN))) return res.status(401).json({ error: 'Não autorizado.' });
  const slug = req.params.slug.toLowerCase();
  const wall = validSlug(slug) ? db.walls[slug] : undefined;
  const i = wall ? wall.posts.findIndex((p) => p.id === parseInt(req.params.id, 10)) : -1;
  if (i < 0) return res.status(404).json({ error: 'Não encontrado.' });
  wall.posts.splice(i, 1);
  save();
  res.json({ ok: true });
});

// unknown API paths: JSON, not the SPA page
app.use('/api', (req, res) => res.status(404).json({ error: 'Não encontrado.' }));

// Any other path = a wall page (SPA)
app.get('/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// bad JSON / oversized body / anything unexpected: a short JSON error, never a stack trace
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'Pedido grande demais.' : status < 500 ? 'Requisição inválida.' : 'Erro interno.' });
});

const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`repiche.me running on port ${PORT}, data in ${DATA_FILE}`)
);

// keep a rolling backup next to the database (every 6 hours)
setInterval(() => { try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch (e) { console.error('backup failed:', e.message); } }, 6 * 3600 * 1000).unref();

// Railway sends SIGTERM on redeploy: write pending changes before exiting.
function shutdown() {
  if (saveTimer) flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
