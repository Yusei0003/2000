/** 7つのタブがすべて開き、JSエラーが出ないことを確認する。
 *  http:// と file:// の両方で確認する（file:// で開く運用もあるため）。
 */
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, openWithSeed, Check } = require('./helpers');
const { PERIOD, SMALL, twoDayHistory } = require('./fixtures');

const TABS = ['staff', 'rules', 'events', 'generate', 'history', 'help', 'docs'];

(async () => {
  const c = new Check('全7タブが開く（http:// と file://）');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });

  for (const [label, url] of [['http', URL_HTTP], ['file', URL_FILE]]) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(`${label}: ${m.text()}`); });

    await openWithSeed(page, url, {
      periods: [PERIOD], currentPeriodId: PERIOD.id,
      periodStaff: { [PERIOD.id]: SMALL }, history: twoDayHistory(),
    });

    for (const t of TABS) {
      await page.click(`[data-tab="${t}"]`);
      await page.waitForTimeout(250);
      const visible = await page.$eval(`#panel-${t}`, (el) => el.classList.contains('active'));
      c.ok(visible, `${label}: ${t} タブが開かない`);
    }
    // 名簿と履歴が表示されているか
    await page.click('[data-tab="staff"]');
    await page.waitForTimeout(200);
    c.has(await page.$eval('#staff-count', (el) => el.innerText), '8', `${label}: 名簿の人数が出ていない`);
    await page.click('[data-tab="history"]');
    await page.waitForTimeout(200);
    c.has(await page.$eval('#history-tbody', (el) => el.innerText), '2026-07-10', `${label}: 履歴が出ていない`);

    errs.forEach((e) => c.ok(false, 'JSエラー: ' + e));
    await page.close();
  }

  await browser.close();
  c.finish();
})();
