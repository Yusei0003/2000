/** データの守りと画面の改善の検証。
 *   1. 別のタブでデータが変わったら、古いタブを止めて再読み込みを促す（古いデータで上書きしない）。
 *      別のタブを開いただけでは止めない。http:// と file:// の両方
 *   2. 保存に失敗したら（保存領域がいっぱい等）、その旨を知らせる
 *   3. 同じ職員を同じ日の1人目と2人目に入れられない（勤務表作成のプルダウン・交代を反映）
 *   4. 長い説明文は2行だけ見せ、「続きを読む」で開閉できる
 *   5. よく押すボタンにアイコンが付き、文字はそのまま
 */
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, KEY, openWithSeed, Check } = require('./helpers');
const { PERIOD, PERIOD_PREV, SMALL, twoDayHistory, buildStaff, changeText } = require('./fixtures');

const seed = () => ({
  periods: [PERIOD_PREV, PERIOD], currentPeriodId: PERIOD.id,
  periodStaff: { [PERIOD.id]: SMALL }, history: twoDayHistory(),
});
const juniorOf = (page, date) =>
  page.evaluate(([k, d]) => JSON.parse(localStorage.getItem(k)).find((r) => r.date === d).juniorName, [KEY.history, date]);

async function applySwap(page) {
  await page.click('[data-tab="history"]');
  await page.waitForTimeout(300);
  await page.click('button.change-btn[data-level="junior"][data-date="2026-07-10"]');
  await page.waitForTimeout(300);
  await page.fill('#change-text-input', changeText({ partner: '佐藤　隆', applicant: '和田　悠歴', changeDate: '2026年07月11日（土）' }));
  await page.click('#change-text-parse-btn');
  await page.waitForTimeout(400);
  await page.click('#change-confirm');
  await page.waitForTimeout(600);
  await page.click('#backup-later-btn').catch(() => {});
}

(async () => {
  const c = new Check('データの守りと画面の改善');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });

  // ---- 1. 別のタブでの変更 ----
  for (const url of [URL_HTTP, URL_FILE]) {
    const tag = url.startsWith('file') ? '[file://] ' : '[http://] ';
    const ctx = await browser.newContext();
    const A = await ctx.newPage();
    A.on('dialog', (d) => d.accept());
    A.on('pageerror', (e) => c.ok(false, tag + 'JSエラー(A): ' + e.message));
    await openWithSeed(A, url, seed());
    const B = await ctx.newPage();
    B.on('dialog', (d) => d.accept());
    await B.goto(url);
    await B.waitForTimeout(900);
    await A.waitForTimeout(300);
    c.ok(!(await A.$('#stale-data-overlay')), tag + '別のタブを開いただけで、古いタブが止まってしまう');

    await applySwap(B); // B で 7/10 の2人目を佐藤さんに
    await A.waitForTimeout(400);
    c.ok(await A.$('#stale-data-overlay'), tag + '別のタブで変更しても、古いタブに知らせが出ない');
    c.has(await A.$eval('#stale-data-overlay', (el) => el.innerText).catch(() => ''), '再読み込み', tag + '知らせに再読み込みの案内が無い');

    // 古いタブで保存しようとしても、Bの変更は消えない
    await A.evaluate(() => save('duty_history_v2', []));
    c.eq(await juniorOf(A, '2026-07-10'), '佐藤　隆', tag + '古いタブの保存で、別のタブの変更が消えた');

    // 再読み込みすれば最新のデータで使える
    await Promise.all([A.waitForNavigation(), A.click('#stale-reload-btn')]);
    await A.waitForTimeout(800);
    c.ok(!(await A.$('#stale-data-overlay')), tag + '再読み込み後も知らせが残っている');
    await ctx.close();
  }

  // ---- 2. 保存の失敗 ----
  {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await openWithSeed(page, URL_HTTP, seed());
    const ok = await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      const r1 = save('duty_history_v2', []);
      const r2 = save('duty_change_log_v1', []); // 続けて失敗しても、知らせは1度だけ
      Storage.prototype.setItem = orig;
      return [r1, r2];
    });
    c.eq(JSON.stringify(ok), '[false,false]', '保存に失敗しても成功扱いになっている');
    c.eq(dialogs.filter((m) => m.includes('保存できませんでした')).length, 1, '保存に失敗したときの知らせが1度だけ出ていない');
    c.has(dialogs.join(''), 'バックアップを作成', '知らせにバックアップの案内が無い');
    await page.close();
  }

  // ---- 3. 同じ職員を1人目と2人目に ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', (e) => c.ok(false, 'JSエラー: ' + e.message));
    await openWithSeed(page, URL_HTTP, { periods: [PERIOD], currentPeriodId: PERIOD.id, periodStaff: { [PERIOD.id]: buildStaff(150) }, history: [] });
    await page.click('[data-tab="generate"]');
    await page.waitForTimeout(300);
    await page.click('#gen-list-dates');
    await page.waitForTimeout(500);
    await page.click('#gen-run');
    await page.waitForTimeout(1500);
    const row1 = '#gen-result-tbody tr:nth-child(1)';
    const before = await page.$eval(row1, (tr) => [...tr.querySelectorAll('.result-select')].map((s) => s.value));
    await page.selectOption(`${row1} .result-select[data-level="junior"]`, before[0]);
    await page.waitForTimeout(400);
    const after = await page.$eval(row1, (tr) => [...tr.querySelectorAll('.result-select')].map((s) => s.value));
    c.eq(after.join(','), before.join(','), '同じ職員を1人目と2人目の両方に選べてしまう');
    c.ok(dialogs.some((m) => m.includes('同じ職員は選べません')), '同じ職員を選んだときに理由が出ない');
    // 判定そのものも、同じ人なら分かる言葉で知らせる
    const reasons = await page.evaluate(() => { const s = staff[0]; return validateManualPair(s, s); });
    c.has(reasons.join(''), '同じ職員が1人目と2人目の両方', '同じ人の組合せの理由が分かりにくい');
    await page.close();
  }
  {
    // 交代を反映：交代後の職員が、同じ日のもう一方の欄の人
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await openWithSeed(page, URL_HTTP, seed());
    await page.click('[data-tab="history"]');
    await page.waitForTimeout(300);
    await page.click('button.change-btn[data-level="junior"][data-date="2026-07-10"]');
    await page.waitForTimeout(300);
    await page.click('#change-manual-toggle');
    await page.waitForTimeout(200);
    await page.selectOption('#change-new-staff', 'st-S1'); // 7/10 の1人目（髙橋さん）
    await page.fill('#change-applied-at', '2026-09-01T09:00');
    await page.click('#change-confirm');
    await page.waitForTimeout(500);
    c.ok(dialogs.some((m) => m.includes('同じ職員は入れられません')), '交代を反映で、同じ日のもう一方の人を選んでも止まらない');
    c.eq(await juniorOf(page, '2026-07-10'), '和田　悠歴', '止めたはずの交代が反映されている');
    await page.close();
  }

  // ---- 4・5. 説明文の折りたたみとアイコン ----
  for (const url of [URL_HTTP, URL_FILE]) {
    const tag = url.startsWith('file') ? '[file://] ' : '[http://] ';
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => c.ok(false, tag + 'JSエラー: ' + e.message));
    await openWithSeed(page, url, seed());
    await page.click('[data-tab="history"]');
    await page.waitForTimeout(300);
    const hint = await page.evaluateHandle(() => document.getElementById('history-tbody').closest('.card').querySelector('p.hint.is-clamped'));
    c.ok(await hint.evaluate((el) => !!el), tag + '長い説明文が折りたたまれていない');
    if (await hint.evaluate((el) => !!el)) {
      const h1 = await hint.evaluate((el) => el.getBoundingClientRect().height);
      const more = await hint.evaluateHandle((el) => el.nextElementSibling);
      c.eq(await more.evaluate((el) => el.textContent), '▼ 続きを読む', tag + '「続きを読む」が無い');
      await more.click();
      const h2 = await hint.evaluate((el) => el.getBoundingClientRect().height);
      c.ok(h2 > h1 * 1.5, tag + '「続きを読む」で全文が開かない');
      c.eq(await more.evaluate((el) => el.textContent), '▲ 閉じる', tag + '開いたあとに「閉じる」にならない');
      await more.click();
      c.ok((await hint.evaluate((el) => el.getBoundingClientRect().height)) < h2, tag + '「閉じる」で畳まれない');
    }
    // 使い方・仕様書タブの説明は畳まない
    c.eq(await page.$$eval('#panel-help .is-clamped, #panel-docs .is-clamped', (els) => els.length), 0, tag + '使い方タブの説明まで畳まれている');

    for (const id of ['history-pdf-btn', 'history-export-btn', 'backup-export-btn', 'gen-run', 'change-log-xlsx-btn']) {
      const info = await page.$eval('#' + id, (b) => ({ svg: !!b.querySelector('svg.btn-svg'), text: b.innerText.trim() }));
      c.ok(info.svg, tag + id + ' にアイコンが無い');
      c.ok(info.text.length > 0, tag + id + ' の文字が消えた');
    }
    c.eq(await page.$eval('#history-pdf-btn', (b) => b.innerText.trim()), 'PDF書出', tag + 'ボタンの文字が変わった');
    await page.close();
  }

  await browser.close();
  c.finish();
})();
