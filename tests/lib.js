// Shared helpers: start the real server on a free port with a throwaway data dir, tiny assertion helper.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer({ seed, env = {}, dir } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'repiche-test-'));
  if (seed) fs.writeFileSync(path.join(dir, 'db.json'), typeof seed === 'string' ? seed : JSON.stringify(seed));
  const port = await freePort();
  const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir, PORT: String(port), ...env }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch { /* not up yet */ } await sleep(100); }
  return {
    base, dir, port,
    stop: async () => { proc.kill('SIGTERM'); await sleep(500); },
  };
}

function suite(name) {
  let fails = 0, n = 0;
  console.log(`\n== ${name} ==`);
  return {
    check(label, ok, extra = '') { n++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : '')); if (!ok) fails++; },
    done() { console.log(fails ? `${fails} FAILED of ${n}` : `all ${n} passed`); return fails; },
  };
}

const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const launch = () => require('puppeteer-core').launch({
  executablePath: CHROME, protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

module.exports = { startServer, suite, sleep, launch, CHROME };
