/** 「変更届による交代の一覧」のExcel・PDF書出と、反映日時の表示の検証。
 *   1. 交換は1行（日付・曜日・欄・職員番号・氏名 ←→ 日付・曜日・欄・職員番号・氏名）
 *   2. 片道の交代は2つ目の日付が「―」、交代後の職員番号・氏名が入る
 *   3. 反映日時が日本時間で出る（世界標準時のまま9時間ずれない）。画面とExcelで同じ
 *   4. PDFがA4横で書き出される
 *   5. 表示範囲が確定済み履歴の表示フィルタと連動する（範囲外なら書き出さない）
 *   6. file:// で開いた場合も書き出せる
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, openWithSeed, Check } = require('./helpers');
const { PERIOD, PERIOD_PREV, SMALL, twoDayHistory, changeText } = require('./fixtures');

async function applyTwoChanges(page) {
  // 交換（7/10 和田 ⇄ 7/11 佐藤）
  await page.click('button.change-btn[data-level="junior"][data-date="2026-07-10"]');
  await page.waitForTimeout(300);
  await page.fill('#change-text-input', changeText({ partner: '佐藤　隆', applicant: '和田　悠歴', changeDate: '2026年07月11日（土）' }));
  await page.click('#change-text-parse-btn');
  await page.waitForTimeout(400);
  await page.click('#change-confirm');
  await page.waitForTimeout(600);
  await page.click('#backup-later-btn').catch(() => {});
  await page.waitForTimeout(300);
  // 片道の交代（7/11 の1人目を髙橋さんに）
  await page.click('button.change-btn[data-level="senior"][data-date="2026-07-11"]');
  await page.waitForTimeout(300);
  await page.click('#change-manual-toggle');
  await page.waitForTimeout(200);
  await page.selectOption('#change-new-staff', 'st-S1');
  await page.fill('#change-applied-at', '2026-09-01T09:00');
  await page.click('#change-confirm');
  await page.waitForTimeout(600);
  await page.click('#backup-later-btn').catch(() => {});
  await page.waitForTimeout(300);
}

/** ボタンを押してダウンロードを受け取る。
 *  Playwright は日本語のファイル名を「download」に置き換えてしまうため、
 *  アプリが付けたファイル名は <a download> の値を横取りして確かめる。 */
async function download(page, selector, dir) {
  await page.evaluate(() => {
    if (window.__dlPatched) return;
    window.__dlPatched = true;
    // アプリは a.click()、jsPDF の保存は a.dispatchEvent(click) でダウンロードを始める
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return click.call(this); };
    const dispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (ev) {
      if (this instanceof HTMLAnchorElement && ev.type === 'click' && this.download) window.__dlName = this.download;
      return dispatch.call(this, ev);
    };
  });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const file = path.join(dir, selector.includes('pdf') ? 'out.pdf' : 'out.xlsx');
  await dl.saveAs(file);
  return { name: await page.evaluate(() => window.__dlName), file };
}

/** 書き出したExcelを、ページ内の SheetJS で2次元配列に読み直す */
async function readXlsx(page, file) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate((d) => {
    const wb = XLSX.read(d, { type: 'base64' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  }, b64);
}

(async () => {
  const c = new Check('交代の一覧の書出');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-export-'));

  for (const url of [URL_HTTP, URL_FILE]) {
    const tag = url.startsWith('file') ? '[file://] ' : '[http://] ';
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', (e) => c.ok(false, tag + 'JSエラー: ' + e.message));

    await openWithSeed(page, url, {
      periods: [PERIOD_PREV, PERIOD], currentPeriodId: PERIOD.id,
      periodStaff: { [PERIOD.id]: SMALL }, history: twoDayHistory(),
    });
    await page.click('[data-tab="history"]');
    await page.waitForTimeout(300);

    // 記録が無いときは書き出さずに知らせる
    dialogs.length = 0;
    await page.click('#change-log-pdf-btn');
    await page.waitForTimeout(200);
    c.ok(dialogs.some((m) => m.includes('書き出す交代の記録がありません')), tag + '記録が無いときに案内が出ない');

    await applyTwoChanges(page);

    const xlsx = await download(page, '#change-log-xlsx-btn', dir);
    c.ok(/^変更届による交代の一覧_\d{4}-\d{2}-\d{2}\.xlsx$/.test(xlsx.name), tag + 'Excelのファイル名：' + xlsx.name);
    const fromXlsx = await readXlsx(page, xlsx.file);

    const pdf = await download(page, '#change-log-pdf-btn', dir);
    c.ok(/^変更届による交代の一覧_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.name), tag + 'PDFのファイル名：' + pdf.name);
    const pdfText = fs.readFileSync(pdf.file, 'latin1');
    c.ok(pdfText.startsWith('%PDF'), tag + 'PDFになっていない');
    c.ok(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/.test(pdfText), tag + 'PDFがA4横になっていない');

    const [header, ...rows] = fromXlsx;
    c.eq(header.join(','), '反映日時,種別,日付,曜日,欄,職員番号,氏名,,日付,曜日,欄,職員番号,氏名,申請日時', tag + '見出し');
    c.eq(rows.length, 2, tag + '行数（交換1行＋片道1行）');
    const swap = rows.find((r) => r[1] === '交換');
    const oneway = rows.find((r) => r[1] === '交代');
    c.ok(swap, tag + '交換の行が無い');
    if (swap) {
      // 左右どちらが先かは反映の順による。2組そろっていればよい
      const sides = [swap.slice(2, 7).join('|'), swap.slice(8, 13).join('|')].sort();
      c.eq(sides.join(' / '), '2026-07-10|金|2人目|J1|和田　悠歴 / 2026-07-11|土|2人目|J2|佐藤　隆',
        tag + '交換の行（1行に日付・曜日・欄・職員番号・氏名が2組）');
      c.eq(swap[7], '←→', tag + '交換の矢印');
    }
    c.ok(oneway, tag + '片道の交代の行が無い');
    if (oneway) {
      c.eq(oneway[7], '→', tag + '片道の矢印');
      c.eq(oneway[8], '―', tag + '片道の2つ目の日付が「―」でない');
      c.eq(oneway[11], 'S1', tag + '片道：交代後の職員番号');
      c.has(oneway[12], '髙橋', tag + '片道：交代後の氏名');
      c.eq(oneway[13], '2026-09-01 09:00', tag + '片道：申請日時');
    }
    // 反映日時は日本時間（記録は世界標準時）。画面とExcelで同じ表示
    const loggedIso = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))[0].loggedAt, 'duty_change_log_v1');
    const jst = new Date(new Date(loggedIso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    c.ok(rows.some((r) => r[0] === jst), tag + `Excelの反映日時が日本時間でない（期待 ${jst} / 実際 ${rows.map((r) => r[0])}）`);
    const screenTimes = await page.$$eval('#change-log-tbody tr', (trs) => trs.map((tr) => tr.children[0].innerText.trim()));
    c.eq(screenTimes.join(','), rows.map((r) => r[0]).join(','), tag + '反映日時が画面とExcelで違う');
    // 画面の一覧と同じ順（新しい順）
    const screen = await page.$$eval('#change-log-tbody tr', (trs) => trs.map((tr) => tr.children[1].innerText.trim()));
    c.eq(rows.map((r) => r[1]).join(','), screen.join(','), tag + '並び順が画面と違う');

    // 表示フィルタを範囲外にすると書き出さない
    await page.selectOption('#history-period-filter', PERIOD_PREV.id);
    await page.$eval('#history-period-filter', (el) => el.dispatchEvent(new Event('change')));
    await page.waitForTimeout(300);
    dialogs.length = 0;
    await page.click('#change-log-xlsx-btn');
    await page.waitForTimeout(200);
    c.ok(dialogs.some((m) => m.includes('書き出す交代の記録がありません')), tag + '表示範囲外でも書き出してしまう');

    await ctx.close();
  }
  await browser.close();
  c.finish();
})();
