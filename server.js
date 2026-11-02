const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

// ---- Limits / whitelists -------------------------------------------------
const MAX_TEXT = 140;
const MAX_POSTS_PER_WALL = 2000;
const PAGE_SIZE = 40;
const FONTS = [
  'Permanent Marker', 'Rock Salt', 'Special Elite', 'Londrina Solid',
  'Pacifico', 'Bangers', 'Caveat', 'Creepster', 'Fredericka the Great',
  'Press Start 2P', 'Shadows Into Light', 'Indie Flower',
];
const BACKGROUNDS = ['brick', 'concrete', 'wood', 'night', 'paper', 'berlin'];
const SLUG_RE = /^[a-z0-9_-]{1,30}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ---- Tiny JSON "database" ------------------------------------------------
let db = { walls: {} };
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db), (err) => {
      if (err) console.error('Failed to save db:', err);
    });
  }, 300);
}

function getWall(slug, create = false) {
  if (!db.walls[slug] && create) {
    db.walls[slug] = { slug, background: 'brick', createdAt: Date.now(), posts: [] };
    save();
  }
  return db.walls[slug];
}

// ---- Naive per-IP rate limit (1 post / 3s) -------------------------------
const lastPost = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  if (now - (lastPost.get(ip) || 0) < 3000) {
    return res.status(429).json({ error: 'Calma! Espere alguns segundos.' });
  }
  lastPost.set(ip, now);
  next();
}

// ---- App -------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/vue.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/vue/dist/vue.global.prod.js'))
);

app.get('/api/meta', (req, res) => res.json({ fonts: FONTS, backgrounds: BACKGROUNDS, maxText: MAX_TEXT }));

// Recently active walls (for the navigation modal)
app.get('/api/walls', (req, res) => {
  const walls = Object.values(db.walls)
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
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });
  const wall = getWall(slug, true);

  const before = parseInt(req.query.before, 10);
  let posts = wall.posts;
  if (!Number.isNaN(before)) posts = posts.filter((p) => p.id < before);
  const page = posts.slice(-PAGE_SIZE).reverse();

  res.json({
    slug: wall.slug,
    background: wall.background,
    total: wall.posts.length,
    posts: page,
    hasMore: posts.length > PAGE_SIZE,
  });
});

app.post('/api/walls/:slug/background', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });
  if (!BACKGROUNDS.includes(req.body.background)) return res.status(400).json({ error: 'Fundo inválido.' });
  const wall = getWall(slug, true);
  wall.background = req.body.background;
  save();
  res.json({ background: wall.background });
});

app.post('/api/walls/:slug/posts', rateLimit, (req, res) => {
  const slug = req.params.slug.toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Nome de muro inválido.' });

  const { text, font, color, size, bold } = req.body || {};
  const clean = typeof text === 'string' ? text.trim().slice(0, MAX_TEXT) : '';
  if (!clean) return res.status(400).json({ error: 'Escreva algo!' });
  if (!FONTS.includes(font)) return res.status(400).json({ error: 'Fonte inválida.' });
  if (!COLOR_RE.test(color)) return res.status(400).json({ error: 'Cor inválida.' });
  const fontSize = Math.min(72, Math.max(14, parseInt(size, 10) || 28));

  const wall = getWall(slug, true);
  const lastId = wall.posts.length ? wall.posts[wall.posts.length - 1].id : 0;
  const post = {
    id: lastId + 1,
    text: clean,
    font,
    color,
    size: fontSize,
    bold: !!bold,
    // random layout, decided once so every visitor sees the same wall
    x: Math.round(Math.random() * 70),   // % from left
    rot: Math.round((Math.random() * 30 - 15) * 10) / 10, // degrees
    createdAt: Date.now(),
  };
  wall.posts.push(post);
  if (wall.posts.length > MAX_POSTS_PER_WALL) wall.posts.shift();
  save();
  res.status(201).json(post);
});

// Any other path = a wall page (SPA)
app.get('/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`piche clone running at http://localhost:${PORT}`));
