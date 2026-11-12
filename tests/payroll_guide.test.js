/** 宿日直手当支給調書のCSVと、初めて使う人への案内の検証。
 *   1. 支給調書CSV：選んだ月の日直1回につき「職員番号,1,0」を1行（2回なら2行）、職員番号の順、
 *      見出し・BOMなし、ファイル名「R8.10宿日直手当支給調書.csv」、対象月の既定は先月
 *   2. 最初の案内：データが空のときだけ出る。選んだら次からは出ない
 *   3. やることリスト：名簿・指定日・作成の進み具合に合わせて「次は」が進む。過去の処理期では出さない
 *   4. 時期の案内：3月は前期、9月は後期。その処理期を確定したら出さない。ほかの月は出さない
 *   5. 用語の「？」・右上の操作マニュアル・タブの番号・バックアップの保存先のコピー
 *   http:// と file:// の両方で開いて確かめる（file:// で開く運用もあるため）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, openWithSeed, Check } = require('./helpers');
const { SMALL, rec, buildStaff } = require('./fixtures');

const H2 = {
  id: '2026-H2', fiscalYear: 2026, half: 'H2', startDate: '2026-10-01', endDate: '2027-03-31', label: '2026年度後期',
  standingExcludedDepts: [], sickLeaveExcludedNumbers: [], specialExclusions: [], createdAt: '2026-09-01T00:00:00.000Z',
};
const H1_2027 = { ...H2, id: '2027-H1', fiscalYear: 2027, half: 'H1', startDate: '2027-04-01', endDate: '2027-09-30', label: '2027年度前期' };
const r = (date, wd, s, j) => rec(date, wd, s, j, SMALL, { periodId: H2.id, periodLabel: H2.label });
/** 10月：S1が2回（3日と25日）、J1が1回。11月：S2・J2が1回ずつ */
const payrollHistory = () => [
  r('2026-10-03', 6, 'st-S1', 'st-J1'),
  r('2026-10-25', 0, 'st-S1', 'st-J2'),
  r('2026-11-01', 0, 'st-S2', 'st-J3'),
];

/** Playwright は日本語のダウンロード名を「download」に置き換えるため、<a download> の値を横取りする */
async function download(page, selector, file) {
  await page.evaluate(() => {
    if (window.__dlPatched) return;
    window.__dlPatched = true;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return click.call(this); };
  });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  await dl.saveAs(file);
  return page.evaluate(() => window.__dlName);
}

(async () => {
  const c = new Check('支給調書CSVと初めての人への案内');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-payroll-'));

  for (const url of [URL_HTTP, URL_FILE]) {
    const tag = url.startsWith('file') ? '[file://] ' : '[http://] ';
    const newPage = async (date) => {
      const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo' });
      const page = await ctx.newPage();
      if (date) await page.clock.setFixedTime(new Date(date));
      const dialogs = [];
      page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
      page.on('pageerror', (e) => c.ok(false, tag + 'JSエラー: ' + e.message));
      return { ctx, page, dialogs };
    };

    // ---- 1. 支給調書CSV（今日を2026年11月11日にする → 既定は10月） ----
    {
      const { ctx, page } = await newPage('2026-11-11T10:00:00+09:00');
      await openWithSeed(page, url, { periods: [H2], currentPeriodId: H2.id, periodStaff: { [H2.id]: SMALL }, history: payrollHistory() });
      await page.click('[data-tab="history"]');
      await page.waitForTimeout(300);
      c.eq(await page.$eval('#payroll-month', (el) => el.value), '2026-10', tag + '対象月の既定が先月になっていない');
      const file = path.join(dir, 'pay.csv');
      const name = await download(page, '#payroll-csv-btn', file);
      c.eq(name, 'R8.10宿日直手当支給調書.csv', tag + 'ファイル名');
      const raw = fs.readFileSync(file);
      c.ok(raw[0] !== 0xef, tag + 'CSVにBOMが付いている（給与システムで読めないおそれ）');
      c.eq(raw.toString('utf8'), 'J1,1,0\r\nJ2,1,0\r\nS1,1,0\r\nS1,1,0\r\n', tag + 'CSVの中身（1回につき1行・職員番号の順・固定値1,0）');
      c.eq(raw.toString('utf8').split('\r\n').filter((l) => l.startsWith('S1,')).length, 2, tag + '2回入った人が2行になっていない');
      c.has(await page.$eval('#payroll-summary', (el) => el.innerText), 'CSVは4行', tag + '画面の行数の表示');
      // 月を変えると、その月の分だけになる
      await page.selectOption('#payroll-month', '2026-11');
      await page.$eval('#payroll-month', (el) => el.dispatchEvent(new Event('change')));
      await page.waitForTimeout(200);
      c.eq(await page.$eval('#payroll-csv-text', (el) => el.textContent), 'J3,1,0\nS2,1,0', tag + '11月を選んだときの中身');
      await ctx.close();
    }

    // ---- 2. 最初の案内 ----
    {
      const { ctx, page } = await newPage();
      await page.goto(url);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForTimeout(800);
      c.ok(await page.$('#welcome-overlay'), tag + 'データが空なのに最初の案内が出ない');
      c.has(await page.$eval('#welcome-overlay', (el) => el.innerText), '前任者からバックアップファイルを受け取った', tag + '案内の選択肢');
      c.eq(await page.$eval('#welcome-overlay .folder-copy-path', (el) => el.value),
        'S:\\1100-総務課\\02-職員係\\050_日直\\日直システム用\\バックアップ', tag + '案内にバックアップの保存先が出ていない');
      await page.click('#welcome-new');
      await page.waitForTimeout(300);
      c.ok(!(await page.$('#welcome-overlay')), tag + '「新しく始める」で案内が閉じない');
      c.ok(await page.$eval('#panel-staff', (el) => el.classList.contains('active')), tag + '「新しく始める」で名簿管理タブが開かない');
      await page.reload();
      await page.waitForTimeout(800);
      c.ok(!(await page.$('#welcome-overlay')), tag + '一度選んだのに、また最初の案内が出る');
      await ctx.close();
    }
    {
      // データがあるときは出さない
      const { ctx, page } = await newPage();
      await openWithSeed(page, url, { periods: [H2], currentPeriodId: H2.id, periodStaff: { [H2.id]: SMALL }, history: [] });
      c.ok(!(await page.$('#welcome-overlay')), tag + 'データがあるのに最初の案内が出る');
      await ctx.close();
    }

    // ---- 3. やることリスト（今日を2026年11月11日にする → 2026年度後期は進行中） ----
    {
      const { ctx, page } = await newPage('2026-11-11T10:00:00+09:00');
      await openWithSeed(page, url, { periods: [H2], currentPeriodId: H2.id, periodStaff: { [H2.id]: buildStaff(150) }, history: [] });
      const head = () => page.$eval('#guide-steps .guide-head', (el) => el.innerText);
      c.ok(await page.$eval('#guide-steps', (el) => !el.classList.contains('hidden')), tag + 'やることリストが出ない');
      c.has(await head(), 'ルールを確認する', tag + '名簿を入れた直後の「次は」');
      await page.click('#guide-steps .guide-next');
      await page.waitForTimeout(300);
      c.ok(await page.$eval('#panel-rules', (el) => el.classList.contains('active')), tag + '「進む」でルール設定タブが開かない');
      await page.click('[data-tab="events"]');
      await page.click('[data-tab="generate"]');
      await page.waitForTimeout(200);
      c.has(await head(), '指定日を抽出する', tag + 'ルール・行事を開いたあとの「次は」');
      await page.click('#gen-list-dates');
      await page.waitForTimeout(500);
      await page.click('#gen-run');
      await page.waitForTimeout(1500);
      c.has(await head(), '決裁・確定する', tag + '作成後の「次は」');
      c.eq(await page.$$eval('#guide-steps li.is-done', (els) => els.length), 6, tag + '済みの印の数');
      await ctx.close();
    }
    {
      // 過去の処理期では出さない（今日を2027年5月にする）
      const { ctx, page } = await newPage('2027-05-10T10:00:00+09:00');
      await openWithSeed(page, url, { periods: [H2], currentPeriodId: H2.id, periodStaff: { [H2.id]: SMALL }, history: [] });
      c.ok(await page.$eval('#guide-steps', (el) => el.classList.contains('hidden')), tag + '過去の処理期なのに、やることリストが出る');
      await ctx.close();
    }

    // ---- 4. 時期の案内 ----
    for (const [date, expect, label] of [
      ['2027-03-05T10:00:00+09:00', '前期（4〜9月）の勤務表を作る時期', '3月'],
      ['2026-09-10T10:00:00+09:00', '後期（10〜翌3月）の勤務表を作る時期', '9月'],
      ['2026-11-11T10:00:00+09:00', null, '11月'],
    ]) {
      const { ctx, page } = await newPage(date);
      await openWithSeed(page, url, { periods: [H2], currentPeriodId: H2.id, periodStaff: { [H2.id]: SMALL }, history: [] });
      const shown = await page.$eval('#season-banner', (el) => !el.classList.contains('hidden'));
      if (expect) {
        c.ok(shown, `${tag}${label}に時期の案内が出ない`);
        c.has(await page.$eval('#season-banner', (el) => el.innerText), expect, `${tag}${label}の案内の文言`);
      } else {
        c.ok(!shown, `${tag}${label}なのに時期の案内が出る`);
      }
      await ctx.close();
    }
    {
      // 3月でも、前期を確定済みなら出さない
      const { ctx, page } = await newPage('2027-03-05T10:00:00+09:00');
      await openWithSeed(page, url, { periods: [H2, H1_2027], currentPeriodId: H2.id, periodStaff: { [H2.id]: SMALL }, history: [] });
      await page.evaluate(() => {
        localStorage.setItem('duty_gen_session_v1', JSON.stringify({ '2027-H1': { status: 'confirmed', dates: [], results: [] } }));
      });
      await page.reload();
      await page.waitForTimeout(800);
      c.ok(await page.$eval('#season-banner', (el) => el.classList.contains('hidden')), tag + '前期を確定済みなのに、3月の案内が出る');
      await ctx.close();
    }

    // ---- 5. 用語の「？」・操作マニュアル・タブの番号・保存先のコピー ----
    {
      const { ctx, page } = await newPage('2026-11-11T10:00:00+09:00');
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await openWithSeed(page, url, { periods: [H2], currentPeriodId: H2.id, periodStaff: { [H2.id]: SMALL }, history: payrollHistory() });
      const tips = await page.$$eval('.term[data-tip]', (els) => els.map((e) => e.dataset.tip));
      c.ok(tips.length >= 4, tag + '用語の「？」が足りない');
      c.ok(tips.some((t) => t.startsWith('処理期：') && t.includes('前期＝4〜9月')), tag + '処理期の説明');
      const href = await page.$eval('#manual-link', (a) => a.getAttribute('href'));
      c.eq(href, 'docs/日直勤務表アプリ_操作マニュアル.pdf', tag + '操作マニュアルのリンク先');
      c.has(await page.$eval('[data-tab="staff"]', (b) => b.innerText), '①', tag + 'タブに番号が無い');
      c.has(await page.$eval('[data-tab="history"]', (b) => b.innerText), '⑤', tag + '履歴・確認タブの番号');
      c.ok(!(await page.$eval('[data-tab="help"]', (b) => b.innerText)).match(/[①-⑨]/), tag + '使い方タブに番号が付いている');
      await page.click('[data-tab="history"]');
      await page.waitForTimeout(300);
      c.eq(await page.$eval('#backup-folder-slot .folder-copy-path', (el) => el.value),
        'S:\\1100-総務課\\02-職員係\\050_日直\\日直システム用\\バックアップ', tag + 'バックアップ欄に保存先が出ていない');
      await page.click('#backup-folder-slot .folder-copy-btn');
      await page.waitForTimeout(300);
      c.has(await page.$eval('#backup-folder-slot .folder-copy-btn', (b) => b.innerText), 'コピーしました', tag + '「コピー」を押しても反応しない');
      if (url.startsWith('http')) {
        const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        if (clip !== null) c.eq(clip, 'S:\\1100-総務課\\02-職員係\\050_日直\\日直システム用\\バックアップ', tag + 'クリップボードの中身');
      }
      await ctx.close();
    }
  }

  await browser.close();
  c.finish();
})();
