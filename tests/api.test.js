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
  check("CSP: scripts only from 'self' (+ unsafe-eval), no unsafe-inline, no third-party scripts", /script-src 'self' 'unsafe-eval'(;|$)/.test(csp) && !/unsafe-inline/.test(csp), csp);
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

  // ---- fading scribbles, signatures, "apoiar" ----
  check('legacy scribbles are grandfathered: permanent', old.posts.every((x) => x.expiresAt === null));
  const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64);
  p = await (await post('vida', { ...P, text: 'anonima', x: 1, y: 1 })).json();
  check('anonymous scribble gets an expiry ~7 days out', p.expiresAt > Date.now() + 6.9 * 86400000 && p.expiresAt < Date.now() + 7.1 * 86400000 && !p.sig, String(p.expiresAt));
  await sleep(3100);
  r = await post('vida', { ...P, text: 'assinada', x: 2, y: 2, sig: '  Maria  Silva ', token: T1 });
  p = await r.json();
  check('signed scribble is permanent and shows the signature', r.status === 201 && p.sig === 'Maria Silva' && p.expiresAt === null);
  await sleep(3100);
  r = await post('vida', { ...P, text: 'roubo', x: 3, y: 3, sig: 'maria silva', token: T2 });
  check('someone else cannot sign with a claimed name (403)', r.status === 403);
  await sleep(3100);
  r = await post('vida', { ...P, text: 'ok de novo', x: 3, y: 3, sig: 'MARIA SILVA', token: T1 });
  check('the owner can keep signing (any capitalization)', r.status === 201 && (await r.json()).sig === 'Maria Silva');
  await sleep(3100);
  check('signature without a token -> 400', (await post('vida', { ...P, text: 'x', x: 1, y: 1, sig: 'Joao' })).status === 400);
  await sleep(3100);
  check('reserved / invalid signatures -> 400', (await post('vida', { ...P, text: 'x', x: 1, y: 1, sig: 'admin', token: T1 })).status === 400 && (await post('vida', { ...P, text: 'x', x: 1, y: 1, sig: '<b>', token: T1 })).status === 400);
  const wv = await get('vida');
  check('API never leaks supporter hashes or tokens', !JSON.stringify(wv).match(/supBy|"h"|token/));
  const anonId = wv.posts.find((x) => x.text === 'anonima').id, signedId = wv.posts.find((x) => x.text === 'assinada').id;
  const sup = (id, tok, xff) => fetch(`${B}/api/walls/vida/posts/${id}/support`, { method: 'POST', headers: { ...J, 'X-Forwarded-For': xff }, body: JSON.stringify({ token: tok }) });
  r = await sup(anonId, T1, '10.50.0.1'); p = await r.json();
  check('apoiar: +1 day of life', r.status === 200 && p.sup === 1 && p.expiresAt > Date.now() + 7.9 * 86400000, JSON.stringify([r.status, p.sup]));
  await sleep(1600);
  check('same browser cannot support twice (409)', (await sup(anonId, T1, '10.50.0.2')).status === 409);
  await sleep(1600);
  check('same network cannot support twice either (409)', (await sup(anonId, T2, '10.50.0.1')).status === 409);
  await sleep(1600);
  check('a signed (permanent) scribble needs no support (400)', (await sup(signedId, T2, '10.50.0.3')).status === 400);
  await sleep(1600);
  check('support needs a token (400)', (await sup(anonId, 'x', '10.50.0.4')).status === 400);

  await s.stop();

  // short-lived server: anonymous scribbles vanish, supported ones last longer, signed ones stay
  const sFast = await startServer({ env: { ANON_TTL_MS: '2500', SUPPORT_BONUS_MS: '3000', ADMIN_TOKEN: TOKEN } });
  const FB = sFast.base;
  let fip = 0;
  const fpost = (body) => fetch(`${FB}/api/walls/rapida/posts`, { method: 'POST', headers: { ...J, 'X-Forwarded-For': `10.60.0.${++fip}` }, body: JSON.stringify({ ...P, x: 1, y: 1, ...body }) });
  const a1 = await (await fpost({ text: 'some logo' })).json();
  const a2 = await (await fpost({ text: 'apoiada' })).json();
  await fpost({ text: 'fica', sig: 'Dona', token: T1 });
  await fetch(`${FB}/api/walls/rapida/posts/${a2.id}/support`, { method: 'POST', headers: { ...J, 'X-Forwarded-For': '10.60.1.1' }, body: JSON.stringify({ token: T2 }) });
  await sleep(3000);
  let wf = await (await fetch(`${FB}/api/walls/rapida`)).json();
  check('after the time is up the anonymous scribble is gone; supported and signed remain', !wf.posts.some((x) => x.text === 'some logo') && wf.posts.some((x) => x.text === 'apoiada') && wf.posts.some((x) => x.text === 'fica'), JSON.stringify(wf.posts.map((x) => x.text)));
  check('total counts only living scribbles', wf.total === 2);
  await sleep(3000);
  wf = await (await fetch(`${FB}/api/walls/rapida`)).json();
  check('supported scribble vanishes once its extra time is over; signed stays', !wf.posts.some((x) => x.text === 'apoiada') && wf.posts.some((x) => x.text === 'fica'));
  const fresh = await (await fpost({ text: 'nova' })).json();
  check('ids keep growing after scribbles vanished (no reuse)', fresh.id > a2.id + 1, `${a2.id} -> ${fresh.id}`);
  await sFast.stop();

  // ---- places / map ----
  const gs = await startServer();
  const setupG = (slug, body) => fetch(`${gs.base}/api/walls/${slug}/setup`, { method: 'POST', headers: J, body: JSON.stringify({ background: BG, ...body }) });
  let gr = await setupG('praca', { geo: { lat: -23.550520, lon: -46.633308, place: '  Praça\u202E da   Sé ' } });
  let jr = await gr.json();
  check('wall can be tied to a place; coordinates rounded to ~11 m (4 decimals), text cleaned', gr.status === 201 && jr.geo.lat === -23.5505 && jr.geo.lon === -46.6333 && jr.geo.place === 'Praça da Sé', JSON.stringify(jr));
  await sleep(2200);
  check('invalid places are rejected (range, type, NaN-like)', (await setupG('ruim1', { geo: { lat: 99, lon: 0 } })).status === 400);
  await sleep(2200);
  check('...string coordinates too', (await setupG('ruim2', { geo: { lat: '1', lon: '2' } })).status === 400);
  await sleep(2200);
  gr = await setupG('semlugar', {});
  check('place is optional', gr.status === 201 && !(await gr.json()).geo);
  check('GET wall returns its place', (await (await fetch(`${gs.base}/api/walls/praca`)).json()).geo.place === 'Praça da Sé');
  const mp = await (await fetch(`${gs.base}/api/map`)).json();
  check('/api/map lists only walls that have a place', mp.length === 1 && mp[0].slug === 'praca' && mp[0].lat === -23.5505 && !('posts' in mp[0]), JSON.stringify(mp));
  await sleep(2200);
  check('place cannot be changed afterwards (setup again -> 409)', (await setupG('praca', { geo: { lat: 1, lon: 1 } })).status === 409);
  check('geolocation allowed only for our own page', /geolocation=\(self\)/.test((await fetch(gs.base + '/')).headers.get('permissions-policy')));
  check('CSP lets map tiles load, nothing else external for images', /img-src [^;]*https:\/\/tile\.openstreetmap\.org/.test((await fetch(gs.base + '/')).headers.get('content-security-policy')));
  check('leaflet is served locally', (await fetch(gs.base + '/vendor/leaflet/leaflet.js')).status === 200);
  await gs.stop();

  // ---- Mapillary photo of the place (fake upstream; the real API is not reachable from tests) ----
  const http = require('http');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 1)]);
  const hits = [];
  const fake = http.createServer((rq, rs) => {
    hits.push(rq.url);
    if (rq.url.startsWith('/images')) {
      const port = fake.address().port;
      const data = /bbox=-?\d/.test(rq.url) && rq.url.includes('access_token=tok')
        ? [{ id: '123456', thumb_1024_url: `http://localhost:${port}/pic.jpg`, creator: { username: 'maria<script>' }, captured_at: '2021-05-01T00:00:00Z' }] : [];
      if (rq.url.includes('bbox=9.99')) data.length = 0; // "no photos here"
      rs.setHeader('Content-Type', 'application/json'); return rs.end(JSON.stringify({ data }));
    }
    rs.setHeader('Content-Type', 'image/jpeg'); rs.end(jpeg);
  });
  await new Promise((ok) => fake.listen(0, ok));
  const ms = await startServer({ env: { MAPILLARY_TOKEN: 'tok', MAPILLARY_API: `http://localhost:${fake.address().port}`, MAPILLARY_HOSTS: 'localhost' } });
  const setupM = (slug, body) => fetch(`${ms.base}/api/walls/${slug}/setup`, { method: 'POST', headers: J, body: JSON.stringify({ background: BG, ...body }) });
  check('meta says photos are available when a token is set', (await (await fetch(ms.base + '/api/meta')).json()).photos === true);
  check('a photo needs a place', (await setupM('semgeo', { photo: true })).status === 400);
  await sleep(2200);
  let mr = await setupM('rua', { geo: { lat: -23.55, lon: -46.63, place: 'Rua' }, photo: true });
  let mj = await mr.json();
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const r = await fn(); if (r || Date.now() - t0 > ms) return r; await sleep(100); } };
  check('creation answers right away and says the photo is coming', mr.status === 201 && mj.photoPending === true && !mj.photo, JSON.stringify(mj));
  mj = { photo: (await until(async () => (await (await fetch(`${ms.base}/api/walls/rua`)).json()).photo)) };
  check('the photo shows up in the background; credit is sanitized', mj.photo && mj.photo.id === '123456' && mj.photo.creator === 'mariascript' && mj.photo.year === 2021, JSON.stringify(mj));
  const ph = await fetch(`${ms.base}/api/walls/rua/photo`);
  check('photo is served from our own server as image/jpeg', ph.status === 200 && ph.headers.get('content-type') === 'image/jpeg' && (await ph.arrayBuffer()).byteLength === jpeg.length);
  check('GET wall exposes the credit, visitors never talk to Mapillary', (await (await fetch(`${ms.base}/api/walls/rua`)).json()).photo.creator === 'mariascript' && hits.length === 2, hits.join(' '));
  check('walls without a photo return 404 for it', (await fetch(`${ms.base}/api/walls/semgeo/photo`)).status === 404 && (await fetch(`${ms.base}/api/walls/__proto__/photo`)).status === 404);
  await sleep(2200);
  mr = await setupM('vazio', { geo: { lat: 10.0, lon: 10.0 }, photo: true }); mj = await mr.json();
  await sleep(800);
  check('no photos nearby: wall is still created, simply without a photo', mr.status === 201 && !(await (await fetch(`${ms.base}/api/walls/vazio`)).json()).photo && (await fetch(`${ms.base}/api/walls/vazio/photo`)).status === 404);
  await ms.stop(); fake.close();
  const ns = await startServer();
  check('without a token the option is off and requests for it are refused', (await (await fetch(ns.base + '/api/meta')).json()).photos === false && (await fetch(`${ns.base}/api/walls/xx/setup`, { method: 'POST', headers: J, body: JSON.stringify({ background: BG, geo: { lat: 1, lon: 1 }, photo: true }) })).status === 400);
  await ns.stop();

  // ---- OpenStreetMap street scene (fake Overpass) ----
  { const http2 = require('http');
  const hits2 = [];
  const fk = http2.createServer((rq, rs) => {
    let body = ''; rq.on('data', (d) => { body += d; });
    rq.on('end', () => {
      hits2.push(decodeURIComponent(body));
      const g = (pts) => pts.map(([la, lo]) => ({ lat: -23.55 + la, lon: -46.63 + lo }));
      const els = [
        { type: 'way', tags: { building: 'yes', 'building:levels': '5', 'building:colour': 'salmon' }, geometry: g([[0.0012, -0.0006], [0.0012, 0.0000], [0.0018, 0.0000], [0.0018, -0.0006]]) },
        { type: 'node', tags: { natural: 'tree' }, lat: -23.5499, lon: -46.6299 },
        { type: 'node', tags: { natural: 'tree' }, lat: 'x', lon: 1 },
        { type: 'way', tags: { building: 'house' }, geometry: g([[0, 0], [0.0001, 0]]) },
        { type: 'way', tags: { highway: 'residential' }, geometry: g([[0.0008, -0.0015], [0.0008, 0.0015]]) },
        { type: 'way', tags: { highway: 'weird' }, geometry: g([[0, 0], [0.001, 0]]) },
        { type: 'way', tags: { building: 'yes' }, geometry: [{ lat: 'x', lon: 1 }] },
        { type: 'way', tags: { building: 'yes' }, geometry: g([[0, 5]]) },
        { type: 'node', id: 1 },
      ];
      const ring = (la, lo, w) => g([[la, lo], [la, lo + w], [la + w, lo + w], [la + w, lo], [la, lo]]);
      els.push(
        { type: 'way', tags: { building: 'house', 'roof:shape': 'gabled', 'roof:colour': '#aa3322', 'roof:height': '2' }, geometry: ring(0.0030, 0.0008, 0.0003) },
        { type: 'way', tags: { building: 'commercial', 'building:material': 'glass', height: '40' }, geometry: ring(0.0030, 0.0014, 0.0003) },
        { type: 'relation', tags: { building: 'yes', 'building:levels': '3' }, members: [{ role: 'outer', geometry: ring(0.0034, -0.0010, 0.0006) }, { role: 'inner', geometry: ring(0.0036, -0.0008, 0.0002) }] },
        { type: 'way', tags: { 'building:part': 'yes', min_height: '10', height: '30' }, geometry: ring(0.0034, 0.0004, 0.0003) },
        { type: 'node', tags: { name: 'Padaria <b>X</b>', shop: 'bakery' }, lat: -23.5496, lon: -46.6296 },
        { type: 'node', tags: { shop: 'bakery' }, lat: -23.5496, lon: -46.6296 },
        { type: 'way', tags: { natural: 'coastline' }, geometry: g([[0.0004, -0.0020], [0.0004, 0.0], [0.0004, 0.0020]]) },
        { type: 'way', tags: { natural: 'water' }, geometry: g([[0.0020, 0.0], [0.0020, 0.0006], [0.0014, 0.0006], [0.0014, 0.0]]) },
        { type: 'way', tags: { natural: 'beach' }, geometry: g([[0.0005, 0.0], [0.0005, 0.0006], [0.0010, 0.0006], [0.0010, 0.0]]) },
        { type: 'way', tags: { leisure: 'park' }, geometry: [null, ...g([[0.0, 0.0010], [0.0, 0.0016], [0.0006, 0.0016]])] },
      );
      setTimeout(() => { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(rq.url === '/empty' ? { elements: [] } : { elements: els })); }, hits2.length === 1 ? 1500 : 0);
    });
  });
  await new Promise((ok) => fk.listen(0, ok));
  const os = await startServer({ env: { OVERPASS_API: `http://localhost:${fk.address().port}/x` } });
  const setupO = (slug, body) => fetch(`${os.base}/api/walls/${slug}/setup`, { method: 'POST', headers: J, body: JSON.stringify({ background: BG, ...body }) });
  check('a scene needs a place', (await setupO('semlugar2', { scene: true })).status === 400);
  await sleep(2200);
  const t0 = Date.now();
  let or = await setupO('bairro', { geo: { lat: -23.55, lon: -46.63, place: 'Bairro' }, scene: true });
  let oj = await or.json();
  check('creating a wall is instant even though Overpass takes 1.5 s', or.status === 201 && oj.scenePending === true && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  const gotScene = await until(async () => (await (await fetch(`${os.base}/api/walls/bairro`)).json()).scene, 6000);
  check('the scene is fetched in the background (1 building + 1 road, junk dropped; coast, sea, sand and park kept)', gotScene && gotScene.buildings === 5 && gotScene.roads === 1 && gotScene.areas === 4, JSON.stringify(gotScene));
  check('Overpass is asked once, with a bbox, for buildings, roads and terrain', hits2.length === 1 && /way\["building"\]/.test(hits2[0]) && /way\["highway"\]/.test(hits2[0]) && /coastline/.test(hits2[0]) && /geom\(/.test(hits2[0]));
  const sc = await (await fetch(`${os.base}/api/walls/bairro/scene`)).json();
  check('real trees and building colours/road widths come through', sc.t.length === 2 && sc.b.every((x) => x.length >= 2) && sc.r[0][0] === 6, JSON.stringify([sc.t, sc.r[0][0]]));
  const byTag = (f) => sc.b.find(f);
  check('roofs, materials, courtyards, building parts and named shops are kept', !!byTag((x) => x[3] && x[3].rs === 'gabled' && x[3].rc === '#aa3322' && x[3].rh === 2) && !!byTag((x) => x[3] && x[3].m === 'glass' && x[0] === 40) && !!byTag((x) => x[3] && x[3].ho && x[3].ho.length === 1) && !!byTag((x) => x[3] && x[3].p === 1 && x[3].mh === 10) && sc.p.length === 1 && sc.p[0][2] === 'Padaria <b>X</b>', JSON.stringify(sc.p));
  check('terrain areas are typed (c coast, w water, s sand, g green)', sc.a.map((x) => x[0]).sort().join('') === 'cgsw', JSON.stringify(sc.a).slice(0, 200));
  check('scene JSON is compact metres around the place (north = -z)', sc.b.length === 5 && sc.b.some((x) => x[0] === 16 && x[1].length === 8 && x[1].every(Number.isFinite) && x[1][1] < 0), JSON.stringify(sc).slice(0, 160));
  check('GET wall flags the scene; unknown walls have none', !!(await (await fetch(`${os.base}/api/walls/bairro`)).json()).scene && (await fetch(`${os.base}/api/walls/nada/scene`)).status === 404 && (await fetch(`${os.base}/api/walls/__proto__/scene`)).status === 404);
  await sleep(2200);
  await setupO('antigo', { geo: { lat: -23.55, lon: -46.63 } }); // has a place but no scene (like walls made before scenes existed)
  const lz = await fetch(`${os.base}/api/walls/antigo/scene`);
  check('a wall with a place but no scene gets one on first request (once)', lz.status === 200 && (await lz.json()).b.length === 5 && (await fetch(`${os.base}/api/walls/antigo/scene`)).status === 200 && hits2.length === 2, String(hits2.length));
  check('a wall with no place has no scene', (await fetch(`${os.base}/api/walls/semlugar2/scene`)).status === 404);
  await os.stop(); fk.close(); }

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
