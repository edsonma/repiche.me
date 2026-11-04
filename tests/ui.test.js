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

  // ---------- 3D (skipped where the browser has no WebGL) ----------
  const hasGL = await p.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl'); } catch { return false; } });
  if (!hasGL) { console.log('SKIP  3D checks: no WebGL in this browser'); }
  else {
  await p.tap('.icon3d');
  await p.waitForSelector('.v3d canvas', { timeout: 30000 });
  await sleep(4000);
  check('3D view opens and renders a canvas', await p.$eval('.v3d canvas', (c) => c.width > 0 && c.height > 0));
  check('3D opened without CSP violations or page errors', bad.length === 0, bad.join(' | '));
  await p.tap('.v3d-close'); await sleep(300);
  check('3D closes', !(await p.$('.v3d')));
  }
  check('no CSP violations / page errors in the whole run', bad.length === 0, bad.join(' | '));
  await p.close(); await b.close(); await s.stop();
  process.exit(t.done() ? 1 : 0);
})();
