// API + security tests (no browser needed).
const fs = require('fs');
const path = require('path');
const { startServer, suite, sleep } = require('./lib');
const J = { 'Content-Type': 'application/json' };
const BG = { color: '#112233', texture: 'tiles' };
const TOKEN = 'correct-horse-battery-staple';

(async () => {
  const t = suite('api');
  const { check } = t;
  let ip = 0;
  // an old-format database: posts without y, x on the old 0-70 scale, board 2400 px wide
  const legacy = { walls: { velho: { slug: 'velho', background: 'brick', createdAt: 1, posts: [
    { id: 1, text: 'a', font: 'Bangers', color: '#ffffff', size: 40, bold: false, x: 0, rot: 0, createdAt: 1 },
    { id: 2, text: 'b', font: 'Bangers', color: '#ffffff', size: 40, bold: false, x: 35, rot: 0, createdAt: 2 },
    { id: 3, text: 'c', font: 'Bangers', color: '#ffffff', size: 50, bold: false, x: 70, rot: 0, createdAt: 3 },
  ] } } };
  let s = await startServer({ seed: legacy, env: { ADMIN_TOKEN: TOKEN } });
  const B = s.base;
  const post = (slug, body) => fetch(`${B}/api/walls/${slug}/posts`, { method: 'POST', headers: { ...J, 'X-Forwarded-For': `10.7.0.${++ip}` }, body: JSON.stringify(body) });
  const setup = (slug, bg) => fetch(`${B}/api/walls/${slug}/setup`, { method: 'POST', headers: { ...J, 'X-Forwarded-For': `10.7.0.${++ip}` }, body: JSON.stringify({ background: bg }) });
  const get = async (slug, q = '') => (await fetch(`${B}/api/walls/${slug}${q}`)).json();
  const P = { font: 'Bangers', color: '#ff00aa' };

  // ---- migrations ----
  const meta = await (await fetch(B + '/api/meta')).json();
  check('meta exposes the board width', meta.wallWidth === 10080);
  const old = await get('velho');
  const by = Object.fromEntries(old.posts.map((p) => [p.id, p]));
  check('legacy posts all got a y', old.posts.every((p) => typeof p.y === 'number'));
  check('legacy: newest on top (y=24), older stacked below', by[3].y === 24 && by[2].y === 98 && by[1].y === 160, JSON.stringify([by[3].y, by[2].y, by[1].y]));
  check('legacy x kept the same pixel spot, re-centered on the wider wall', by[3].x === 61.9 && by[2].x === 50 && by[1].x === 38.1, JSON.stringify([by[3].x, by[2].x, by[1].x]));
  check('legacy string background became {color,texture}', old.background.texture === 'brick' && /^#[0-9a-f]{6}$/.test(old.background.color));
  check('GET returns every post, oldest first', old.posts.map((p) => p.id).join() === '1,2,3' && old.total === 3);

  // ---- positions ----
  let r = await post('pos', { ...P, text: 'oi', size: 40, bold: true, x: 37.5, y: 812, rot: -7.3 });
  let p = await r.json();
  check('POST keeps x/y/rot as sent', r.status === 201 && p.x === 37.5 && p.y === 812 && p.rot === -7.3);
  check('GET returns the same position (what reload shows)', (await get('pos')).posts[0].y === 812);
  p = await (await post('pos', { ...P, text: 'a', x: 250, y: 999999, rot: 500 })).json();
  check('out-of-range values are clamped (rot to +-180)', p.x === 100 && p.y === 20000 && p.rot === 180, JSON.stringify([p.x, p.y, p.rot]));
  p = await (await post('pos', { ...P, text: 'a', x: -5, y: -40, rot: -500 })).json();
  check('negative values are clamped', p.x === 0 && p.y === 0 && p.rot === -180);
  p = await (await post('pos', { ...P, text: 'a', x: 'abc', y: null, rot: {} })).json();
  check('junk x/y/rot fall back to valid values', p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 600 && Math.abs(p.rot) <= 15);
  r = await post('pos', { ...P, text: '', x: 1, y: 1 });
  check('empty text rejected', r.status === 400);
  r = await post('pos', { ...P, text: 'x', font: 'Comic Sans', x: 1, y: 1 });
  check('font outside the whitelist rejected', r.status === 400);
  r = await post('pos', { ...P, text: 'x', color: 'red', x: 1, y: 1 });
  check('invalid color rejected', r.status === 400);

  // ---- creating walls ----
  let w = await get('ninguem');
  check('unknown wall is virtual (setup=false), not stored', w.setup === false && w.posts.length === 0 && !(await (await fetch(B + '/api/walls')).json()).some((x) => x.slug === 'ninguem'));
  check('setup 201', (await setup('meumuro', BG)).status === 201);
  w = await get('meumuro');
  check('wall saved with its look', w.setup === true && w.background.color === '#112233' && w.background.texture === 'tiles');
  check('second setup of the same name -> 409', (await setup('meumuro', BG)).status === 409);
  check('reserved name -> 400', (await setup('api', BG)).status === 400);
  check('invalid name -> 400', (await setup('Bad Name!', BG)).status === 400);
  check('invalid background -> 400', (await setup('okname', { color: 'red', texture: 'x' })).status === 400);
  await post('viapost', { ...P, text: 'a', x: 1, y: 1 });
  check('first scribble marks the wall as set up', (await get('viapost')).setup === true);
  r = await fetch(`${B}/api/walls/meumuro/background`, { method: 'POST', headers: J, body: JSON.stringify({ color: '#000000', texture: 'none' }) });
  check('background cannot be changed after creation (403)', r.status === 403 && (await get('meumuro')).background.color === '#112233');
  check('no edit routes for scribbles (PUT/PATCH 404)', (await fetch(`${B}/api/walls/pos/posts/1`, { method: 'PUT', headers: J, body: '{}' })).status === 404);

  // ---- security ----
  for (const bad of ['__proto__', 'constructor', 'prototype']) check(`setup "${bad}" refused`, (await setup(bad, BG)).status === 400);
  r = await post('__proto__', { ...P, text: 'x', x: 1, y: 1 });
  check('post to __proto__ -> 400, server alive', r.status === 400 && (await fetch(B + '/health')).ok);
  check('Object.prototype untouched', !({}).background && !({}).posts);
  const h = (await fetch(B + '/')).headers;
  const csp = h.get('content-security-policy') || '';
  check('CSP: frame-ancestors none', /frame-ancestors 'none'/.test(csp));
  check("CSP: no unsafe-eval, no unsafe-inline", !/unsafe-eval|unsafe-inline/.test(csp), csp);
  check('nosniff + X-Frame-Options + referrer policy', h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && !!h.get('referrer-policy'));
  check('X-Powered-By hidden', !h.get('x-powered-by'));
  const rj = await (await fetch(B + '/render.js')).text();
  check('page template is precompiled (render.js)', /__appRender/.test(rj));
  r = await fetch(`${B}/api/walls/a/posts`, { method: 'POST', headers: J, body: '{bad' });
  check('bad JSON -> JSON 400, no stack trace', r.status === 400 && /json/.test(r.headers.get('content-type')) && !(await r.text()).includes('    at '));
  r = await fetch(B + '/api/nope');
  check('unknown /api path -> JSON 404', r.status === 404 && /json/.test(r.headers.get('content-type')));
  r = await fetch(`${B}/api/walls/a/posts`, { method: 'POST', headers: J, body: JSON.stringify({ text: 'x'.repeat(6000) }) });
  check('oversized body -> 413', r.status === 413);
  p = await (await post('limpo', { ...P, text: 'oi‮galera​  \n  ok\u0007', x: 1, y: 1 })).json();
  check('bidi / zero-width / control characters stripped', p.text === 'oigalera ok', JSON.stringify(p.text));
  check('text is cut at 140 chars', (await (await post('limpo', { ...P, text: 'z'.repeat(500), x: 1, y: 1 })).json()).text.length === 140);

  // ---- polling + moderation ----
  await sleep(3100);
  await post('limpo', { ...P, text: 'dois', x: 2, y: 2 });
  w = await get('limpo', '?after=1');
  check('?after returns only newer posts', w.posts.length >= 1 && w.posts.every((x) => x.id > 1) && w.total >= 2);
  const del = (hd, id = 2) => fetch(`${B}/api/walls/limpo/posts/${id}`, { method: 'DELETE', headers: hd });
  check('admin DELETE without token -> 401', (await del({})).status === 401);
  await sleep(1100);
  check('admin DELETE with a wrong token -> 401', (await del({ Authorization: 'Bearer nope' })).status === 401);
  await sleep(1100);
  const before = (await get('limpo')).total;
  check('admin DELETE with the right token -> 200', (await del({ Authorization: 'Bearer ' + TOKEN })).status === 200 && (await get('limpo')).total === before - 1);

  // ---- limits ----
  let got429 = false;
  for (let i = 0; i < 650; i++) { if ((await fetch(B + '/api/meta', { headers: { 'X-Forwarded-For': '10.9.9.9' } })).status === 429) { got429 = true; break; } }
  check('per-IP API budget -> 429', got429);
  r = await post('rapido', { ...P, text: 'um', x: 1, y: 1 });
  const r2 = await fetch(`${B}/api/walls/rapido/posts`, { method: 'POST', headers: { ...J, 'X-Forwarded-For': `10.7.0.${ip}` }, body: JSON.stringify({ ...P, text: 'dois', x: 1, y: 1 }) });
  check('scribble rate limit (same IP twice in 3 s -> 429)', r.status === 201 && r2.status === 429);
  await s.stop();

  // ---- persistence ----
  const dir = s.dir;
  s = await startServer({ dir });
  check('walls survive a restart', (await (await fetch(s.base + '/api/walls/pos')).json()).total >= 1);
  check('admin delete is off without ADMIN_TOKEN', (await fetch(`${s.base}/api/walls/pos/posts/1`, { method: 'DELETE', headers: { Authorization: 'Bearer x' } })).status === 404);
  await s.stop();
  fs.writeFileSync(path.join(dir, 'db.json'), '{"walls": {broken');
  s = await startServer({ dir });
  await fetch(`${s.base}/api/walls/novo2/setup`, { method: 'POST', headers: J, body: JSON.stringify({ background: BG }) });
  await sleep(700);
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('db.json.corrupt-'));
  check('a corrupt db.json is copied aside, never overwritten', kept.length === 1 && fs.readFileSync(path.join(dir, kept[0]), 'utf8').includes('broken'));
  await s.stop();
  process.exit(t.done() ? 1 : 0);
})();
