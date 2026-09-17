/** docs/manual/申請手順.html から docs/日直勤務変更_申請手順.pdf を生成する。
 *
 *  使い方： node docs/manual/build_apply.js
 *
 *  Garoonの画面キャプチャは docs/manual/images/garoon/ に次の名前で置く：
 *    garoon1.png … ワークフロー（最新一覧）
 *    garoon2.png … 申請フォームの選択（カテゴリー一覧）
 *    garoon3.png … 申請フォームの選択（人事関連）
 *    garoon4.png … 申請の作成（内容の入力）
 *    garoon5.png … 申請の作成（経路の設定）
 *    garoon6.png … 申請の作成（内容の確認）
 *  .png / .jpg / .jpeg のいずれでも読み込む。置いていないものは
 *  差し替え用の枠のまま出力され、最後に不足分を一覧で知らせる。
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const SRC = path.join(DIR, '申請手順.html');
const IMGDIR = path.join(DIR, 'images', 'garoon');
const OUT = path.join(DIR, '..', '日直勤務変更_申請手順.pdf');
const TMP = path.join(DIR, '.申請手順.build.html');

/** images/garoon/ から <name>.png 等を探す。無ければ null。 */
function findImage(name) {
  for (const ext of ['.png', '.PNG', '.jpg', '.jpeg', '.JPG']) {
    const p = path.join(IMGDIR, name + ext);
    if (fs.existsSync(p)) return 'images/garoon/' + name + ext;
  }
  return null;
}

(async () => {
  let html = fs.readFileSync(SRC, 'utf8');
  const missing = [];
  // <!--IMG:name--> と、その直後の差し替え用の枠を、画像があれば <img> に置き換える
  html = html.replace(
    /<!--IMG:([\w-]+)-->\s*<div class="slot">[\s\S]*?<\/div>/g,
    (whole, name) => {
      const src = findImage(name);
      if (!src) { missing.push(name); return whole; }
      return `<img src="${src}" alt="${name}">`;
    }
  );
  fs.writeFileSync(TMP, html, 'utf8');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file://' + TMP, { waitUntil: 'networkidle' });
  const broken = await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
    return imgs.filter((im) => !im.naturalWidth).map((im) => im.getAttribute('src'));
  });
  if (broken.length) errs.push('画像が表示できません: ' + broken.join(', '));

  await page.pdf({
    path: OUT, format: 'A4', landscape: true, printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await browser.close();
  fs.unlinkSync(TMP);

  if (errs.length) { console.error('NG:\n' + errs.join('\n')); process.exit(1); }
  console.log('生成しました:', OUT, fs.statSync(OUT).size, 'bytes');
  if (missing.length) {
    console.log('\n※ 画面キャプチャが未配置です（枠のまま出力しました）:');
    missing.forEach((m) => console.log(`   docs/manual/images/garoon/${m}.png`));
  } else {
    console.log('画面キャプチャはすべて配置済みです。');
  }
})();
