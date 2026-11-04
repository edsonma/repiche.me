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

// ---- Limits / whitelists -------------------------------------------------
const MAX_TEXT = 140;
const MAX_POSTS_PER_WALL = 2000;
// Board width in px (must match what the client draws). x of a scribble is a % of the free width.
const WALL_W = 10080; // 50 m in the 3D view (200 px = 1 m); a multiple of 3360 so 3D wall segments line up
const MAX_Y = 20000; // px from the top of the wall; x is 0-100 (% of the free width)
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
let db = { walls: Object.create(null), boardW: undefined };
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (fs.existsSync(DATA_FILE)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.boardW = parsed.boardW;
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
// Security headers. 'unsafe-eval' is needed only because Vue compiles the in-page templates in the
// browser; script-src is otherwise limited to our own files (no inline scripts, no third parties).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
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
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '4kb' }));
app.use('/api', apiBudget);
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/three.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/three/build/three.module.min.js'))
);
app.use('/vendor/vue.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/vue/dist/vue.global.prod.js'))
);

app.get('/api/meta', (req, res) =>
  res.json({ fonts: FONTS, textures: TEXTURES, presets: PRESETS, maxText: MAX_TEXT, wallWidth: WALL_W })
);

// Recently active walls (for the navigation modal)
app.get('/api/walls', (req, res) => {
  const walls = Object.values(db.walls)
    .filter((w) => w.setup)
    .map((w) => ({
      slug: w.slug,
      background: w.background,
      count: w.posts.length,
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
    total: wall.posts.length,
    posts: Number.isFinite(after) ? wall.posts.filter((p) => p.id > after) : wall.posts,
    setup: !!wall.setup,
  });
});

// The look is chosen once, when the wall is created (POST .../setup), and can't be changed afterwards.
app.post('/api/walls/:slug/background', (req, res) =>
  res.status(403).json({ error: 'O fundo não pode ser alterado depois que o muro é criado.' })
);

// Creation step: pick the name (the URL) and the look before the first scribble.
// 409 if that wall already exists, so nobody can overwrite someone else's wall this way.
const RESERVED = new Set(['api', 'health', 'vendor', 'home', ...BAD_SLUGS]);
app.post('/api/walls/:slug/setup', setupLimit, (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!validSlug(slug)) {
    return res.status(400).json({ error: 'Nome inválido. Use letras, números, - ou _ (até 30).' });
  }
  if (RESERVED.has(slug)) return res.status(400).json({ error: 'Esse nome é reservado. Escolha outro.' });
  const bg = normalizeBackground((req.body || {}).background);
  if (!bg) return res.status(400).json({ error: 'Fundo inválido.' });
  const existing = db.walls[slug];  // (null-prototype object: only real walls)
  if (existing && existing.setup) return res.status(409).json({ error: 'Esse muro já existe.' });
  const wall = getWall(slug, true);
  if (!wall) return res.status(503).json({ error: 'Muitos muros criados. Tente mais tarde.' });
  wall.background = bg;
  wall.setup = true;
  save();
  res.status(201).json({ slug, background: wall.background });
});

app.post('/api/walls/:slug/posts', rateLimit, (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!validSlug(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });

  const { text, font, color, size, bold, x, y, rot } = req.body || {};
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

  const wall = getWall(slug, true);
  if (!wall) return res.status(503).json({ error: 'Muitos muros criados. Tente mais tarde.' });
  const lastId = wall.posts.length ? wall.posts[wall.posts.length - 1].id : 0;
  const post = {
    id: lastId + 1,
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
  };
  wall.posts.push(post);
  wall.setup = true;
  if (wall.posts.length > MAX_POSTS_PER_WALL) wall.posts.shift();
  save();
  res.status(201).json(post);
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
