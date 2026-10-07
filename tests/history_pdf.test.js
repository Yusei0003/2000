/** 確定済み履歴の「PDF書出」の検証。
 *   1. ファイル名が「日直勤務表_R（令和の年）.（月）.（日）更新.pdf」（書き出した日）になる
 *   2. PDFの「変更日」が年月日だけ（時刻を出さない）。見出しも「変更日」
 *   3. file:// で開いた場合も書き出せる
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, openWithSeed, Check } = require('./helpers');
const { PERIOD, PERIOD_PREV, SMALL, twoDayHistory } = require('./fixtures');

(async () => {
  const c = new Check('確定済み履歴のPDF書出');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-hpdf-'));

  for (const url of [URL_HTTP, URL_FILE]) {
    const tag = url.startsWith('file') ? '[file://] ' : '[http://] ';
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => c.ok(false, tag + 'JSエラー: ' + e.message));

    const hist = twoDayHistory();
    hist[0].juniorChangedAt = '2026-09-01 09:00';
    hist[1].seniorChangedAt = '2026/9/2 13:05'; // Excelから取り込んだ書き方
    await openWithSeed(page, url, {
      periods: [PERIOD_PREV, PERIOD], currentPeriodId: PERIOD.id,
      periodStaff: { [PERIOD.id]: SMALL }, history: hist,
    });
    await page.click('[data-tab="history"]');
    await page.waitForTimeout(300);

    // ---- 1. ファイル名（Playwright は日本語のダウンロード名を「download」にするため、a.download を横取りする）----
    await page.evaluate(() => {
      const dispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function (ev) {
        if (this instanceof HTMLAnchorElement && ev.type === 'click' && this.download) window.__dlName = this.download;
        return dispatch.call(this, ev);
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return click.call(this); };
    });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#history-pdf-btn')]);
    const file = path.join(dir, 'out.pdf');
    await dl.saveAs(file);
    c.ok(fs.readFileSync(file, 'latin1').startsWith('%PDF'), tag + 'PDFになっていない');
    const name = await page.evaluate(() => window.__dlName);
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const expected = `日直勤務表_R${now.getFullYear() - 2018}.${now.getMonth() + 1}.${now.getDate()}更新.pdf`;
    c.eq(name, expected, tag + 'ファイル名');
    c.eq(await page.evaluate(() => historyPdfFileName(new Date(2026, 8, 28))), '日直勤務表_R8.9.28更新.pdf', tag + '令和8年9月28日のファイル名');
    c.eq(await page.evaluate(() => historyPdfFileName(new Date(2027, 0, 5))), '日直勤務表_R9.1.5更新.pdf', tag + '令和9年1月5日のファイル名');

    // ---- 2. 変更日時は年月日だけ ----
    const cells = await page.evaluate((h) => h.map((r) => ROSTER_COLUMNS.map((col) => col.get(r))), hist);
    c.eq(cells[0][5], '2026-09-01', tag + '変更日時（2人目）が年月日だけになっていない');
    c.eq(cells[1][3], '2026-09-02', tag + 'Excel取込の書き方の変更日時が年月日にそろわない');
    c.eq(cells[0][3], '', tag + '変更していない欄は空欄');
    c.eq(await page.evaluate(() => ROSTER_COLUMNS.map((col) => col.header).join(',')), '日付,曜日,氏名,変更日,氏名,変更日', tag + 'PDFの見出し');

    await ctx.close();
  }
  await browser.close();
  c.finish();
})();
