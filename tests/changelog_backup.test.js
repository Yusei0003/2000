/** 「変更届による交代の一覧」とバックアップの検証。
 *   1. 交換は1行にまとめ、日付・氏名を4分割で表示する／片道は2つ目の日付が「―」
 *   2. 一覧は確定済み履歴の表示フィルタと連動する
 *   3. 反映のたびに未バックアップ件数が増え、バックアップを作ると0に戻る
 *   4. 書き出したバックアップから復元できる
 *  ※ Playwright の setInputFiles は日本語ファイル名を無視するため、ASCII名で保存して使う。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { playwright, CHROMIUM, URL_HTTP, KEY, openWithSeed, Check } = require('./helpers');
const { PERIOD, PERIOD_PREV, SMALL, twoDayHistory, changeText } = require('./fixtures');

(async () => {
  const c = new Check('交代の一覧とバックアップ');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  page.on('pageerror', (e) => c.ok(false, 'JSエラー: ' + e.message));

  await openWithSeed(page, URL_HTTP, {
    periods: [PERIOD_PREV, PERIOD], currentPeriodId: PERIOD.id,
    periodStaff: { [PERIOD.id]: SMALL }, history: twoDayHistory(),
  });
  await page.click('[data-tab="history"]');
  await page.waitForTimeout(300);

  const status = () => page.$eval('#backup-status', (el) => el.innerText);
  c.has(await page.$eval('#change-log-tbody', (el) => el.innerText), 'ありません', '反映前に一覧が空表示になっていない');
  c.has(await status(), 'まだ一度も', '初期状態で「まだ一度もバックアップを作成していません」が出ていない');

  // 交換を1件（7/10 和田 ⇄ 7/11 佐藤）
  await page.click('button.change-btn[data-level="junior"][data-date="2026-07-10"]');
  await page.waitForTimeout(300);
  await page.fill('#change-text-input', changeText({ partner: '佐藤　隆', applicant: '和田　悠歴', changeDate: '2026年07月11日（土）' }));
  await page.click('#change-text-parse-btn');
  await page.waitForTimeout(400);
  await page.click('#change-confirm');
  await page.waitForTimeout(600);
  const modal = await page.$eval('#backup-modal-root .modal-box', (el) => el.innerText).catch(() => '');
  c.has(modal, 'バックアップを作成してください', '反映後にバックアップの促しが出ない');
  c.has(modal, '1 件', '促しに未バックアップ件数（1件）が出ていない');
  await page.click('#backup-later-btn');
  await page.waitForTimeout(300);

  // 片道の交代を1件（7/11 の1人目を髙橋さんに）
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

  // ---- 1. 一覧の表示 ----
  const rows = await page.$$eval('#change-log-tbody tr',
    (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())));
  const swap = rows.find((r) => r[1] === '交換');
  const oneway = rows.find((r) => r[1] === '交代');
  c.ok(swap, '交換の行が無い');
  if (swap) {
    c.has(swap[2], '2026-07-10', '交換行：1つ目の日付');
    c.has(swap[3], '和田', '交換行：1つ目の氏名');
    c.has(swap[5], '2026-07-11', '交換行：2つ目の日付');
    c.has(swap[6], '佐藤', '交換行：2つ目の氏名');
  }
  c.ok(oneway, '片道の交代の行が無い');
  if (oneway) {
    c.has(oneway[5], '―', '片道の交代：2つ目の日付が「―」になっていない');
    c.has(oneway[6], '髙橋', '片道の交代：交代後の氏名');
  }

  // ---- 3. 未バックアップ件数 ----
  c.has(await status(), '2 件', '反映2件のあと、未バックアップ件数が2件になっていない');

  // ---- 2. 表示フィルタとの連動 ----
  await page.selectOption('#history-period-filter', 'unassigned');
  await page.waitForTimeout(300);
  c.has(await page.$eval('#change-log-tbody', (el) => el.innerText), 'ありません', '表示フィルタを切り替えても一覧が連動しない');
  await page.selectOption('#history-period-filter', PERIOD.id).catch(() => {});
  await page.waitForTimeout(200);

  // ---- 3. バックアップを作ると0件に戻る ----
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backup-export-btn')]);
  const backupFile = path.join(os.tmpdir(), `duty_backup_test_${process.pid}.json`);
  await dl.saveAs(backupFile);
  c.ok(fs.statSync(backupFile).size > 500, 'バックアップファイルが小さすぎる');
  c.has(await status(), '前回のバックアップ', 'バックアップ後に前回日時が出ていない');
  c.hasNot(await status(), '未バックアップ', 'バックアップ後も未バックアップ件数が残っている');

  // ---- 4. 復元 ----
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('[data-tab="history"]');
  await page.waitForTimeout(300);
  await page.setInputFiles('#backup-import-input', backupFile);
  await page.waitForTimeout(2500);
  c.ok(dialogs.some((m) => m.includes('上書きします')), '復元の確認メッセージが出ない');
  const restored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY.history);
  c.eq(restored.find((r) => r.date === '2026-07-10')?.juniorName, '佐藤　隆', '復元後、交代を反映した内容が戻っていない');
  fs.unlinkSync(backupFile);

  await browser.close();
  c.finish();
})();
