// Board tests: scribble positions, placing/dragging, zoom, phone layout + touch.
const fs = require('fs'), os = require('os'), path = require('path');
const { startServer, launch } = require('./lib');
let base;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'repiche-shots-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, n = 0, ipn = 0;
const check = (name, ok, extra = '') => { n++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const J = { 'Content-Type': 'application/json' };
const api = async (path, body) => (await fetch(base + path, body ? { method: 'POST', headers: { ...J, 'X-Forwarded-For': `10.6.1.${++ipn}` }, body: JSON.stringify(body) } : undefined)).json();
const errors = [];

(async () => {
  const srv = await startServer(); base = srv.base;
  // ---- seed a wall with known positions ----
  const seeds = [
    ['p1', 0, 40, 30], ['p2', 100, 80, 36], ['p3', 25, 160, 44], ['p4', 75, 260, 28], ['centro', 50, 400, 48],
    ['p6', 10, 520, 32], ['p7', 90, 640, 40], ['p8', 60, 760, 26], ['p9', 33, 880, 52], ['p10', 5, 1000, 30],
  ];
  for (const [text, x, y, size] of seeds) await api('/api/walls/ui/posts', { text, font: 'Bangers', color: '#ffffff', size, bold: true, x, y, rot: (x % 9) - 4 });

  const b = await launch();
  const open = async (viewport) => {
    const p = await b.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
    await p.setViewport(viewport);
    await p.goto(base + '/ui', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.scribble'); await sleep(500);
    return p;
  };
  const geom = (p) => p.evaluate(() => {
    const wall = document.querySelector('.wall'), wr = wall.getBoundingClientRect();
    return {
      z: wr.width / wall.offsetWidth, wallLeft: wr.left, wallTop: wr.top, baseW: wall.offsetWidth,
      items: [...document.querySelectorAll('.scribble:not(.ghost)')].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, w: el.offsetWidth, h: el.offsetHeight };
      }),
    };
  });
  // where each scribble SHOULD be on screen according to the saved (x, y)
  const deviation = (g, posts) => {
    let worst = 0;
    posts.forEach((post, i) => {
      const it = g.items[i];
      const cx = g.wallLeft + ((post.x / 100) * (g.baseW - it.w) + it.w / 2) * g.z;
      const cy = g.wallTop + (post.y + it.h / 2) * g.z;
      worst = Math.max(worst, Math.abs(cx - it.cx), Math.abs(cy - it.cy));
    });
    return worst;
  };
  const ghostCenter = (p) => p.evaluate(() => { const r = document.querySelector('.scribble.ghost').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; });
  const dragMouse = async (p, tx, ty) => {
    const c = await ghostCenter(p);
    await p.mouse.move(c.x, c.y); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(c.x + ((tx - c.x) * i) / 10, c.y + ((ty - c.y) * i) / 10);
    await p.mouse.up(); await sleep(120);
  };
  const submitBtn = (p) => p.evaluate(() => document.querySelector('.compose button[type=submit]').textContent.trim());
  const clickSubmit = async (p) => { await p.evaluate(() => document.querySelector('.compose button[type=submit]').click()); await sleep(150); };
  const typeText = async (p, t) => { await p.click('.compose > input:not([type])'); await p.keyboard.type(t); };
  const total = async () => (await api('/api/walls/ui')).total;
  const commit = async (p) => {
    await p.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.6.2.${++ipn}` });
    await clickSubmit(p);
    await p.waitForFunction(() => !document.querySelector('.scribble.ghost'), { timeout: 4000 }); await sleep(150);
  };

  // ================= desktop =================
  const p = await open({ width: 1200, height: 800 });
  const p2 = await open({ width: 1200, height: 800 }); // "another visitor"
  await p.bringToFront();
  let posts = (await api('/api/walls/ui')).posts;
  let g = await geom(p);
  check('wall shows all seeded scribbles', g.items.length === 10, String(g.items.length));
  check('scribbles are drawn at their saved x/y', deviation(g, posts) < 1.5, `max off ${deviation(g, posts).toFixed(2)}px`);

  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.scribble'); await sleep(500);
  const g1 = await geom(p);
  const shift = Math.max(...g1.items.map((it, i) => Math.max(Math.abs(it.cx - g.items[i].cx), Math.abs(it.cy - g.items[i].cy))));
  check('after reload every scribble is exactly where it was', shift < 0.5, `max shift ${shift.toFixed(3)}px`);

  // empty text
  await clickSubmit(p);
  check('"Pichar" with no text shows an error and no ghost', (await p.evaluate(() => !document.querySelector('.scribble.ghost') && document.querySelector('.error').textContent)) === 'Escreva algo!');

  // placing
  await typeText(p, 'olá mundo');
  await clickSubmit(p);
  check('after "Pichar" a ghost appears, nothing saved yet', (await p.$('.scribble.ghost')) !== null && (await total()) === 10, `total ${await total()}`);
  check('button becomes "Fixar aqui"', (await submitBtn(p)) === 'Fixar aqui');
  check('ghost shows the typed text', (await p.evaluate(() => document.querySelector('.scribble.ghost').textContent)) === 'olá mundo');
  await p.screenshot({ path: out + '/d-placing.png' });

  await dragMouse(p, 420, 300);
  let c = await ghostCenter(p);
  check('ghost can be dragged (1st move)', near(c.x, 420, 3) && near(c.y, 300, 3), `${Math.round(c.x)},${Math.round(c.y)}`);
  await dragMouse(p, 760, 250);
  c = await ghostCenter(p);
  check('...and moved again before fixing (2nd move)', near(c.x, 760, 3) && near(c.y, 250, 3), `${Math.round(c.x)},${Math.round(c.y)}`);
  check('still nothing saved while moving', (await total()) === 10);

  await commit(p);
  const t = await total();
  posts = (await api('/api/walls/ui')).posts;
  g = await geom(p);
  const mine = g.items[g.items.length - 1];
  check('"Fixar aqui" saves it', t === 11 && posts[posts.length - 1].text === 'olá mundo', `total ${t}`);
  check('it stays exactly where it was dropped', near(mine.cx, 760, 3) && near(mine.cy, 250, 3), `${Math.round(mine.cx)},${Math.round(mine.cy)}`);
  check('saved x/y reproduce that spot', deviation(g, posts) < 1.5, `${deviation(g, posts).toFixed(2)}px`);
  check('ghost gone and input cleared', await p.evaluate(() => !document.querySelector('.scribble.ghost') && document.querySelector('.compose > input:not([type])').value === ''));

  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.scribble'); await sleep(500);
  g = await geom(p);
  const mine2 = g.items[g.items.length - 1];
  check('reload keeps the dropped position', near(mine2.cx, 760, 3) && near(mine2.cy, 250, 3), `${Math.round(mine2.cx)},${Math.round(mine2.cy)}`);

  // another visitor sees it in the same place
  await sleep(5500);
  const g2 = await geom(p2);
  const theirs = g2.items.find((it) => it.text === 'olá mundo');
  check('another visitor sees it at the same spot', !!theirs && near(theirs.cx, 760, 3) && near(theirs.cy, 250, 3), theirs ? `${Math.round(theirs.cx)},${Math.round(theirs.cy)}` : 'missing');
  await p2.close();
  await p.bringToFront();

  // cancel
  await typeText(p, 'cancelar');
  await clickSubmit(p);
  await p.evaluate(() => document.querySelector('.compose button.secondary').click()); await sleep(150);
  check('"Cancelar" discards the ghost without saving', (await p.$('.scribble.ghost')) === null && (await total()) === 11);

  // ---- place while zoomed out, verify it lands where dropped and keeps the real coordinates ----
  for (let i = 0; i < 3; i++) { await p.click('.zoombar button:nth-child(3)'); await sleep(40); }
  await sleep(200);
  const zl = await p.$eval('.zoombar .pct', (e) => e.textContent);
  await p.evaluate(() => { document.querySelector('.compose > input:not([type])').value = ''; });
  await p.click('.compose > input:not([type])', { clickCount: 3 }); await p.keyboard.press('Backspace');
  await typeText(p, 'zoomado');
  await clickSubmit(p);
  await dragMouse(p, 500, 280);
  await commit(p);
  g = await geom(p);
  const zi = g.items[g.items.length - 1];
  check(`placing while zoomed to ${zl} lands where dropped`, g.z < 0.6 && near(zi.cx, 500, 3) && near(zi.cy, 280, 3), `z=${g.z.toFixed(2)} at ${Math.round(zi.cx)},${Math.round(zi.cy)}`);
  posts = (await api('/api/walls/ui')).posts;
  check('saved coordinates are zoom-independent (match at this zoom)', deviation(g, posts) < 1.5, `${deviation(g, posts).toFixed(2)}px`);
  await p.click('.zoombar button.pct'); await sleep(250);
  g = await geom(p);
  check('and at 100% the same coordinates match too', g.z === 1 && deviation(g, posts) < 1.5, `${deviation(g, posts).toFixed(2)}px`);

  // ---- zoom limits & behavior ----
  for (let i = 0; i < 12; i++) { await p.click('.zoombar button:nth-child(1)'); await sleep(30); }
  await sleep(200);
  let z = await p.evaluate(() => ({ label: document.querySelector('.zoombar .pct').textContent, plusOff: document.querySelector('.zoombar button').disabled,
    sw: document.querySelector('.viewport').scrollWidth, cw: document.querySelector('.viewport').clientWidth, docW: document.documentElement.scrollWidth, innerW: innerWidth }));
  check('zoom in stops at 300%', z.label === '300%' && z.plusOff, z.label);
  check('zoomed in you can pan sideways inside the wall', z.sw > z.cw, `${z.sw}>${z.cw}`);
  check('page itself never overflows', z.docW <= z.innerW, `${z.docW}/${z.innerW}`);
  await p.click('.zoombar button.pct'); await sleep(250);

  // ctrl+wheel keeps the point under the cursor fixed
  g = await geom(p);
  const centro = g.items.find((it) => it.text === 'centro');
  await p.mouse.move(centro.cx, centro.cy);
  await p.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await p.mouse.wheel({ deltaY: -200 });
  await p.keyboard.up('Control'); await sleep(300);
  g = await geom(p);
  const centro2 = g.items.find((it) => it.text === 'centro');
  check('ctrl+wheel zooms around the pointer', g.z > 1.3 && near(centro2.cx, centro.cx, 4) && near(centro2.cy, centro.cy, 4), `z=${g.z.toFixed(2)} drift ${Math.round(centro2.cx - centro.cx)},${Math.round(centro2.cy - centro.cy)}`);
  await p.click('.zoombar button.pct'); await sleep(250);

  // zoom out and out
  for (let i = 0; i < 45; i++) { await p.click('.zoombar button:nth-child(3)'); await sleep(15); }
  await sleep(300);
  z = await p.evaluate(() => ({ label: document.querySelector('.zoombar .pct').textContent, wall: !!document.querySelector('.wall'),
    n: document.querySelectorAll('.scribble').length, docW: document.documentElement.scrollWidth, innerW: innerWidth,
    cb: Math.round(document.querySelector('.compose').getBoundingClientRect().bottom), innerH: innerHeight }));
  check('zoom out keeps going down to the 0.1% floor', z.label === '0.10%' && z.wall && z.n === 12, `${z.label}, ${z.n} scribbles`);
  check('no overflow and compose bar visible at 0.1%', z.docW <= z.innerW && z.cb <= z.innerH);
  await p.click('.zoombar button.pct'); await sleep(250);
  await p.close();

  // ================= phone (touch) =================
  const m = await open({ width: 390, height: 780, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const cdp = await m.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  let ph = await m.evaluate(() => ({ docW: document.documentElement.scrollWidth, innerW: innerWidth, cb: Math.round(document.querySelector('.compose').getBoundingClientRect().bottom), innerH: innerHeight }));
  check('phone: no sideways overflow, compose bar on screen', ph.docW <= ph.innerW && ph.cb <= ph.innerH, `${ph.docW}/${ph.innerW}, ${ph.cb}/${ph.innerH}`);
  g = await geom(m);
  check('phone: scribbles drawn at their saved spots', deviation(g, (await api('/api/walls/ui')).posts) < 1.5, `${deviation(g, (await api('/api/walls/ui')).posts).toFixed(2)}px`);

  await typeText(m, 'no celular');
  await clickSubmit(m);
  await m.screenshot({ path: out + '/m-placing.png' });
  const gc = await ghostCenter(m);
  const sc0 = await m.evaluate(() => ({ top: document.querySelector('.viewport').scrollTop, left: document.querySelector('.viewport').scrollLeft }));
  await touch('touchStart', [[gc.x, gc.y]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[gc.x - 50 + 0 * i - (i * 6), gc.y + 60 - i * 12]]); await sleep(20); }
  await touch('touchEnd', []); await sleep(200);
  const gc2 = await ghostCenter(m);
  const sc = await m.evaluate(() => ({ top: document.querySelector('.viewport').scrollTop, left: document.querySelector('.viewport').scrollLeft, winY: scrollY }));
  check('phone: ghost follows a finger drag', near(gc2.x, gc.x - 110, 5) && near(gc2.y, gc.y - 60, 5), `moved ${Math.round(gc2.x - gc.x)},${Math.round(gc2.y - gc.y)} (wanted -110,-60)`);
  check('phone: dragging the ghost does not scroll the wall', sc.top === sc0.top && sc.left === sc0.left && sc.winY === 0, JSON.stringify(sc));
  await commit(m);
  g = await geom(m);
  const mm = g.items[g.items.length - 1];
  check('phone: fixed where it was dropped', mm.text === 'no celular' && near(mm.cx, gc2.x, 3) && near(mm.cy, gc2.y, 3), `${Math.round(mm.cx)},${Math.round(mm.cy)} vs ${Math.round(gc2.x)},${Math.round(gc2.y)}`);
  await m.reload({ waitUntil: 'domcontentloaded' }); await m.waitForSelector('.scribble'); await sleep(500);
  g = await geom(m);
  const mm2 = g.items.find((it) => it.text === 'no celular');
  check('phone: reload keeps it there', !!mm2 && near(mm2.cx, mm.cx, 1) && near(mm2.cy, mm.cy, 1));

  // pinch
  await touch('touchStart', [[150, 400], [240, 400]]);
  for (let i = 1; i <= 8; i++) { const d = 45 + i * 15; await touch('touchMove', [[195 - d, 400], [195 + d, 400]]); await sleep(30); }
  await touch('touchEnd', []); await sleep(300);
  let zz = await m.$eval('.zoombar .pct', (e) => e.textContent);
  check('phone: pinch out zooms in (capped at 300%)', zz === '300%', zz);
  await touch('touchStart', [[100, 400], [290, 400]]);
  for (let i = 1; i <= 10; i++) { const d = 95 - i * 9; await touch('touchMove', [[195 - d, 400], [195 + d, 400]]); await sleep(30); }
  await touch('touchEnd', []); await sleep(400);
  zz = await m.$eval('.zoombar .pct', (e) => e.textContent);
  check('phone: pinch together zooms out below 100%', parseFloat(zz) < 100, zz);
  ph = await m.evaluate(() => ({ docW: document.documentElement.scrollWidth, innerW: innerWidth, cb: Math.round(document.querySelector('.compose').getBoundingClientRect().bottom), innerH: innerHeight }));
  check('phone: still no overflow after pinching', ph.docW <= ph.innerW && ph.cb <= ph.innerH);
  await m.click('.zoombar button.pct'); await sleep(200);
  await m.screenshot({ path: out + '/m-after.png' });
  await m.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(fails ? `\n${fails} FAILED of ${n}` : `\nall ${n} passed`);
  await b.close(); await srv.stop(); process.exit(fails ? 1 : 0);
})();
