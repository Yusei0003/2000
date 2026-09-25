/** テスト共通のヘルパー。
 *  ブラウザを使うテストは、先に `python3 -m http.server 8899` でアプリを配信しておくこと
 *  （run_all.js を使えば自動で立ち上げる）。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.DUTY_TEST_PORT || 8899;
const URL_HTTP = `http://127.0.0.1:${PORT}/index.html`;
const URL_FILE = 'file://' + path.join(ROOT, 'index.html');
const CHROMIUM = '/opt/pw-browsers/chromium';

function playwright() {
  return require('/opt/node22/lib/node_modules/playwright');
}

/** localStorage のキー（ui.js と対応） */
const KEY = {
  periods: 'duty_periods_v1',
  currentPeriod: 'duty_current_period_v1',
  periodStaff: 'duty_period_staff_v1',
  leaves: 'duty_leaves_v1',
  events: 'duty_fiscal_events_v1',
  history: 'duty_history_v2',
  settings: 'duty_settings_v2',
  changeLog: 'duty_change_log_v1',
  backupState: 'duty_backup_state_v1',
  genSession: 'duty_gen_session_v1',
};

/** ページを開いて localStorage に seed を流し込み、読み込み直す。 */
async function openWithSeed(page, url, seed) {
  await page.goto(url);
  await page.evaluate(([k, s]) => {
    localStorage.clear();
    if (s.periods) localStorage.setItem(k.periods, JSON.stringify(s.periods));
    if (s.currentPeriodId) localStorage.setItem(k.currentPeriod, JSON.stringify(s.currentPeriodId));
    if (s.periodStaff) localStorage.setItem(k.periodStaff, JSON.stringify(s.periodStaff));
    if (s.leaves) localStorage.setItem(k.leaves, JSON.stringify(s.leaves));
    if (s.events) localStorage.setItem(k.events, JSON.stringify(s.events));
    if (s.history) localStorage.setItem(k.history, JSON.stringify(s.history));
    if (s.settings) localStorage.setItem(k.settings, JSON.stringify(s.settings));
  }, [KEY, seed]);
  await page.reload();
  await page.waitForTimeout(900);
}

/** 検証結果をためて、最後にまとめて判定する。 */
class Check {
  constructor(name) { this.name = name; this.errs = []; }
  ok(cond, msg) { if (!cond) this.errs.push(msg); }
  eq(actual, expected, msg) {
    if (actual !== expected) this.errs.push(`${msg}（期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}）`);
  }
  has(text, needle, msg) {
    if (!String(text).includes(needle)) this.errs.push(`${msg}（「${needle}」が見当たらない：${String(text).slice(0, 160)}）`);
  }
  hasNot(text, needle, msg) {
    if (String(text).includes(needle)) this.errs.push(`${msg}（「${needle}」が出ている：${String(text).slice(0, 160)}）`);
  }
  finish() {
    if (this.errs.length) {
      console.log('NG: ' + this.name);
      this.errs.forEach((e) => console.log('   - ' + e));
      process.exit(1);
    }
    console.log('OK: ' + this.name);
    process.exit(0);
  }
}

module.exports = { ROOT, PORT, URL_HTTP, URL_FILE, CHROMIUM, playwright, KEY, openWithSeed, Check };
