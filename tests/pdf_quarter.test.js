/** 確定済み履歴の「PDF書出」のページ分けの検証。
 *   1. 前期は1ページ目＝4〜6月／2ページ目＝7〜9月、後期は1ページ目＝10〜12月／2ページ目＝1〜3月
 *      表題は「2026年度前期　日直勤務表」（月は入れない）
 *   2. 同じ月がページをまたがない（各ページにはその3ヶ月の行だけ、漏れなく載る）
 *   3. 「全期間」では処理期ごとに2ページずつ、古い順に続く
 *  ページの中身は drawRosterPage の呼び出しを横取りして確かめる（PDFの文字は読み出せないため）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, openWithSeed, Check } = require('./helpers');
const { PERIOD, PERIOD_PREV, SMALL, rec } = require('./fixtures');

/** from〜to の土日すべてを確定済み履歴にする（1日ごとに担当者を入れ替える） */
function weekendHistory(from, to, period) {
  const out = [];
  const pairs = [['st-S1', 'st-J1'], ['st-S2', 'st-J2']];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) continue;
    const [s, j] = pairs[out.length % 2];
    out.push(rec(d.toISOString().slice(0, 10), wd, s, j, SMALL, { periodId: period.id, periodLabel: period.label }));
  }
  return out;
}

async function pagesOf(page, clickSelector) {
  await page.evaluate(() => {
    window.__pages = [];
    const orig = window.drawRosterPage;
    if (!window.__wrapped) {
      window.__wrapped = true;
      window.drawRosterPage = function (pdf, title, rows, ...rest) {
        window.__pages.push({ title, dates: rows.map((r) => r.date) });
        return orig.call(this, pdf, title, rows, ...rest);
      };
    }
  });
  await Promise.all([page.waitForEvent('download'), page.click(clickSelector)]);
  return page.evaluate(() => window.__pages);
}

const monthOf = (d) => Number(d.slice(5, 7));

(async () => {
  const c = new Check('PDFのページ分け（四半期）');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const h1 = weekendHistory('2026-04-01', '2026-09-30', PERIOD);
  const h2 = weekendHistory('2025-10-01', '2026-03-31', PERIOD_PREV);

  for (const url of [URL_HTTP, URL_FILE]) {
    const tag = url.startsWith('file') ? '[file://] ' : '[http://] ';
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => c.ok(false, tag + 'JSエラー: ' + e.message));
    await openWithSeed(page, url, {
      periods: [PERIOD_PREV, PERIOD], currentPeriodId: PERIOD.id,
      periodStaff: { [PERIOD.id]: SMALL, [PERIOD_PREV.id]: SMALL }, history: h2.concat(h1),
    });
    await page.click('[data-tab="history"]');
    await page.waitForTimeout(300);

    const check = (pages, expect, all, label) => {
      c.eq(pages.map((p) => p.title).join(' / '), expect.map((e) => e.title).join(' / '), tag + label + '：ページの並び');
      pages.forEach((p, i) => {
        const e = expect[i];
        if (!e) return;
        const bad = p.dates.filter((d) => !e.months.includes(monthOf(d)));
        c.eq(bad.join(','), '', tag + `${label}：${p.title} に別の月の行が載っている`);
      });
      const printed = pages.flatMap((p) => p.dates).sort().join(',');
      c.eq(printed, all.map((r) => r.date).sort().join(','), tag + label + '：載っていない日、または重複した日がある');
    };
    const H1 = (lbl) => [
      { title: `${lbl}　日直勤務表`, months: [4, 5, 6] },
      { title: `${lbl}　日直勤務表`, months: [7, 8, 9] },
    ];
    const H2 = (lbl) => [
      { title: `${lbl}　日直勤務表`, months: [10, 11, 12] },
      { title: `${lbl}　日直勤務表`, months: [1, 2, 3] },
    ];
    const setFilter = async (v) => {
      await page.selectOption('#history-period-filter', v);
      await page.$eval('#history-period-filter', (el) => el.dispatchEvent(new Event('change')));
      await page.waitForTimeout(300);
    };

    // 前期
    await setFilter(PERIOD.id);
    check(await pagesOf(page, '#history-pdf-btn'), H1('2026年度前期'), h1, '前期');
    // 後期
    await setFilter(PERIOD_PREV.id);
    check(await pagesOf(page, '#history-pdf-btn'), H2('2025年度後期'), h2, '後期');
    // 全期間：古い処理期から2ページずつ
    await setFilter('all');
    check(await pagesOf(page, '#history-pdf-btn'), H2('2025年度後期').concat(H1('2026年度前期')), h2.concat(h1), '全期間');

    await ctx.close();
  }
  await browser.close();
  c.finish();
})();
