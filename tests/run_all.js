/** すべてのテストを順に実行する。
 *
 *    node tests/run_all.js
 *
 *  ブラウザを使うテストのため、ポート8899でアプリを自動で配信し、終わったら止める
 *  （既に8899で配信中ならそれを使う）。1本でも失敗すれば終了コード1で終わる。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ROOT, PORT } = require('./helpers');

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/index.html`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  let server = null;
  if (!(await ping())) {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 30 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 200));
    if (!(await ping())) { console.error(`ポート${PORT}でアプリを配信できませんでした`); process.exit(1); }
  }

  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
  const failed = [];
  for (const f of files) {
    const t0 = Date.now();
    const r = spawnSync('node', [path.join(__dirname, f)], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.status === 0) {
      console.log(`✓ ${f.padEnd(28)} ${sec}s`);
    } else {
      failed.push(f);
      console.log(`✗ ${f.padEnd(28)} ${sec}s`);
      console.log(out.split('\n').map((l) => '    ' + l).join('\n'));
    }
  }

  if (server) server.kill();
  console.log(`\n${files.length - failed.length} / ${files.length} 件成功`);
  process.exit(failed.length ? 1 : 0);
})();
