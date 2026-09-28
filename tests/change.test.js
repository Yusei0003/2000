/** 「交代を反映」の検証。
 *   A. 交換：「変更する日付」を交代相手の担当日として読み、2日の担当を入れ替える
 *   B. 変更する日付に交代相手の担当が無い：赤字の警告 → 片道の交代でよいか確認
 *   C. 行違い：申請者でない人の行に貼ると入力欄を埋めず、正しい行へ切り替えられる
 *   D. 手動で選んだ組合せがルール違反なら、反映後にポップアップで知らせる
 *  file:// でも A が動くことを確認する。
 */
const { playwright, CHROMIUM, URL_HTTP, URL_FILE, KEY, openWithSeed, Check } = require('./helpers');
const { PERIOD, SMALL, twoDayHistory, changeText } = require('./fixtures');

const SEED = {
  periods: [PERIOD], currentPeriodId: PERIOD.id,
  periodStaff: { [PERIOD.id]: SMALL }, history: twoDayHistory(),
};
const TEXT_SWAP = changeText({ partner: '佐藤　隆', applicant: '和田　悠歴', changeDate: '2026年07月11日（土）' });

async function history(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY.history);
}
async function openRow(page, date, level) {
  await page.click('[data-tab="history"]');
  await page.waitForTimeout(250);
  await page.click(`button.change-btn[data-level="${level}"][data-date="${date}"]`);
  await page.waitForTimeout(350);
}
async function paste(page, text) {
  await page.fill('#change-text-input', text);
  await page.click('#change-text-parse-btn');
  await page.waitForTimeout(450);
}
async function confirmChange(page) {
  await page.click('#change-confirm');
  await page.waitForTimeout(600);
  await page.click('#backup-later-btn').catch(() => {});
  await page.waitForTimeout(250);
}

(async () => {
  const c = new Check('交代を反映（交換の解釈・警告・行違い・ルール違反の通知）');
  const browser = await playwright().chromium.launch({ executablePath: CHROMIUM });
  const newPage = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.dialogs = [];
    page.on('dialog', async (d) => { page.dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', (e) => c.ok(false, 'JSエラー: ' + e.message));
    return page;
  };

  // ---- A. 交換（http:// と file://） ----
  for (const [label, url] of [['http', URL_HTTP], ['file', URL_FILE]]) {
    const page = await newPage();
    await openWithSeed(page, url, SEED);
    await openRow(page, '2026-07-10', 'junior');

    c.has(await page.$eval('.change-target', (el) => el.innerText), '和田', `${label}/A: 冒頭に申請者（この行の担当者）が出ていない`);
    await paste(page, TEXT_SWAP);

    const summary = await page.$eval('#change-summary', (el) => el.innerText);
    c.has(summary, '2026-07-11', `${label}/A: 確認カードに交代相手の日付が出ていない`);
    c.has(summary, '佐藤', `${label}/A: 確認カードに交代相手の氏名が出ていない`);
    // 選択肢の値は「日付|級」の形
    const swapVal = await page.$eval('#change-swap-target', (el) => el.value).catch(() => '');
    c.ok(swapVal.startsWith('2026-07-11'), `${label}/A: 交換先に「変更する日付」が自動で選ばれていない（${swapVal}）`);

    await page.click('#change-confirm');
    await page.waitForTimeout(600);
    c.ok(await page.$('#backup-modal-root .modal-box'), `${label}/A: 反映後にバックアップの促しが出ない`);
    await page.click('#backup-later-btn').catch(() => {});
    await page.waitForTimeout(250);

    const h = await history(page);
    const d10 = h.find((r) => r.date === '2026-07-10');
    const d11 = h.find((r) => r.date === '2026-07-11');
    c.eq(d10.juniorName, '佐藤　隆', `${label}/A: 7/10 の2人目が交代相手になっていない`);
    c.eq(d11.juniorName, '和田　悠歴', `${label}/A: 7/11 の2人目が申請者になっていない`);
    c.ok(!!d10.juniorChangedAt && !!d11.juniorChangedAt, `${label}/A: 変更日時が記録されていない`);
    await page.close();
  }

  // ---- B. 変更する日付に交代相手の担当が無い ----
  {
    const page = await newPage();
    await openWithSeed(page, URL_HTTP, SEED);
    await openRow(page, '2026-07-10', 'junior');
    await paste(page, changeText({ partner: '佐藤　隆', applicant: '和田　悠歴', changeDate: '2026年07月12日（日）' }));
    c.has(await page.$eval('#change-text-status', (el) => el.innerText), '⚠', 'B: 交代相手の担当日が無いのに警告が出ない');

    await confirmChange(page);
    c.ok(page.dialogs.some((m) => m.includes('片道の交代')), 'B: 片道の交代でよいかの確認が出ない');
    const h = await history(page);
    c.eq(h.find((r) => r.date === '2026-07-10').juniorName, '佐藤　隆', 'B: 確認後、片道の交代が反映されていない');
    c.eq(h.find((r) => r.date === '2026-07-11').juniorName, '佐藤　隆', 'B: 片道なのに 7/11 まで書き換わっている');
    await page.close();
  }

  // ---- C. 行違い ----
  {
    const page = await newPage();
    await openWithSeed(page, URL_HTTP, SEED);
    await openRow(page, '2026-07-11', 'junior');           // 交代相手（佐藤）の行を開いてしまう
    await paste(page, TEXT_SWAP);

    const card = await page.$eval('.wrongrow-card', (el) => el.innerText).catch(() => '');
    c.has(card, '貼り付ける行が違います', 'C: 行違いのカードが出ない');
    c.has(card, '和田', 'C: 行違いのカードに申請者が出ていない');
    c.eq(await page.$eval('#change-new-staff', (el) => el.value), '', 'C: 行違いなのに入力欄が埋まっている');

    await page.click('.change-jump-btn');
    await page.waitForTimeout(600);
    c.has(await page.$eval('.change-target', (el) => el.innerText), '和田', 'C: 「この行に切り替える」で申請者の行に移らない');
    c.has(await page.$eval('#change-summary', (el) => el.innerText), '2026-07-11', 'C: 切り替え後に読み取りが引き継がれていない');
    await page.close();
  }

  // ---- D. 手動で選んだ組合せがルール違反 ----
  {
    const page = await newPage();
    await openWithSeed(page, URL_HTTP, SEED);
    // 7/10 の1人目（髙橋・総務課）を、2人目（和田・福祉課）と同じ課でない人に…ではなく、
    // あえて 1人目を 課長補佐、2人目を 副主幹 にして課長補佐・副主幹どうしの組合せを作る
    await openRow(page, '2026-07-10', 'junior');
    await page.click('#change-manual-toggle');
    await page.waitForTimeout(200);
    await page.selectOption('#change-new-staff', 'st-S4');   // 副主幹
    await page.fill('#change-applied-at', '2026-06-20T10:00');
    await confirmChange(page);

    await openRow(page, '2026-07-10', 'senior');
    await page.click('#change-manual-toggle');
    await page.waitForTimeout(200);
    await page.selectOption('#change-new-staff', 'st-S3');   // 課長補佐
    await page.fill('#change-applied-at', '2026-06-20T10:05');
    await confirmChange(page);

    c.ok(page.dialogs.some((m) => m.includes('ルール違反') && /課長補佐|副主幹/.test(m)),
      'D: 課長補佐・副主幹どうしの組合せでポップアップが出ない');
    await page.close();
  }

  await browser.close();
  c.finish();
})();
