/** マニュアル用の画面キャプチャを撮る。
 *  流れ：(A) デモデータ投入→勤務表作成→確定→バックアップ書出
 *        (B) 第1章 バックアップから復元
 *        (C) 第2章 勤務表の作成
 *        (D) 第3章 交代の反映
 *  ※ Playwright の setInputFiles は日本語ファイル名だと無視されるため、
 *     復元に使うファイルは ASCII 名で保存する。
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const D = require('./demo_data');

const OUT = path.join(__dirname, 'shots');
const BACKUP = path.join(__dirname, 'backup_demo.json');
const URL = 'http://127.0.0.1:8899/index.html';

function seedScript(s) {
  localStorage.clear();
  localStorage.setItem('duty_periods_v1', JSON.stringify(s.periods));
  localStorage.setItem('duty_current_period_v1', JSON.stringify(s.currentPeriodId));
  localStorage.setItem('duty_period_staff_v1', JSON.stringify(s.periodStaff));
  localStorage.setItem('duty_leaves_v1', JSON.stringify(s.leaves));
  localStorage.setItem('duty_fiscal_events_v1', JSON.stringify(s.events));
  localStorage.setItem('duty_history_v2', JSON.stringify(s.history));
}

async function clipOf(page, el, maxHeight) {
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  const b = await el.boundingBox();
  return {
    x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8),
    width: Math.min(b.width + 16, 1280 - Math.max(0, b.x - 8)),
    height: maxHeight ? Math.min(b.height + 16, maxHeight) : b.height + 16,
  };
}

/** セレクタの要素をそのまま撮る。 */
async function shot(page, selector, file, maxHeight) {
  const el = await page.$(selector);
  if (!el) throw new Error('要素が見つかりません: ' + selector);
  await page.screenshot({ path: path.join(OUT, file), clip: await clipOf(page, el, maxHeight) });
  console.log('  ●', file);
}

/** セレクタの要素を含む .card をまるごと撮る。 */
async function shotCard(page, selector, file, maxHeight) {
  const h = await page.evaluateHandle((sel) => document.querySelector(sel).closest('.card'), selector);
  const el = h.asElement();
  await page.screenshot({ path: path.join(OUT, file), clip: await clipOf(page, el, maxHeight) });
  console.log('  ●', file);
}

/** セレクタの要素を含む table をまるごと（見出し行から）撮る。 */
async function shotTable(page, selector, file, maxHeight) {
  const h = await page.evaluateHandle((sel) => document.querySelector(sel).closest('table'), selector);
  await page.screenshot({ path: path.join(OUT, file), clip: await clipOf(page, h.asElement(), maxHeight) });
  console.log('  ●', file);
}

/** 上端の要素から下端の要素までをまとめて撮る。 */
async function shotRange(page, selA, selB, file, maxHeight) {
  const a = await page.$(selA);
  const b = await page.$(selB);
  await a.scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  const ba = await a.boundingBox();
  const bb = await b.boundingBox();
  const x = Math.max(0, Math.min(ba.x, bb.x) - 8);
  const y = Math.max(0, ba.y - 8);
  const clip = {
    x, y,
    width: Math.min(Math.max(ba.x + ba.width, bb.x + bb.width) - x + 8, 1280 - x),
    height: (bb.y + bb.height) - y + 10,
  };
  if (maxHeight && clip.height > maxHeight) clip.height = maxHeight;
  await page.screenshot({ path: path.join(OUT, file), clip });
  console.log('  ●', file);
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2, acceptDownloads: true,
    locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
  });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

  // ========== (A) デモデータ投入 → 作成 → 確定 → バックアップ書出 ==========
  console.log('[A] デモデータの投入と勤務表の作成');
  await page.goto(URL);
  await page.evaluate(seedScript, D.seed());
  await page.reload();
  await page.waitForTimeout(1000);
  await page.click('[data-tab="generate"]');
  await page.click('#gen-list-dates');
  await page.waitForTimeout(600);
  await page.click('#gen-run');
  await page.waitForTimeout(5000);
  await page.check('#gen-approval-check');
  await page.click('#gen-confirm');
  await page.waitForTimeout(900);
  await shot(page, '#backup-modal-root .modal-box', '2-9_バックアップ促し.png');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#backup-now-btn'),
  ]);
  await dl.saveAs(BACKUP);
  console.log('  バックアップ書出:', fs.statSync(BACKUP).size, 'bytes');
  await page.waitForTimeout(600);

  // ========== (B) 第1章：バックアップから復元 ==========
  console.log('[B] 第1章 バックアップから復元');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(900);
  await shotRange(page, 'header', 'nav.tabs', '1-1_起動直後.png');
  await page.click('[data-tab="staff"]');
  await page.waitForTimeout(400);
  await shotCard(page, '#staff-count', '1-2_復元前の名簿.png', 340);
  await page.click('[data-tab="history"]');
  await page.waitForTimeout(400);
  await shotCard(page, '#backup-export-btn', '1-3_バックアップ欄.png');
  await page.setInputFiles('#backup-import-input', BACKUP);
  await page.waitForTimeout(3500);
  console.log('  復元ダイアログ:', JSON.stringify(dialogs.slice(-1)));
  await page.click('[data-tab="staff"]');
  await page.waitForTimeout(700);
  await shotCard(page, '#staff-count', '1-4_復元後の名簿.png', 420);

  // ========== (C) 第2章：勤務表の作成 ==========
  console.log('[C] 第2章 勤務表の作成');
  await page.click('[data-tab="generate"]');
  await page.waitForTimeout(600);
  await page.click('#gen-revert');           // 確定済みなので、いったん引き戻して作成前に戻す
  await page.waitForTimeout(1500);

  await shotRange(page, '.period-bar, header', 'nav.tabs', '2-1_処理期の選択.png').catch(async () => {
    await shotRange(page, 'header', 'nav.tabs', '2-1_処理期の選択.png');
  });
  await page.click('[data-tab="staff"]');
  await page.waitForTimeout(500);
  await shotCard(page, '#staff-xlsx-box h2', '2-2_名簿の取り込み.png', 420);
  await page.click('[data-tab="rules"]');
  await page.waitForTimeout(500);
  await shotCard(page, '#panel-rules h2', '2-3_ルール設定.png', 520);
  await page.click('[data-tab="events"]');
  await page.waitForTimeout(500);
  await shotCard(page, '#ev-list-title', '2-4_行事管理.png', 460);

  await page.click('[data-tab="generate"]');
  await page.waitForTimeout(500);
  await page.click('#gen-list-dates');
  await page.waitForTimeout(900);
  await shotTable(page, '#gen-dates-tbody', '2-5_指定日の抽出.png', 560);

  await page.click('#gen-run');
  await page.waitForTimeout(5000);
  await shotTable(page, '#gen-result-tbody', '2-6_作成結果.png', 700);
  await shot(page, '#gen-unassigned-summary', '2-7_未割当の確認.png', 330);
  {
    // 決裁の注意書き〜確定ボタンまで。ボタン行の下端は測りにくいので余白を固定で足す。
    const note = await page.$('#gen-approval-note');
    await page.$eval('#gen-approval-note', (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const nb = await note.boundingBox();
    await page.screenshot({
      path: path.join(OUT, '2-8_決裁と確定.png'),
      clip: { x: Math.max(0, nb.x - 8), y: Math.max(0, nb.y - 8), width: Math.min(nb.width + 16, 1280), height: 150 },
    });
    console.log('  ●', '2-8_決裁と確定.png');
  }

  await page.check('#gen-approval-check');
  await page.click('#gen-confirm');
  await page.waitForTimeout(1000);
  await page.click('#backup-later-btn').catch(() => {});
  await page.waitForTimeout(600);
  await shotRange(page, '#gen-confirmed-banner', '#gen-confirmed-banner', '2-10_確定後のバナー.png');

  // ========== (D) 第3章：交代の反映 ==========
  console.log('[D] 第3章 交代の反映');
  await page.click('[data-tab="history"]');
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('duty_history_v2') || '[]')
      .filter((r) => r.periodId === '2026-H1').sort((a, b) => a.date.localeCompare(b.date));
    const i = h.findIndex((r) => r.date >= '2026-07-01');
    return { a: h[i], b: h[i + 1], other: h[i + 5] };
  });
  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日（${'日月火水木金土'[d.getDay()]}）`;
  };
  const pasteText = [
    `交代相手氏名　${info.b.juniorName}`,
    `申請者　${info.a.juniorName}`,
    `申請日　2026年06月20日（土）16:52`,
    `変更する日付　${fmt(info.b.date)}`,
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'paste_text.txt'), pasteText + '\n');
  console.log('---- 貼り付けテキスト ----\n' + pasteText + '\n--------');
  console.log('  申請者の行:', info.a.date, info.a.juniorName, '/ 別の行:', info.other.date, info.other.juniorName);

  await shotTable(page, '#history-tbody', '3-1_確定済み履歴.png', 500);

  // 正しい行（申請者本人の行）で開く
  await page.click(`button.change-btn[data-level="junior"][data-date="${info.a.date}"]`);
  await page.waitForTimeout(600);
  await shot(page, '#modal-root .modal-box', '3-2_貼り付け前.png', 900);

  // わざと別の行に貼り付けて、行違いのエラー画面を撮る
  await page.fill('#change-text-input', pasteText);
  await page.click('#change-text-parse-btn');
  await page.waitForTimeout(800);
  await shot(page, '#modal-root .modal-box', '3-3_読み取り後.png', 1000);
  await page.click('#change-confirm');
  await page.waitForTimeout(1100);
  await shot(page, '#backup-modal-root .modal-box', '3-6_反映後のバックアップ促し.png');
  await page.click('#backup-later-btn');
  await page.waitForTimeout(700);

  // 行違いのエラー画面
  await page.click(`button.change-btn[data-level="junior"][data-date="${info.other.date}"]`);
  await page.waitForTimeout(600);
  await page.fill('#change-text-input', pasteText);
  await page.click('#change-text-parse-btn');
  await page.waitForTimeout(800);
  await shot(page, '#modal-root .modal-box', '3-4_行違いのエラー.png', 1000);
  await page.click('#change-cancel');
  await page.waitForTimeout(600);

  await shotTable(page, '#history-tbody', '3-5_反映後の履歴.png', 420);
  await shotCard(page, '#change-log-tbody', '3-7_交代の一覧.png', 460);

  console.log('\n完了。ダイアログ:', JSON.stringify(dialogs.map((d) => d.slice(0, 70)), null, 1));
  await browser.close();
})();
