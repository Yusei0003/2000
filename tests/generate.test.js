/** 勤務表作成タブの検証。
 *   1. 土日・祝日・年末年始を抽出し、勤務表を作成できる（要確認0件になる人数で）
 *   2. 決裁のチェックを入れるまで確定できない。手で変更するとチェックが外れる
 *   3. 確定すると履歴に保存され、バックアップの促しが出る
 *   4. 確定後はプルダウンがロックされ、再読み込みしても内容が保たれる
 *   5. 「引き戻して修正」で確定分が履歴から外れ、再び編集できる
 *   6. 手で選んだ組合せがルール違反なら、ポップアップで知らせる
 */
const { playwright, CHROMIUM, URL_HTTP, KEY, openWithSeed, Check } = require('./helpers');
const { PERIOD, buildStaff } = require('./fixtures');

(async () => {
  const c = new Check('勤務表作成（作成・決裁・確定・引き戻し）');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  page.on('pageerror', (e) => c.ok(false, 'JSエラー: ' + e.message));

  const staffList = buildStaff(150);
  await openWithSeed(page, URL_HTTP, {
    periods: [PERIOD], currentPeriodId: PERIOD.id, periodStaff: { [PERIOD.id]: staffList }, history: [],
  });
  await page.click('[data-tab="generate"]');
  await page.waitForTimeout(300);

  // ---- 1. 抽出と作成 ----
  await page.click('#gen-list-dates');
  await page.waitForTimeout(500);
  const nDates = await page.$$eval('#gen-dates-tbody tr', (trs) => trs.length);
  c.ok(nDates >= 55 && nDates <= 70, `前期の指定日数がおかしい（${nDates}日）`);

  await page.click('#gen-run');
  await page.waitForTimeout(4500);
  const nRows = await page.$$eval('#gen-result-tbody tr', (trs) => trs.length);
  c.eq(nRows, nDates, '作成結果の行数が指定日数と合わない');
  const statuses = await page.$$eval('#gen-result-tbody tr td:last-child', (tds) => tds.map((td) => td.innerText));
  c.eq(statuses.filter((s) => /要確認|エラー/.test(s)).length, 0, '人数が足りているのに要確認・エラーの日がある');

  // ---- 2. 決裁のチェック ----
  c.ok(await page.$eval('#gen-confirm', (el) => el.disabled), 'チェック前なのに確定ボタンが押せる');
  await page.check('#gen-approval-check');
  c.ok(!(await page.$eval('#gen-confirm', (el) => el.disabled)), 'チェック後も確定ボタンが押せない');

  // 手で変更するとチェックが外れる（1日目の2人目を、別の日の2人目と入れ替える）
  const firstJunior = await page.$('#gen-result-tbody tr:nth-child(1) .result-select[data-level="junior"]');
  const otherId = await page.$eval('#gen-result-tbody tr:nth-child(3) .result-select[data-level="junior"]', (el) => el.value);
  await firstJunior.selectOption(otherId);
  await page.waitForTimeout(400);
  c.ok(!(await page.$eval('#gen-approval-check', (el) => el.checked)), '手で変更したのに決裁のチェックが外れない');

  // ---- 6. ルール違反の通知（1日目の2人目を、1人目と同じ課の職員にする） ----
  const seniorId = await page.$eval('#gen-result-tbody tr:nth-child(1) .result-select[data-level="senior"]', (el) => el.value);
  const senior = staffList.find((s) => s.id === seniorId);
  const sameDept = staffList.find((s) => s.id !== seniorId && s.dept === senior.dept && s.gender === senior.gender);
  const before = dialogs.length;
  if (sameDept) {
    // 変更のたびに表は描き直されるので、要素は選ぶ直前に取り直す
    await page.selectOption('#gen-result-tbody tr:nth-child(1) .result-select[data-level="junior"]', sameDept.id);
    await page.waitForTimeout(500);
    c.ok(dialogs.slice(before).some((m) => m.includes('同一課') || m.includes('同じ課')),
      '同一課の組合せにしてもポップアップが出ない');
  }
  // 元に戻すため作り直す
  await page.click('#gen-run');
  await page.waitForTimeout(4500);

  // ---- 3. 確定 ----
  await page.check('#gen-approval-check');
  await page.click('#gen-confirm');
  await page.waitForTimeout(900);
  const modal = await page.$eval('#backup-modal-root .modal-box', (el) => el.innerText).catch(() => '');
  c.has(modal, '勤務表を確定', '確定後にバックアップの促しが出ない');
  await page.click('#backup-later-btn').catch(() => {});
  await page.waitForTimeout(300);

  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY.history);
  c.eq(saved.filter((r) => r.periodId === PERIOD.id).length, nDates, '確定した日数が履歴に保存されていない');

  // ---- 4. ロックと状態の保持 ----
  c.ok(await page.$eval('#gen-result-tbody .result-select', (el) => el.disabled), '確定後もプルダウンが変更できる');
  await page.reload();
  await page.waitForTimeout(900);
  await page.click('[data-tab="generate"]');
  await page.waitForTimeout(400);
  c.eq(await page.$$eval('#gen-result-tbody tr', (trs) => trs.length), nDates, '再読み込み後に作成結果が消えている');
  c.has(await page.$eval('#gen-confirmed-banner', (el) => el.innerText), '確定済み', '再読み込み後に確定済みの表示が無い');

  // ---- 5. 引き戻し ----
  await page.click('#gen-revert');
  await page.waitForTimeout(900);
  const afterRevert = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY.history);
  c.eq(afterRevert.filter((r) => r.periodId === PERIOD.id).length, 0, '引き戻したのに確定分が履歴に残っている');
  c.ok(!(await page.$eval('#gen-result-tbody .result-select', (el) => el.disabled)), '引き戻したのにプルダウンがロックされたまま');

  await browser.close();
  c.finish();
})();
