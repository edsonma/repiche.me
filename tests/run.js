// npm test        -> everything (needs Chrome: set CHROME_BIN if it is not /usr/bin/google-chrome)
// npm run test:api -> API + security only, no browser
const { spawnSync } = require('child_process');
const files = process.argv.includes('--api') ? ['api.test.js'] : ['api.test.js', 'ui.test.js', 'board.test.js'];
let failed = 0;
for (const f of files) {
  const r = spawnSync('node', [require('path').join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
process.exit(failed ? 1 : 0);
