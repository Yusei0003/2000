/** docs/manual/マニュアル.html から docs/日直勤務表アプリ_操作マニュアル.pdf を生成する。
 *
 *  使い方： node docs/manual/build_manual.js
 *  必要なもの：Playwright（Chromium）と日本語フォント（IPAゴシック等）
 *
 *  画面キャプチャ（docs/manual/images/）の撮り直しは shots.js を参照。
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, 'マニュアル.html');
const OUT = path.join(__dirname, '..', '日直勤務表アプリ_操作マニュアル.pdf');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('requestfailed', (r) => errs.push('読み込めません: ' + r.url()));

  await page.goto('file://' + SRC, { waitUntil: 'networkidle' });
  // 画像がすべて読み込まれてからPDF化する
  const broken = await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
    return imgs.filter((im) => !im.naturalWidth).map((im) => im.getAttribute('src'));
  });
  if (broken.length) errs.push('画像が表示できません: ' + broken.join(', '));

  await page.pdf({
    path: OUT,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#8a94a6;padding:0 15mm;' +
      'font-family:sans-serif;display:flex;justify-content:space-between;">' +
      '<span>日直勤務表 自動作成アプリ 操作マニュアル</span>' +
      '<span class="pageNumber"></span></div>',
    margin: { top: '16mm', right: '15mm', bottom: '18mm', left: '15mm' },
  });
  await browser.close();

  if (errs.length) {
    console.error('NG:\n' + errs.join('\n'));
    process.exit(1);
  }
  console.log('生成しました:', OUT, fs.statSync(OUT).size, 'bytes');
})();
