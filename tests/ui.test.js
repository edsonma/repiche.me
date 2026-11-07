// Browser tests: creation popup, wide wall, rotation, preview size, CSP, 3D view.
const { startServer, suite, sleep, launch } = require('./lib');
const J = { 'Content-Type': 'application/json' };

(async () => {
  const t = suite('ui');
  const { check } = t;
  const s = await startServer();
  const base = s.base;
  const b = await launch();
  const bad = [];
  const watch = (p) => {
    p.on('console', (m) => { const x = m.text(); if (/Content Security Policy|Refused to/i.test(x)) bad.push(x.slice(0, 140)); });
    p.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  };
  const val = (p, sel) => p.$eval(sel, (e) => e.value);

  // ---------- creation popup ----------
  let p = await b.newPage(); watch(p);
  await p.setViewport({ width: 1000, height: 700 });
  await p.goto(base + '/novomuro', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.modal.setup .tile');
  check('popup shown on an empty, unnamed wall', !!(await p.$('.modal.setup')));
  check('name prefilled from the URL', (await val(p, '.modal.setup input')) === 'novomuro');
  check('8 surface tiles + color dots', (await p.$$('.modal.setup .tile')).length === 8 && (await p.$$('.modal.setup .dot')).length >= 12);
  check('tile thumbnails show their texture', await p.$eval('.modal.setup .tile:nth-child(2) .thumb', (e) => getComputedStyle(e).backgroundImage !== 'none'));
  await p.click('.modal.setup .tile:nth-child(3)');
  await p.click('.modal.setup .dot:nth-child(7)');
  const col = await p.$eval('.stage', (e) => e.style.getPropertyValue('--wall'));
  check('look previews live, nothing saved yet', (await (await fetch(base + '/api/walls/novomuro')).json()).setup === false);
  await p.$eval('.modal.setup input', (e) => { e.value = 'Meu Muro Legal!'; e.dispatchEvent(new Event('input')); });
  check('name is sanitized as you type', (await val(p, '.modal.setup input')) === 'meu-muro-legal');
  await p.click('.modal.setup .btns button:first-child');
  await p.waitForFunction(() => location.pathname === '/meu-muro-legal');
  await sleep(800);
  const w = await (await fetch(base + '/api/walls/meu-muro-legal')).json();
  check('wall created with the chosen look, popup gone', w.setup && w.background.color === col && w.background.texture === 'concrete' && !(await p.$('.modal.setup')));
  await p.reload({ waitUntil: 'networkidle0' });
  check('no popup after reload, look kept', !(await p.$('.modal.setup')) && (await p.$eval('.stage', (e) => e.style.getPropertyValue('--wall'))) === col);
  check('"fundo" button is gone (look is locked)', !(await p.$$eval('.actions button', (bs) => bs.some((x) => /fundo/i.test(x.textContent)))));

  // wide wall
  const m = await p.$eval('.viewport', (v) => ({ sw: v.scrollWidth, cw: v.clientWidth, sl: v.scrollLeft }));
  check('board is very wide (10080 px) and starts centered', m.sw >= 10000 && m.sw < 11000 && Math.abs(m.sl - (m.sw - m.cw) / 2) < 2, JSON.stringify(m));
  await p.$eval('.viewport', (v) => { v.scrollLeft = 0; });
  check('can scroll to the left edge', await p.$eval('.viewport', (v) => v.scrollLeft === 0));
  check('compose bar sits below the scroll area', (await p.$eval('.compose', (e) => e.getBoundingClientRect().top)) >= (await p.$eval('.viewport', (e) => e.getBoundingClientRect().bottom)) - 1);

  // existing name -> jump
  await sleep(2200); // setup rate limit
  await p.goto(base + '/outro', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.modal.setup input');
  await p.$eval('.modal.setup input', (e) => { e.value = 'meu-muro-legal'; e.dispatchEvent(new Event('input')); });
  await p.click('.modal.setup .btns button:first-child');
  await p.waitForFunction(() => location.pathname === '/meu-muro-legal', { timeout: 5000 });
  await sleep(500);
  check('choosing a name that exists jumps to that wall', !(await p.$('.modal.setup')));
  await p.goto(base + '/zzz', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.modal.setup .btns button.secondary');
  await p.click('.modal.setup .btns button.secondary');
  check('"agora não" dismisses', !(await p.$('.modal.setup')));
  await p.goto(base + '/home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.modal.setup input');
  check('/home starts with an empty name', (await val(p, '.modal.setup input')) === '');
  await p.click('.modal.setup .btns button:first-child'); await sleep(300);
  check('empty name -> error', /Escolha/.test(await p.$eval('.modal.setup .err', (e) => e.textContent)));
  await p.close();

  // ---------- compose: preview size, rotate, 3D (phone-sized, touch) ----------
  await sleep(2200); // wall-creation rate limit
  await fetch(base + '/api/walls/lab/setup', { method: 'POST', headers: J, body: JSON.stringify({ background: { color: '#2c2c30', texture: 'concrete' } }) });
  p = await b.newPage(); watch(p);
  await p.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true });
  await p.goto(base + '/lab', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.compose input');
  await p.type('.compose > input:not([type])', 'gire');
  const setSize = (v) => p.$eval('.compose input[type=range]', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, v);
  const fs = () => p.$eval('.preview', (e) => getComputedStyle(e).fontSize);
  await setSize('14'); const f14 = await fs(); await setSize('72'); const f72 = await fs();
  check('preview font size follows the size control (14 and 72 px)', f14 === '14px' && f72 === '72px', `${f14}, ${f72}`);
  await p.tap('.compose button[type=submit]');
  await p.waitForSelector('.scribble.ghost');
  await setSize('30');
  check('ghost on the wall follows the size control', (await p.$eval('.scribble.ghost', (e) => getComputedStyle(e).fontSize)) === '30px');
  await p.$eval('.hint input[type=range]', (e) => { e.value = '90'; e.dispatchEvent(new Event('input')); });
  check('rotate slider turns the ghost', /rotate\(90deg\)/.test(await p.$eval('.scribble.ghost', (e) => e.style.transform)));
  // two-finger twist
  const cdp = await p.createCDPSession();
  const pt = (deg, id) => ({ x: 195 + 80 * Math.cos((deg * Math.PI) / 180), y: 300 + 80 * Math.sin((deg * Math.PI) / 180), id });
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await p.$eval('.hint button.secondary', (e) => e.click()); // rotation back to 0
  await send('touchStart', [pt(0, 1), pt(180, 2)]);
  for (let d = 0; d <= 45; d += 5) await send('touchMove', [pt(d, 1), pt(180 + d, 2)]);
  await send('touchEnd', []); await sleep(200);
  const rot = await p.$eval('.scribble.ghost', (e) => e.style.transform);
  check('two-finger twist rotates the ghost (~45 deg)', /rotate\((4[3-7]|45)(\.\d)?deg\)/.test(rot), rot);
  await p.tap('.compose button[type=submit]'); await sleep(900);
  const saved = (await (await fetch(base + '/api/walls/lab')).json()).posts[0];
  check('rotation and size are saved', saved && Math.abs(saved.rot - 45) <= 2 && saved.size === 30, JSON.stringify(saved && [saved.rot, saved.size]));

  // ---------- signature, "apoiar", fading ----------
  await p.$eval('.compose > input:not([type])', (e) => { e.value = ''; });
  await p.type('.compose > input:not([type])', 'com nome');
  await p.type('.sigin', 'Maria');
  await sleep(2500);
  check('signature hint says it stays forever', /fica para sempre/.test(await p.$eval('.sighint', (e) => e.textContent)));
  await p.tap('.compose button[type=submit]'); await p.waitForSelector('.scribble.ghost');
  await sleep(2500); // post rate limit
  await p.tap('.compose button[type=submit]'); await sleep(900);
  const lab = (await (await fetch(base + '/api/walls/lab')).json()).posts;
  const signed = lab.find((x) => x.text === 'com nome');
  check('signed scribble is saved with its name and never expires', signed && signed.sig === 'Maria' && signed.expiresAt === null, JSON.stringify(signed));
  check('signature is drawn under the text', (await p.$$eval('.scribble .sig', (l) => l.map((e) => e.textContent))).includes('— Maria'));
  await p.$eval('.sigin', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await p.type('.compose > input:not([type])', 'anonima');
  await p.tap('.compose button[type=submit]'); await p.waitForSelector('.scribble.ghost');
  await sleep(2500);
  await p.tap('.compose button[type=submit]'); await sleep(900);
  const anon = (await (await fetch(base + '/api/walls/lab')).json()).posts.find((x) => x.text === 'anonima');
  check('anonymous scribble gets an expiry (~7 days)', anon && anon.expiresAt > Date.now() + 6 * 86400e3 && anon.expiresAt < Date.now() + 8 * 86400e3);
  const anonEl = await p.evaluateHandle(() => [...document.querySelectorAll('.scribble')].find((e) => e.textContent.includes('anonima')));
  await p.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }), anonEl);
  await anonEl.asElement().tap(); await sleep(300);
  { const act = await p.$eval('.scribble.selected .act', (e) => e.textContent.replace(/\s+/g, ' ')); check('tapping an anonymous scribble shows time left and "apoiar"', /some em 7 d/.test(act) && /apoiar/.test(act), act); }
  await p.tap('.scribble.selected .act button'); await sleep(900);
  const sup = (await (await fetch(base + '/api/walls/lab')).json()).posts.find((x) => x.text === 'anonima');
  check('"apoiar" adds a day and cannot be repeated', sup.sup === 1 && sup.expiresAt - anon.expiresAt === 86400e3 && await p.$eval('.scribble.selected .act button', (e) => e.disabled));

  // old anonymous scribbles fade, expired ones vanish, signed ones stay
  const now = Date.now(), D = 86400e3;
  const mk = (id, text, age, extra = {}) => ({ id, text, font: 'Permanent Marker', color: '#ffffff', size: 28, bold: false, x: 20 + id * 5, y: 100 + id * 40, rot: 0, createdAt: now - age, ...extra });
  const s2 = await startServer({ seed: { rules: 1, boardW: 10080, walls: { velho: { slug: 'velho', background: { color: '#2c2c30', texture: 'concrete' }, setup: true, createdAt: now - 20 * D, posts: [
    mk(1, 'novinha', 1 * D), mk(2, 'quase sumindo', 6.5 * D), mk(3, 'ja sumiu', 8 * D), mk(4, 'assinada antiga', 30 * D, { sig: 'Zé' }) ] } } } });
  const q = await b.newPage(); watch(q);
  await q.setViewport({ width: 1000, height: 700 });
  await q.goto(s2.base + '/velho', { waitUntil: 'networkidle0' });
  const ops = await q.$$eval('.scribble:not(.ghost)', (l) => Object.fromEntries(l.map((e) => [e.querySelector('.txt').textContent, +e.style.opacity])));
  check('expired anonymous scribble is gone, the rest remain', !('ja sumiu' in ops) && 'novinha' in ops && 'quase sumindo' in ops && 'assinada antiga' in ops, JSON.stringify(ops));
  check('fresh and signed are fully opaque; the dying one is faint', ops.novinha === 1 && ops['assinada antiga'] === 1 && ops['quase sumindo'] < 0.5 && ops['quase sumindo'] >= 0.15, JSON.stringify(ops));
  await q.close(); await s2.stop();

  // ---------- place + map ----------
  await sleep(2300);
  const ctx = b.defaultBrowserContext();
  await ctx.overridePermissions(base, ['geolocation']);
  const g = await b.newPage(); watch(g);
  await g.setViewport({ width: 1000, height: 800 });
  await g.setGeolocation({ latitude: -22.9068, longitude: -43.1729 });
  await g.goto(base + '/praia', { waitUntil: 'domcontentloaded' });
  await g.waitForSelector('.modal.setup .placebox button');
  check('place is optional and nothing is asked before the click', !(await g.$('.placebox input')));
  await g.click('.placebox button');
  await g.waitForSelector('.placebox input');
  check('"Usar minha localização" shows the point (~10 m)', /-22\.9068, -43\.1729/.test(await g.$eval('.placebox small', (e) => e.textContent)));
  // choose the exact point on the map instead
  await g.$$eval('.placebox a', (l) => l.find((a) => /mudar no mapa/.test(a.textContent)).click());
  await g.waitForSelector('.mapmodal .leaflet-container', { timeout: 15000 });
  check('picking mode: the map asks for a point and the button waits', /Escolha o lugar/.test(await g.$eval('.mapmodal h2', (e) => e.textContent)) && await g.$eval('.usepick', (e) => e.disabled));
  const mb = await (await g.$('.mapmodal .leaflet-container')).boundingBox();
  await g.mouse.click(mb.x + mb.width / 2 + 40, mb.y + mb.height / 2 + 30); await sleep(300);
  check('tapping the map picks a point', !(await g.$eval('.usepick', (e) => e.disabled)));
  await g.click('.usepick'); await sleep(300);
  check('"Usar este ponto" returns to the form with the new point', !(await g.$('.mapmodal')) && /Ponto -22\.9\d+, -43\.17\d+/.test(await g.$eval('.placebox small', (e) => e.textContent)));
  await g.type('.placebox input', 'Copacabana');
  await g.click('.modal.setup .btns button:first-child');
  await g.waitForSelector('.wall-name small');
  await sleep(500);
  check('wall name shows the place', /Copacabana/.test(await g.$eval('.wall-name', (e) => e.textContent)));
  await g.click('.actions button.outline'); // "mapa"
  await g.waitForSelector('.mapmodal .leaflet-container', { timeout: 15000 });
  await g.waitForSelector('.mapmodal .wallpin', { timeout: 10000 });
  check('map opens (Leaflet from our own server) with a pin for the wall', (await g.$$('.mapmodal .wallpin')).length === 1);
  await g.click('.mapmodal .wallpin');
  await g.waitForSelector('.leaflet-popup a');
  check('pin popup links to the wall and shows the place', /Copacabana/.test(await g.$eval('.leaflet-popup', (e) => e.textContent)) && (await g.$eval('.leaflet-popup a', (a) => a.getAttribute('href'))) === '/praia');
  await g.click('.maptabs button:last-child'); await sleep(500);
  check('"Satélite" switches the map to satellite tiles (and the choice is remembered)', (await g.$$eval('.mapmodal .leaflet-tile-pane img', (l) => l.some((i) => /arcgisonline/.test(i.src)))) && (await g.evaluate(() => localStorage.getItem('repiche.mapkind'))) === 'sat');
  await g.click('.maptabs button:first-child'); await sleep(500);
  check('"Mapa" switches back to street tiles', await g.$$eval('.mapmodal .leaflet-tile-pane img', (l) => l.some((i) => /openstreetmap/.test(i.src))));
  check('pin popup offers "Ir ao 3D"', !!(await g.$('.leaflet-popup .pin3d')));
  const glG = await g.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } });
  if (glG) {
    await g.click('.leaflet-popup .pin3d');
    await g.waitForSelector('.v3d canvas', { timeout: 30000 });
    check('"Ir ao 3D" closes the map and opens the 3D view of that wall', !(await g.$('.mapmodal')) && !!(await g.$('.v3d')));
    await g.click('.v3d-close'); await sleep(300);
  } else { await g.click('.mapmodal .close'); }
  await g.close();

  // ---------- modo clássico ----------
  const cp = await b.newPage(); watch(cp);
  await cp.setViewport({ width: 1000, height: 700 });
  await cp.goto(base + '/lab', { waitUntil: 'networkidle0' });
  check('modern look by default', !(await cp.$('.stage.classic')));
  await cp.$$eval('.actions button', (bs) => bs.find((x) => /clássico/.test(x.textContent)).click());
  await sleep(200);
  check('"clássico" switches the page chrome to the flat look', !!(await cp.$('.stage.classic')) && (await cp.$eval('.topbar', (e) => getComputedStyle(e).backgroundColor)) === 'rgb(59, 89, 152)');
  check('the wall itself is untouched (scribbles still there)', (await cp.$$('.scribble:not(.ghost)')).length >= 3);
  await cp.reload({ waitUntil: 'networkidle0' });
  check('choice is remembered after reload', !!(await cp.$('.stage.classic')) && (await cp.$$eval('.actions button', (bs) => bs.some((x) => /moderno/.test(x.textContent)))));
  await cp.$$eval('.actions button', (bs) => bs.find((x) => /moderno/.test(x.textContent)).click()); await sleep(200);
  check('"moderno" goes back', !(await cp.$('.stage.classic')));
  await cp.close();

  // ---------- OSM street scene in 3D ----------
  { const http = require('http');
  const fk = http.createServer((rq, rs) => {
    rq.resume(); rq.on('end', () => {
      const g = (pts) => pts.map(([la, lo]) => ({ lat: -23.55 + la, lon: -46.63 + lo }));
      rs.setHeader('Content-Type', 'application/json');
      rs.end(JSON.stringify({ elements: [
        { type: 'way', tags: { building: 'yes', height: '12' }, geometry: g([[0.0012, -0.0006], [0.0012, 0.0000], [0.0018, 0.0000], [0.0018, -0.0006]]) },
        { type: 'way', tags: { building: 'house' }, geometry: g([[0.0014, 0.0006], [0.0014, 0.0011], [0.0019, 0.0011], [0.0019, 0.0006]]) },
        { type: 'way', tags: { highway: 'residential' }, geometry: g([[0.0008, -0.0015], [0.0008, 0.0015]]) },
        { type: 'way', tags: { natural: 'coastline' }, geometry: g([[0.0030, -0.0020], [0.0030, 0.0], [0.0030, 0.0020]]) },
        { type: 'way', tags: { natural: 'beach' }, geometry: g([[0.0024, 0.0], [0.0024, 0.0008], [0.0029, 0.0008], [0.0029, 0.0]]) },
      ] }));
    });
  });
  await new Promise((ok) => fk.listen(0, ok));
  const so = await startServer({ env: { OVERPASS_API: `http://localhost:${fk.address().port}/x` } });
  await fetch(so.base + '/api/walls/centro/setup', { method: 'POST', headers: J, body: JSON.stringify({ background: { color: '#2c2c30', texture: 'concrete' }, geo: { lat: -23.55, lon: -46.63, place: 'Centro' }, scene: true }) });
  const o3 = await b.newPage(); watch(o3);
  await o3.setViewport({ width: 1000, height: 700 });
  await sleep(2300);
  await fetch(so.base + '/api/walls/norte/setup', { method: 'POST', headers: J, body: JSON.stringify({ background: { color: '#2c2c30', texture: 'concrete' }, geo: { lat: -23.50, lon: -46.63, place: 'Norte' } }) });
  await o3.goto(so.base + '/centro', { waitUntil: 'networkidle0' });
  const gl2 = await o3.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } });
  if (gl2) {
    await o3.click('.icon3d');
    await o3.waitForSelector('.v3d canvas', { timeout: 30000 });
    await sleep(3000);
    const cityInfo = await o3.$eval('.v3d', (e) => e.dataset.city);
    check('3D draws the OSM buildings and roads around the wall', /^2,\d+$/.test(cityInfo) && +cityInfo.split(',')[1] >= 1, cityInfo);
    await o3.click('.v3d-turn'); await sleep(500);
    const yaw = +(await o3.$eval('.v3d', (e) => e.dataset.view)).split(',')[2];
    check('"Ver a rua" turns you around to face the street; the button then offers the wall', Math.abs(Math.abs(yaw) - Math.PI) < 0.05 && /muro/.test(await o3.$eval('.v3d-turn', (e) => e.textContent)), String(yaw));
    if (process.env.SHOT) await o3.screenshot({ path: process.env.SHOT });
    await o3.click('.v3d-turn'); await sleep(300);
    check('...and back to the wall', Math.abs(+(await o3.$eval('.v3d', (e) => e.dataset.view)).split(',')[2]) < 0.05);
    check('the map is turned so the wall stands parallel to a real street', (await o3.$eval('.v3d', (e) => e.dataset.aligned)) === '1');
    check('sea, sand and park shapes from the map are drawn (not just grass)', +(await o3.$eval('.v3d', (e) => e.dataset.terrain)) >= 10, await o3.$eval('.v3d', (e) => e.dataset.terrain));
    check('OpenStreetMap credit is shown in 3D', /OpenStreetMap/.test(await o3.$eval('.v3d-osm', (e) => e.textContent)));
    check('radar lists the other wall that has a place', (await o3.$eval('.v3d', (e) => e.dataset.radar)) === '1');
    { const r = await o3.$eval('.v3d-radar', (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y }; });
      await o3.mouse.click(r.x + 60, r.y + 75); await sleep(400); // the other wall is ~5.5 km north: straight behind you here
      const info = await o3.$eval('.v3d-radarinfo', (e) => ({ hidden: e.hidden, t: e.textContent }));
      check('tapping a radar dot shows the wall, its place and distance, with a button', !info.hidden && /\/norte · Norte/.test(info.t) && /5\.[0-9] km/.test(info.t) && /Ir para este muro/.test(info.t), info.t);
      await o3.click('.v3d-radarinfo button');
      await o3.waitForFunction(() => location.pathname === '/norte', { timeout: 10000 });
      await o3.waitForSelector('.v3d canvas', { timeout: 30000 });
      check('"Ir para este muro" goes to that wall and opens its 3D view', (await o3.title()).startsWith('/norte') && !!(await o3.$('.v3d')));
      await o3.click('.v3d-close'); await sleep(300); }
    check('3D with a scene: no CSP violations or page errors', bad.length === 0, bad.join(' | '));
  } else console.log('SKIP  OSM scene 3D: no WebGL');
  await o3.close(); await so.stop(); fk.close(); }

  // ---------- 3D (skipped where the browser has no WebGL) ----------
  const hasGL = await p.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl'); } catch { return false; } });
  if (!hasGL) { console.log('SKIP  3D checks: no WebGL in this browser'); }
  else {
  await p.tap('.icon3d');
  await p.waitForSelector('.v3d canvas', { timeout: 30000 });
  await sleep(4000);
  check('3D view opens and renders a canvas', await p.$eval('.v3d canvas', (c) => c.width > 0 && c.height > 0));
  check('a wall with no place still gets a street (generic town), not the old empty field', +(await p.$eval('.v3d', (e) => e.dataset.city)).toString().split(',')[0] > 10 && !(await p.$('.v3d-osm')));
  check('3D opened without CSP violations or page errors', bad.length === 0, bad.join(' | '));
  // touch controls: joystick on the left, free look on the right, Minecraft directions
  const view = () => p.$eval('.v3d', (e) => e.dataset.view.split(',').map(Number)); // x, z, yaw, pitch
  check('touch: joystick + jump button shown, old arrow pad gone', !!(await p.$('.v3d-joy')) && !!(await p.$('.v3d-jump')) && !(await p.$('.v3d-pad')));
  const jb = await (await p.$('.v3d-joy')).boundingBox();
  const jc = { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 };
  const v0 = await view();
  await send('touchStart', [{ x: jc.x, y: jc.y, id: 7 }]);
  await send('touchMove', [{ x: jc.x, y: jc.y - 40, id: 7 }]);
  await sleep(1200);
  const knobMoved = await p.$eval('.v3d-joy .knob', (e) => e.style.transform);
  await send('touchEnd', []); await sleep(400);
  const v1 = await view();
  check('joystick up walks forward (toward the wall)', v1[1] < v0[1] - 0.8 && Math.abs(v1[0] - v0[0]) < 0.2 && /translate/.test(knobMoved), JSON.stringify([v0[1], v1[1]]));
  // the lost visitor: talk button appears when close, question bubble, 4 answers, big window with the team
  const talkBtn = await p.$('.v3d-talk');
  check('"Falar com ele" appears when you are close to him', !(await talkBtn.evaluate((e) => e.hidden)));
  await talkBtn.tap(); await sleep(300);
  const bub = await p.$eval('.v3d-bubble', (e) => ({ hidden: e.hidden, q: e.querySelector('.q')?.textContent, opts: [...e.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()) }));
  check('speech bubble asks where the original gang is', !bub.hidden && /Onde está a galera original do piche\.me/.test(bub.q));
  check('4 answers: brigaram / cada um / moram juntos / nenhuma', bub.opts.length === 4 && /^1 Brigaram/.test(bub.opts[0]) && /^2 Cada um foi resolver sua vida/.test(bub.opts[1]) && /^3 Moram juntos/.test(bub.opts[2]) && /^4 Nenhuma das anteriores/.test(bub.opts[3]), JSON.stringify(bub.opts));
  const vt0 = await view();
  await send('touchStart', [{ x: jc.x, y: jc.y, id: 5 }]); await send('touchMove', [{ x: jc.x, y: jc.y - 45, id: 5 }]); await sleep(500); await send('touchEnd', []);
  check('you stand still while talking', Math.abs((await view())[1] - vt0[1]) < 0.05);
  await (await p.$('.v3d-bubble button[data-i="1"]')).tap(); await sleep(300);
  const card = await p.$eval('.v3d-cardwrap', (e) => ({ hidden: e.hidden, text: e.textContent, links: [...e.querySelectorAll('a')].map((a) => [a.target, a.rel]) }));
  check('answering opens the big window with all 6 members', !card.hidden && ['Túlio Ornelas', 'Wesley Rocha', 'Renan', 'Karina Macedo', 'Rodrigo Ramalho', 'Celio Latorraca'].every((n) => card.text.includes(n)));
  check('big window gives sources, links open safely in a new tab', /Fonte: Correio Braziliense/.test(card.text) && card.links.length === 3 && card.links.every(([t, r]) => t === '_blank' && /noopener/.test(r)));
  check('bubble is gone while the big window is open', await p.$eval('.v3d-bubble', (e) => e.hidden));
  await (await p.$('.closecard')).tap(); await sleep(300);
  check('closing returns to the 3D view; the talk button is back', (await p.$eval('.v3d-cardwrap', (e) => e.hidden)) && !(await p.$eval('.v3d-talk', (e) => e.hidden)));
  await talkBtn.tap(); await sleep(200); await p.keyboard.press('Escape'); await sleep(200);
  check('Esc closes the conversation, not the 3D view', (await p.$eval('.v3d-bubble', (e) => e.hidden)) && !!(await p.$('.v3d')));
  // free walking: all over the street, but the wall itself is solid
  await send('touchStart', [{ x: jc.x, y: jc.y, id: 8 }]); await send('touchMove', [{ x: jc.x, y: jc.y - 45, id: 8 }]);
  await sleep(9000); await send('touchEnd', []); await sleep(300);
  const vw = await view();
  check('walking into the wall stops at the wall (does not pass through)', vw[1] > 0.4 && vw[1] < 2, JSON.stringify(vw));
  // now walk away from the wall, past the old 13 m limit
  await send('touchStart', [{ x: jc.x, y: jc.y, id: 9 }]); await send('touchMove', [{ x: jc.x, y: jc.y + 45, id: 9 }]);
  await sleep(9000); await send('touchEnd', []); await sleep(300);
  check('you can walk away over the street, beyond the old 13 m limit', (await view())[1] > 14, JSON.stringify(await view()));
  await send('touchStart', [{ x: jc.x, y: jc.y, id: 8 }]);
  await send('touchMove', [{ x: jc.x + 45, y: jc.y, id: 8 }]);
  await sleep(900); await send('touchEnd', []); await sleep(400);
  const v2 = await view();
  check('joystick right strafes right', v2[0] > v1[0] + 0.6, JSON.stringify([v1[0], v2[0]]));
  await send('touchStart', [{ x: 280, y: 400, id: 9 }]);
  for (let i = 1; i <= 8; i++) await send('touchMove', [{ x: 280 + i * 12, y: 400 - i * 8, id: 9 }]);
  await send('touchEnd', []); await sleep(300);
  const v3 = await view();
  check('drag right on the right side = look right (yaw decreases)', v3[2] < v2[2] - 0.3, JSON.stringify([v2[2], v3[2]]));
  check('drag up = look up (pitch increases)', v3[3] > v2[3] + 0.2, JSON.stringify([v2[3], v3[3]]));
  const mb = await p.$('.v3d-music');
  const m0 = await mb.evaluate((e) => e.textContent);
  await mb.click(); const m1 = await mb.evaluate((e) => e.textContent);
  await mb.click();
  check('music button toggles (and the music exists)', m0 !== m1 && !(await mb.evaluate((e) => e.hidden)), `${m0} -> ${m1}`);
  await p.tap('.v3d-close'); await sleep(300);
  check('3D closes', !(await p.$('.v3d')));
  }
  check('no CSP violations / page errors in the whole run', bad.length === 0, bad.join(' | '));
  await p.close(); await b.close(); await s.stop();
  process.exit(t.done() ? 1 : 0);
})();
