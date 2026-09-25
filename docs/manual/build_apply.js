/** docs/manual/申請手順.html から docs/日直勤務変更_申請手順.pdf を生成する。
 *
 *  使い方：
 *    python3 docs/manual/annotate.py   … キャプチャに矢印等を焼き込む（先に実行）
 *    node docs/manual/build_apply.js   … PDFを作る
 *
 *  画面キャプチャは docs/manual/images/garoon/ に置く。
 *    garoon1.png … ワークフロー（最新一覧）
 *    garoon2.png … 申請フォームの選択（カテゴリー一覧／切り出し済み）
 *    garoon3.png … 申請フォームの選択（人事関連／切り出し済み）
 *    garoon4.png … 申請の作成（内容の入力）
 *    garoon5.png … 申請の作成（経路の設定）
 *    garoon6.png … 申請の作成（内容の確認）
 *  annotate.py が、これらから step1〜step5 を作る。HTMLが読むのは step* のほう。
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '申請手順.html');
const OUT = path.join(__dirname, '..', '日直勤務変更_申請手順.pdf');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file://' + SRC, { waitUntil: 'networkidle' });
  const broken = await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
    return imgs.filter((im) => !im.naturalWidth).map((im) => im.getAttribute('src'));
  });
  if (broken.length) errs.push('画像が表示できません: ' + broken.join(', '));

  // 元資料と同じ 16:9
  await page.pdf({
    path: OUT, width: '297mm', height: '167mm', printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await browser.close();

  if (errs.length) { console.error('NG:\n' + errs.join('\n')); process.exit(1); }
  console.log('生成しました:', OUT, fs.statSync(OUT).size, 'bytes');
})();
