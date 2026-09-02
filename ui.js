'use strict';

/* ============================================================
 * 画面制御（app.js のロジックを利用してUIを組み立てる）
 * ============================================================ */

const KEY_STAFF = 'duty_staff_v2'; // 旧形式（処理期共通の名簿）。移行専用に読み込む
const KEY_MONTH_RULES = 'duty_month_rules_v1';
const KEY_FISCAL_EVENTS = 'duty_fiscal_events_v1';
const KEY_SETTINGS = 'duty_settings_v2';
const KEY_HISTORY = 'duty_history_v2';
const KEY_TITLE_LEVEL_MAP = 'duty_title_level_map_v1';
const KEY_LEAVES = 'duty_leaves_v1';
const KEY_PERIODS = 'duty_periods_v1';
const KEY_CURRENT_PERIOD = 'duty_current_period_v1';
const KEY_STAFF_ID_MAP = 'duty_staff_id_map_v1'; // 職員番号→職員ID（処理期をまたいで同一人物を同一IDにするための恒久マップ）
const KEY_PERIOD_STAFF = 'duty_period_staff_v1'; // 処理期ID→職員名簿（処理期ごとの名簿）
const KEY_HISTORY_STAFF = 'duty_history_staff_v1'; // 勤務実績取込のみで登場する、どの処理期の名簿にもいない職員（表示名のみに使用）
const KEY_IMPORT_EXCLUDED = 'duty_import_excluded_v1'; // 処理期ID→Excel名簿取込時に除外された行の一覧（CSV書出用）
const KEY_GEN_SESSION = 'duty_gen_session_v1'; // 処理期ID→勤務表作成タブの作業状態（決裁・確定・引き戻し履歴を含む）
const KEY_CHANGE_LOG = 'duty_change_log_v1'; // 「交代を反映」の履歴（変更前後の職員を記録。交換ペアの検出に使用）

const DEFAULT_SETTINGS = {
  minGapDays: 120,
  newHireMonths: 6,
  specialLookback: 2,
  pairLookbackYears: 2,
  retireLeadMonths: 1,
  standingExcludedDepts: [],
};
const DEFAULT_MONTH_RULES = [
  { id: 'default-1', months: [10, 11], depts: ['商工観光課', '広報係'], note: 'イベントが多いため' },
  { id: 'default-2', months: [12, 1], depts: ['ふるさと納税係'], note: 'ふるさと納税繁忙期のため' },
  { id: 'default-3', months: [1, 2, 3, 4], depts: ['税務課'], note: '' },
];

/** 職名からランク値を引くための対応表（値が低いほど役職が上）。ランクが読み取れない
 *  職員の補完、および既存名簿（rank未保存）の移行に使う。取込対象外の職名も含む。 */
const RANK_BY_TITLE = {
  市長: 10,
  副市長: 20,
  教育長: 30,
  部長: 200,
  次長: 200,
  局長: 200,
  消防長: 200,
  参事: 200,
  課長: 300,
  所長: 300,
  会計管理者: 300,
  室長: 310,
  主幹: 320,
  課長補佐: 400,
  室長補佐: 400,
  消防司令: 400,
  局長補佐: 400,
  副主幹: 420,
  秘書係長: 500,
  脱炭素推進係長: 500,
  政策広報係長: 500,
  財政係長: 500,
  母子保健係長: 500,
  健康推進係長: 500,
  福祉係長: 500,
  地域包括支援センター係長: 500,
  子ども家庭係長: 500,
  コミュニティ係長: 500,
  市民係長: 500,
  市民税係長: 500,
  資産税係長: 500,
  観光係長: 500,
  商工ブランド係長: 500,
  農政係長: 500,
  林政係長: 500,
  水産係長: 500,
  漁港係長: 500,
  道路河川係長: 500,
  住宅政策係長: 500,
  都市計画係長: 500,
  経理係長: 500,
  消防司令補: 500,
  '生涯学習・芸術係長': 500,
  文化財係長: 500,
  選挙係長: 500,
  主査: 520,
  主任: 530,
  主任保健師: 530,
  主任栄養士: 530,
  主任保育士: 530,
  主任調理員: 530,
  消防士長: 530,
  主任学芸員: 530,
  主任用務員: 530,
  主任主事: 600,
  主任技師: 600,
  消防副士長: 600,
  主事: 700,
  栄養士: 700,
  保健師: 700,
  看護師: 700,
  技師: 700,
  消防士: 700,
  指導主事: 700,
  用務員: 700,
  書記: 700,
  主事補: 800,
};
/** Excel取込行のランク値を決める。ランク列が数値として読めればそれを使い、
 *  読めない場合のみ職名からランク対応表で補完する（両方だめならnull＝不明）。 */
function rankForImportRow(r) {
  if (r.rank !== null && r.rank !== undefined && !isNaN(r.rank)) return Number(r.rank);
  const byTitle = RANK_BY_TITLE[r.title];
  return byTitle !== undefined ? byTitle : null;
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('load failed', key, e);
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
/** status: 'ok' | 'note' | 'warning' | 'error'
 *  'error'   ： 人数不足で2名の枠を埋められなかった
 *  'warning' ： 要確認（担当者に判断してほしい緩和・組合せ）
 *  'note'    ： 補足（人数の都合でどうしても避けられない緩和。内容は理由欄に必ず表示する） */
function statusLabel(status) {
  return status === 'ok' ? 'OK' : status === 'error' ? '人数不足' : status === 'note' ? '補足' : '要確認';
}
function statusRowClass(status) {
  return status === 'error' ? 'row-error' : status === 'warning' ? 'row-warning' : status === 'note' ? 'row-note' : '';
}
/** 理由欄の表示（OK以外は必ず理由を表示する） */
function statusReasonHtml(r) {
  if (r.status === 'ok') return 'OK';
  const prefix = r.status === 'error' ? 'エラー：' : r.status === 'note' ? '補足：' : '要確認：';
  return prefix + escapeHtml(r.reason || '');
}
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2200);
}
function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function parseCsv(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => line.split(',').map((c) => c.trim()));
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------
 * 旧データ（v1）からの移行
 * ------------------------------------------------------------ */
function migrateLegacyData() {
  if (!localStorage.getItem(KEY_STAFF) && localStorage.getItem('duty_staff_v1')) {
    try {
      const old = JSON.parse(localStorage.getItem('duty_staff_v1')) || [];
      const migrated = old.map((s) => ({
        id: s.id,
        number: s.number || '',
        name: s.name || '',
        level: s.level,
        title: s.title || '',
        dept: s.dept || '',
        section: s.section || '',
        sideJob: s.sideJob || '',
        citizenExp: !!s.citizenExp,
        deptHistory: Array.isArray(s.deptHistory) ? s.deptHistory : [],
        hireDate: s.hireDate || null,
        retireDate: s.retireDate || null,
        active: s.active !== false,
      }));
      save(KEY_STAFF, migrated);
    } catch (e) {
      console.error('staff migration failed', e);
    }
  }
  if (!localStorage.getItem(KEY_SETTINGS) && localStorage.getItem('duty_settings_v1')) {
    try {
      const old = JSON.parse(localStorage.getItem('duty_settings_v1')) || {};
      save(KEY_SETTINGS, { ...DEFAULT_SETTINGS, ...old });
    } catch (e) {
      console.error('settings migration failed', e);
    }
  }
  if (!localStorage.getItem(KEY_HISTORY) && localStorage.getItem('duty_history_v1')) {
    try {
      const old = JSON.parse(localStorage.getItem('duty_history_v1')) || [];
      const migrated = old.map((h) => ({
        ...h,
        manuallyEdited: !!h.manuallyEdited,
        seniorChangedAt: h.seniorChangedAt || null,
        juniorChangedAt: h.juniorChangedAt || null,
      }));
      save(KEY_HISTORY, migrated);
    } catch (e) {
      console.error('history migration failed', e);
    }
  }
  if (!localStorage.getItem(KEY_FISCAL_EVENTS) && localStorage.getItem('duty_event_exclusions_v1')) {
    try {
      const old = JSON.parse(localStorage.getItem('duty_event_exclusions_v1')) || [];
      const migrated = old.map((e) => ({
        id: e.id || uid('ev'),
        fiscalYear: fiscalYearOf(parseISO(e.date)),
        name: e.label || '',
        date: e.date,
        endDate: e.endDate || e.date,
        leadDays: 0,
        excludeFrom: e.date,
        depts: e.depts || [],
      }));
      save(KEY_FISCAL_EVENTS, migrated);
    } catch (e) {
      console.error('events migration failed', e);
    }
  }
}
migrateLegacyData();

let monthRules = load(KEY_MONTH_RULES, DEFAULT_MONTH_RULES);
let fiscalEvents = load(KEY_FISCAL_EVENTS, []);
let settings = { ...DEFAULT_SETTINGS, ...load(KEY_SETTINGS, {}) };
if (!Array.isArray(settings.standingExcludedDepts)) settings.standingExcludedDepts = [];
let history = load(KEY_HISTORY, []);
let titleLevelMap = load(KEY_TITLE_LEVEL_MAP, {});
let leaves = load(KEY_LEAVES, []);
let periods = load(KEY_PERIODS, []);
let currentPeriodId = load(KEY_CURRENT_PERIOD, null);
let staffIdMap = load(KEY_STAFF_ID_MAP, {}); // 職員番号 -> 職員ID
let periodStaff = load(KEY_PERIOD_STAFF, {}); // 処理期ID -> 職員名簿配列
let periodImportExcluded = load(KEY_IMPORT_EXCLUDED, {}); // 処理期ID -> Excel名簿取込時に除外された行の一覧
let genSessions = load(KEY_GEN_SESSION, {}); // 処理期ID -> 勤務表作成タブの作業状態
let historyStaffStubs = load(KEY_HISTORY_STAFF, []); // どの処理期の名簿にもいない、勤務実績のみの職員
let changeLog = load(KEY_CHANGE_LOG, []); // 「交代を反映」のたびに変更前後の職員を記録する（交換ペアの検出用）

/** 職員番号に対応する恒久的な職員IDを返す（無ければ新規発行して記憶する） */
function idForNumber(number) {
  const key = String(number);
  if (!staffIdMap[key]) {
    staffIdMap[key] = uid('st');
    save(KEY_STAFF_ID_MAP, staffIdMap);
  }
  return staffIdMap[key];
}

/* ------------------------------------------------------------
 * 処理期（年度の前期・後期ごとに作業を進めるための単位）
 * ------------------------------------------------------------ */
/** 処理期レコードを新規作成する（保存はしない） */
function buildPeriod(fiscalYear, half) {
  const range = periodRange(fiscalYear, half);
  return {
    id: periodIdOf(fiscalYear, half),
    fiscalYear,
    half,
    startDate: range.startDate,
    endDate: range.endDate,
    label: periodLabelOf(fiscalYear, half),
    standingExcludedDepts: [],
    sickLeaveExcludedNumbers: [], // 長期病気休暇の延長確認チェックリストで、担当者が対象外にした職員番号
    createdAt: new Date().toISOString(),
  };
}
function periodById(id) {
  return periods.find((p) => p.id === id) || null;
}
/** 処理期の導入前に登録された「常時除外する所属」を、現在の処理期へ移行する */
function migratePeriods() {
  if (periods.length) return;
  const cur = periodOfDate(new Date());
  const p = buildPeriod(cur.fiscalYear, cur.half);
  p.standingExcludedDepts = Array.isArray(settings.standingExcludedDepts) ? [...settings.standingExcludedDepts] : [];
  periods.push(p);
  currentPeriodId = p.id;
  save(KEY_PERIODS, periods);
  save(KEY_CURRENT_PERIOD, currentPeriodId);
}
migratePeriods();
/** 現在選択中の処理期。無ければ今日の日付から自動作成する */
function currentPeriod() {
  let p = periodById(currentPeriodId);
  if (!p) {
    p = periods[periods.length - 1] || null;
    if (!p) {
      const cur = periodOfDate(new Date());
      p = buildPeriod(cur.fiscalYear, cur.half);
      periods.push(p);
      save(KEY_PERIODS, periods);
    }
    currentPeriodId = p.id;
    save(KEY_CURRENT_PERIOD, currentPeriodId);
  }
  if (!Array.isArray(p.standingExcludedDepts)) p.standingExcludedDepts = [];
  return p;
}
function sortPeriods() {
  periods.sort((a, b) => (a.fiscalYear - b.fiscalYear) || (a.half < b.half ? -1 : a.half > b.half ? 1 : 0));
}
/** 直前の処理期の「常時除外する所属」を引き継ぐ（市民課経験・派遣・7割措置は名簿取込時に職員番号単位で引き継がれる） */
function copyFromPreviousPeriod(target) {
  const prev = previousPeriodOf(target.fiscalYear, target.half);
  const src = periodById(periodIdOf(prev.fiscalYear, prev.half));
  if (!src) return null;
  target.standingExcludedDepts = Array.isArray(src.standingExcludedDepts) ? [...src.standingExcludedDepts] : [];
  return src;
}

/* ------------------------------------------------------------
 * 名簿（処理期ごと）
 * ------------------------------------------------------------ */
/** 選択中の処理期の名簿。未取込の処理期では空配列を返す（保存領域には作らない） */
function currentPeriodStaffArray() {
  return periodStaff[currentPeriod().id] || [];
}
/** 選択中の処理期に名簿が取り込まれているか */
function hasRosterForCurrentPeriod() {
  const list = periodStaff[currentPeriod().id];
  return Array.isArray(list) && list.length > 0;
}
let _staffMapCache = null;
function invalidateStaffMapCache() {
  _staffMapCache = null;
}
/** 職員IDから職員を引く（処理期・履歴専用スタブを横断）。履歴・引継ぎ等、期をまたぐ表示専用 */
function allKnownStaffMap() {
  if (_staffMapCache) return _staffMapCache;
  const map = new Map();
  staff.forEach((s) => map.set(s.id, s));
  Object.values(periodStaff).forEach((list) => list.forEach((s) => { if (!map.has(s.id)) map.set(s.id, s); }));
  historyStaffStubs.forEach((s) => { if (!map.has(s.id)) map.set(s.id, s); });
  _staffMapCache = map;
  return map;
}
function resolveAnyStaff(id) {
  return allKnownStaffMap().get(id) || null;
}
/** 現在の名簿（staff配列）を処理期の保存領域へ書き戻す。
 *  空になった場合は保存領域から取り除き、「未取込」の状態に戻す */
function savePeriodStaff() {
  const id = currentPeriod().id;
  if (staff.length) {
    periodStaff[id] = staff;
  } else {
    delete periodStaff[id];
  }
  save(KEY_PERIOD_STAFF, periodStaff);
  invalidateStaffMapCache();
}
/** 処理期切り替え時に staff を現在の処理期の名簿へ差し替える */
function loadStaffForCurrentPeriod() {
  staff = currentPeriodStaffArray();
  invalidateStaffMapCache();
}
/** ひとつ前の処理期の名簿を職員番号で引けるマップ（引き継ぎ用） */
function previousPeriodStaffMap() {
  const p = currentPeriod();
  const prev = previousPeriodOf(p.fiscalYear, p.half);
  const prevList = periodStaff[periodIdOf(prev.fiscalYear, prev.half)] || [];
  const map = new Map();
  prevList.forEach((s) => {
    if (s.number) map.set(String(s.number), s);
  });
  return map;
}

/** 旧形式（処理期共通の名簿）から、処理期ごとの名簿へ一度だけ移行する。
 *  既存の職員IDはそのまま引き継ぐため、確定済み履歴（seniorId/juniorId）は書き換え不要。
 *  名簿は処理期ごとに取り込む運用のため、移行先は「移行時点で選択中の処理期」のみとする。
 *  他の処理期は未取込のままとし、名簿管理タブには表示しない（必要になった時点でExcelを取り込む）。
 *  所属が空の職員（勤務実績Excel取込で作られた履歴専用スタブ）は名簿には含めず、履歴専用スタブへ分離する。 */
function migrateToPerPeriodStaff() {
  if (localStorage.getItem(KEY_PERIOD_STAFF)) return;
  const oldStaff = load(KEY_STAFF, []);
  if (!oldStaff.length) {
    save(KEY_PERIOD_STAFF, {});
    return;
  }
  oldStaff.forEach((s) => {
    if (s.number && !staffIdMap[String(s.number)]) staffIdMap[String(s.number)] = s.id;
  });
  save(KEY_STAFF_ID_MAP, staffIdMap);

  const isStub = (s) => !s.dept;
  const realStaff = oldStaff.filter((s) => !isStub(s));
  const stubs = oldStaff.filter(isStub);

  const target = currentPeriod();
  const citizenSet = new Set((target.citizenExpNumbers || []).map(String));
  periodStaff = {
    [target.id]: realStaff.map((s) => ({
      ...s,
      deptHistory: Array.isArray(s.deptHistory) ? [...s.deptHistory] : [],
      citizenExp: !!s.citizenExp || citizenSet.has(String(s.number)),
    })),
  };
  save(KEY_PERIOD_STAFF, periodStaff);

  historyStaffStubs = historyStaffStubs.concat(stubs);
  save(KEY_HISTORY_STAFF, historyStaffStubs);
}
migrateToPerPeriodStaff();

/** 既存の名簿（rank未保存）を、職名からランク対応表で補完する（再取込不要にするための一度きりの移行）。
 *  職名がランク対応表にない場合（個別登録した職員など）はnull（不明）のままにする。 */
function migrateStaffRanks() {
  let changed = false;
  Object.keys(periodStaff).forEach((pid) => {
    (periodStaff[pid] || []).forEach((s) => {
      if ((s.rank === null || s.rank === undefined) && s.title && RANK_BY_TITLE[s.title] !== undefined) {
        s.rank = RANK_BY_TITLE[s.title];
        changed = true;
      }
    });
  });
  if (changed) save(KEY_PERIOD_STAFF, periodStaff);
}
migrateStaffRanks();

let staff = [];
loadStaffForCurrentPeriod();

/** その処理期が「過去分」（終了日が今日より前）かどうか */
function isPastPeriod(p) {
  return p.endDate < toISO(new Date());
}
function renderPeriodBar() {
  const p = currentPeriod();
  sortPeriods();
  const sel = document.getElementById('period-select');
  sel.innerHTML = periods
    .map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${escapeHtml(x.label)}</option>`)
    .join('');
  document.getElementById('period-range').textContent = `${p.startDate} 〜 ${p.endDate}`;
  const banner = document.getElementById('past-period-banner');
  if (banner) banner.classList.toggle('hidden', !isPastPeriod(p));
  const histLabel = document.getElementById('history-xlsx-period-label');
  if (histLabel) histLabel.textContent = p.label;
}
/** 処理期を切り替える（履歴タブの表示フィルタも連動して切り替える） */
function switchToPeriod(id) {
  currentPeriodId = id;
  save(KEY_CURRENT_PERIOD, currentPeriodId);
  historyPeriodFilter = id;
  renderAllForPeriod();
}
function initPeriodBar() {
  renderPeriodBar();
  document.getElementById('period-select').addEventListener('change', (e) => {
    switchToPeriod(e.target.value);
    showToast(`処理期を「${currentPeriod().label}」に切り替えました`);
  });
  document.getElementById('period-add-btn').addEventListener('click', () => {
    const box = document.getElementById('period-add-box');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      const cur = currentPeriod();
      const next = cur.half === 'H1' ? { fiscalYear: cur.fiscalYear, half: 'H2' } : { fiscalYear: cur.fiscalYear + 1, half: 'H1' };
      document.getElementById('period-new-year').value = next.fiscalYear;
      document.getElementById('period-new-half').value = next.half;
    }
  });
  document.getElementById('period-add-cancel').addEventListener('click', () => {
    document.getElementById('period-add-box').classList.add('hidden');
  });
  document.getElementById('period-create').addEventListener('click', () => {
    const fy = Number(document.getElementById('period-new-year').value);
    const half = document.getElementById('period-new-half').value;
    if (!fy) {
      alert('年度を入力してください。');
      return;
    }
    if (periodById(periodIdOf(fy, half))) {
      alert('その処理期はすでに登録されています。');
      return;
    }
    const p = buildPeriod(fy, half);
    const src = copyFromPreviousPeriod(p);
    periods.push(p);
    sortPeriods();
    save(KEY_PERIODS, periods);
    document.getElementById('period-add-box').classList.add('hidden');
    switchToPeriod(p.id);
    showToast(src ? `${p.label}を作成し、${src.label}の内容を引き継ぎました` : `${p.label}を作成しました`);
  });
  document.getElementById('period-copy-btn').addEventListener('click', () => {
    const p = currentPeriod();
    const prev = previousPeriodOf(p.fiscalYear, p.half);
    const src = periodById(periodIdOf(prev.fiscalYear, prev.half));
    if (!src) {
      alert(`引き継ぎ元となる${periodLabelOf(prev.fiscalYear, prev.half)}が登録されていません。`);
      return;
    }
    if (!confirm(`${src.label}の「常時除外する所属」を${p.label}へコピーします。現在の内容は上書きされます。よろしいですか？`)) {
      return;
    }
    copyFromPreviousPeriod(p);
    save(KEY_PERIODS, periods);
    renderAllForPeriod();
    showToast(`${src.label}の内容をコピーしました`);
  });
  document.getElementById('period-delete-btn').addEventListener('click', () => {
    const p = currentPeriod();
    const linkedCount = history.filter((r) => r.periodId === p.id).length;
    const msg = linkedCount
      ? `「${p.label}」を削除します。この処理期に紐づく確定済み履歴 ${linkedCount} 件は削除されず「未分類」として残ります（ペア重複回避・間隔日数の判定には引き続き使用されます）。よろしいですか？`
      : `「${p.label}」を削除しますか？`;
    if (!confirm(msg)) return;
    history.forEach((r) => {
      if (r.periodId === p.id) r.periodId = null;
    });
    save(KEY_HISTORY, history);
    periods = periods.filter((x) => x.id !== p.id);
    save(KEY_PERIODS, periods);
    delete genSessions[p.id];
    save(KEY_GEN_SESSION, genSessions);
    currentPeriodId = null;
    const next = currentPeriod(); // フォールバックで自動的に別の処理期（無ければ今日の処理期を新規作成）に切り替わる
    historyPeriodFilter = next.id;
    renderAllForPeriod();
    showToast(`「${p.label}」を削除しました。「${next.label}」に切り替えました`);
  });
}
/** 処理期の切り替え時に、処理期に依存する画面をまとめて再描画する */
function renderAllForPeriod() {
  loadStaffForCurrentPeriod();
  renderPeriodBar();
  renderStaffTable();
  renderStandingRuleList();
  renderLeaveTable();
  renderHistoryTable();
  renderCheckTable();
  populateFiscalYearSelect();
  renderEventTable();
  applyPeriodToGenerateTab();
}

let draftDates = []; // 勤務表作成タブの作業中の指定日
let draftResults = []; // 作成された勤務表（未確定、または確定済みの表示内容）
let genStatus = 'draft'; // 'draft'（作成・修正中） | 'confirmed'（決裁・確定済み、編集ロック）
let genConfirmBatchId = null; // 確定時に発行するID。引き戻し時にこのIDを持つ履歴のみ削除する
let genConfirmedAt = null; // 確定（決裁）日時
let genApprovalChecked = false; // 「決裁が完了したことを確認しました」チェックの状態
let genLog = []; // 引き戻しにより解除された過去の確定内容（作成履歴）
let genOptimizeSummary = null; // 作成後の見直し（optimizeAssignments）の結果サマリ
let genFrozenUnassignedHtml = null; // 確定時点の「未割当職員」表示のスナップショット（確定後は再計算せずこれを表示する）
let genFrozenOverburdenedHtml = null; // 確定時点の「担当回数が多い職員」表示のスナップショット
let staffXlsxRows = null; // Excel名簿取込：解析結果の一時保持
let historyXlsxRows = null; // Excel勤務実績取込：解析結果の一時保持
let currentEventYear = fiscalYearOf(new Date());

/* ------------------------------------------------------------
 * タブ切り替え
 * ------------------------------------------------------------ */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'history') {
        renderHistoryTable();
        renderCheckTable();
      }
      if (btn.dataset.tab === 'events') {
        renderEventDeptOptions();
        renderEventTable();
      }
      if (btn.dataset.tab === 'rules') {
        renderStandingRuleList();
      }
      if (btn.dataset.tab === 'docs') {
        renderDocTab();
      }
    });
  });
}

/* ------------------------------------------------------------
 * 仕様書・設計書の表示（docs-content.js に埋め込まれたMarkdownを簡易パーサで描画）
 * ------------------------------------------------------------ */
let currentDocKind = 'spec';
function mdInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function renderMarkdownTable(lines) {
  const rows = lines.map((l) => {
    let t = l.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map((c) => c.trim());
  });
  const header = rows[0] || [];
  const body = rows.slice(2); // 1行目=ヘッダー、2行目=区切り線（---）を除く
  let html = '<div class="table-wrap"><table><thead><tr>' + header.map((h) => `<th>${mdInline(h)}</th>`).join('') + '</tr></thead><tbody>';
  body.forEach((r) => {
    html += '<tr>' + r.map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}
/** アプリで使う範囲のMarkdown（見出し・表・リスト・強調・コード・水平線・段落）のみに対応した簡易パーサ。
 *  file:// では fetch() が使えないため docs-content.js に埋め込んだ文字列を対象に描画する。 */
function renderMarkdownDoc(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  const toc = [];
  let inList = null;
  let i = 0;
  const closeList = () => {
    if (inList) {
      html += `</${inList}>`;
      inList = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line.trim())) {
      closeList();
      html += '<hr>';
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      closeList();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 閉じる ``` を読み飛ばす
      html += `<pre class="doc-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
      continue;
    }
    let m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      closeList();
      const hashes = m[1].length;
      const text = m[2].trim();
      const tag = hashes === 1 ? 'h2' : hashes === 2 ? 'h3' : hashes === 3 ? 'h4' : 'h5';
      const id = `doc-h-${i}`;
      if (hashes === 2) toc.push({ id, text });
      html += `<${tag} id="${id}">${mdInline(text)}</${tag}>`;
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      closeList();
      const tbl = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tbl.push(lines[i]);
        i++;
      }
      html += renderMarkdownTable(tbl);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (inList !== 'ol') {
        closeList();
        html += '<ol>';
        inList = 'ol';
      }
      html += `<li>${mdInline(line.replace(/^\d+\.\s+/, ''))}</li>`;
      i++;
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (inList !== 'ul') {
        closeList();
        html += '<ul>';
        inList = 'ul';
      }
      html += `<li>${mdInline(line.replace(/^-\s+/, ''))}</li>`;
      i++;
      continue;
    }
    closeList();
    html += `<p>${mdInline(line.trim())}</p>`;
    i++;
  }
  closeList();
  const tocHtml = toc.length
    ? `<nav class="doc-toc"><strong>目次</strong><ul>${toc.map((t) => `<li><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join('')}</ul></nav>`
    : '';
  return tocHtml + html;
}
function renderDocTab() {
  const container = document.getElementById('doc-content');
  if (!container) return;
  const md = currentDocKind === 'spec' ? (typeof SPEC_DOC_MD !== 'undefined' ? SPEC_DOC_MD : '') : (typeof DESIGN_DOC_MD !== 'undefined' ? DESIGN_DOC_MD : '');
  container.innerHTML = md
    ? renderMarkdownDoc(md)
    : '<p class="hint">文書を読み込めませんでした（docs-content.js が見つかりません。node build_docs.js を実行してください）。</p>';
}
function initDocsTab() {
  document.querySelectorAll('.doc-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.doc-switch-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentDocKind = btn.dataset.doc;
      renderDocTab();
    });
  });
}

function initHelpToggle() {
  const btn = document.getElementById('help-other-toggle');
  const content = document.getElementById('help-other-content');
  btn.addEventListener('click', () => {
    content.classList.toggle('hidden');
    btn.textContent = content.classList.contains('hidden') ? 'その他使い方を表示する' : 'その他使い方を隠す';
  });
}

/* ------------------------------------------------------------
 * 名簿管理
 * ------------------------------------------------------------ */
function staffById(id) {
  return staff.find((s) => s.id === id) || null;
}
/** 名簿に登録済みの所属を、所属CD順に並べて返す（{name, code}の配列）。CDが無い所属は末尾に名前順で並ぶ */
function sortedDeptList() {
  const codeByName = new Map();
  staff.forEach((s) => {
    if (!s.dept) return;
    if (!codeByName.has(s.dept) || (s.deptCode && !codeByName.get(s.dept))) {
      codeByName.set(s.dept, s.deptCode || null);
    }
  });
  return [...codeByName.entries()]
    .map(([name, code]) => ({ name, code }))
    .sort((a, b) => {
      if (a.code && b.code) return String(a.code).localeCompare(String(b.code), 'ja', { numeric: true });
      if (a.code && !b.code) return -1;
      if (!a.code && b.code) return 1;
      return a.name.localeCompare(b.name, 'ja');
    });
}
function uniqueDepts() {
  return sortedDeptList().map((d) => d.name);
}
/** 所属CD順（無ければ所属名・番号順）で比較する */
function compareByDeptCode(a, b) {
  const ca = a.deptCode || null;
  const cb = b.deptCode || null;
  if (ca && cb) {
    const cmp = String(ca).localeCompare(String(cb), 'ja', { numeric: true });
    if (cmp !== 0) return cmp;
  } else if (ca && !cb) {
    return -1;
  } else if (!ca && cb) {
    return 1;
  }
  const deptCmp = (a.dept || '').localeCompare(b.dept || '', 'ja');
  if (deptCmp !== 0) return deptCmp;
  return String(a.number || '').localeCompare(String(b.number || ''), 'ja', { numeric: true });
}
let staffSearchQuery = '';
function matchesStaffSearch(s, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.number, s.name, s.dept, s.section, s.title]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}
/** 除外理由（表示用）。手動で対象外にした職員には常時除外とは別の理由文言を返す */
function exclusionReason(s) {
  if (s.active === false) return '対象外（手動設定）';
  return standingExcludedReason(s, currentPeriod().standingExcludedDepts) || '';
}
function staffRowHtml(s, { showReason }) {
  const citizen = !!s.citizenExp;
  const autoCitizen = !citizen && effectiveCitizenExp({ ...s, citizenExp: false });
  return `
    <tr>
      <td>${escapeHtml(s.number)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${LEVEL_LABEL[s.level]}</td>
      <td>${s.gender ? GENDER_LABEL[s.gender] : '<span class="muted">未設定</span>'}</td>
      <td>${escapeHtml(s.title || '')}</td>
      <td>${escapeHtml(s.dept)}</td>
      <td>${escapeHtml(s.section || '')}</td>
      <td>${escapeHtml(s.status || '')}</td>
      <td>${s.age != null ? escapeHtml(s.age) : ''}</td>
      <td>
        <label class="checkbox-label" style="gap:4px">
          <input type="checkbox" class="citizen-toggle" data-id="${s.id}" ${citizen ? 'checked' : ''}>
          ${autoCitizen ? '<span class="muted" style="font-size:11px">（自動判定あり）</span>' : ''}
        </label>
      </td>
      <td><input type="checkbox" class="dispatched-toggle" data-id="${s.id}" ${s.dispatched ? 'checked' : ''}></td>
      <td><input type="checkbox" class="seventy-toggle" data-id="${s.id}" ${s.seventyPercent ? 'checked' : ''}></td>
      <td><input type="checkbox" class="election-duty-toggle" data-id="${s.id}" ${s.electionDuty ? 'checked' : ''}></td>
      ${showReason ? `<td>${escapeHtml(exclusionReason(s))}</td>` : ''}
      <td>${escapeHtml(s.hireDate || '')}</td>
      <td><input type="date" class="retire-input" data-id="${s.id}" value="${escapeHtml(s.retireDate || '')}"></td>
      <td><button class="btn-danger" data-del="${s.id}">削除</button></td>
    </tr>`;
}
function attachStaffRowHandlers(tbody) {
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('この職員を削除しますか？（履歴の表示名は残ります）')) return;
      staff = staff.filter((s) => s.id !== btn.dataset.del);
      savePeriodStaff();
      renderStaffTable();
    });
  });
  tbody.querySelectorAll('.citizen-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      staffById(cb.dataset.id).citizenExp = cb.checked;
      savePeriodStaff();
      renderStaffTable();
    });
  });
  tbody.querySelectorAll('.dispatched-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      const s = staffById(cb.dataset.id);
      s.dispatched = cb.checked;
      savePeriodStaff();
      renderStaffTable();
    });
  });
  tbody.querySelectorAll('.seventy-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      const s = staffById(cb.dataset.id);
      s.seventyPercent = cb.checked;
      savePeriodStaff();
      renderStaffTable();
    });
  });
  tbody.querySelectorAll('.election-duty-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      const s = staffById(cb.dataset.id);
      s.electionDuty = cb.checked;
      savePeriodStaff();
      renderStaffTable();
    });
  });
  tbody.querySelectorAll('.retire-input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const s = staffById(inp.dataset.id);
      s.retireDate = inp.value || null;
      savePeriodStaff();
      renderStaffTable();
    });
  });
}
/** 名簿表示を「対象者リスト」（日直の割当対象）と「除外リスト」（常時除外・手動除外）に分けて表示する */
function renderStaffTable() {
  // 名簿を取り込んでいない処理期では、名簿の一覧そのものを表示しない
  const hasRoster = hasRosterForCurrentPeriod();
  const emptyNoteEl = document.getElementById('staff-empty-period-note');
  if (emptyNoteEl) emptyNoteEl.classList.toggle('hidden', hasRoster);
  const rosterBody = document.getElementById('staff-roster-body');
  if (rosterBody) rosterBody.classList.toggle('hidden', !hasRoster);
  const clearBtn = document.getElementById('staff-clear-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasRoster);
  const countEl = document.getElementById('staff-count');
  if (!hasRoster) {
    if (countEl) countEl.textContent = '';
    return;
  }

  const standingDepts = currentPeriod().standingExcludedDepts;
  const visible = staff.filter((s) => matchesStaffSearch(s, staffSearchQuery)).sort(compareByDeptCode);
  const excludedList = visible.filter((s) => s.active === false || isStandingExcluded(s, standingDepts));
  const targetList = visible.filter((s) => !(s.active === false || isStandingExcluded(s, standingDepts)));

  const targetTbody = document.getElementById('staff-tbody-target');
  targetTbody.innerHTML = targetList.map((s) => staffRowHtml(s, { showReason: false })).join('');
  attachStaffRowHandlers(targetTbody);

  const excludedTbody = document.getElementById('staff-tbody-excluded');
  excludedTbody.innerHTML = excludedList.map((s) => staffRowHtml(s, { showReason: true })).join('');
  attachStaffRowHandlers(excludedTbody);

  document.getElementById('staff-count').textContent =
    `${staff.length} 名（係長級 ${staff.filter((s) => s.level === 'senior').length} / 主事級 ${staff.filter((s) => s.level === 'junior').length}）` +
    (staffSearchQuery ? ` ／ 検索結果 ${visible.length} 名` : '');
  document.getElementById('staff-target-count').textContent = `対象者リスト（${targetList.length} 名）`;
  document.getElementById('staff-excluded-count').textContent = `除外リスト（${excludedList.length} 名）`;
}
function initStaffSearch() {
  const input = document.getElementById('staff-search');
  if (!input) return;
  input.addEventListener('input', () => {
    staffSearchQuery = input.value;
    renderStaffTable();
  });
}

function initStaffForm() {

  document.getElementById('staff-import-btn').addEventListener('click', () => {
    document.getElementById('staff-import-box').classList.toggle('hidden');
  });
  document.getElementById('staff-import-cancel').addEventListener('click', () => {
    document.getElementById('staff-import-box').classList.add('hidden');
  });
  document.getElementById('staff-import-run').addEventListener('click', () => {
    const text = document.getElementById('staff-import-text').value;
    if (!text.trim()) return;
    const rows = parseCsv(text).slice(1); // 先頭行はヘッダーとして除外
    const prevMap = previousPeriodStaffMap();
    let count = 0;
    rows.forEach((cols) => {
      const [number, name, levelRaw, dept, citizenRaw, hireDate] = cols;
      if (!name || !dept) return;
      const level = levelRaw && levelRaw.includes('主事') ? 'junior' : 'senior';
      const num = (number || '').trim();
      const carry = num ? prevMap.get(num) : null;
      const rec = {
        id: num ? idForNumber(num) : uid('st'),
        number: num,
        name: name.trim(),
        level,
        rank: (carry && carry.rank) || null,
        title: '',
        dept: dept.trim(),
        section: '',
        sideJob: '',
        deptHistory: [],
        hireDate: (hireDate || '').trim() || null,
        retireDate: (carry && carry.retireDate) || null,
        citizenExp: /true|○|はい/i.test(citizenRaw || '') || !!(carry && carry.citizenExp),
        dispatched: !!(carry && carry.dispatched),
        seventyPercent: !!(carry && carry.seventyPercent),
        electionDuty: !!(carry && carry.electionDuty),
        active: true,
      };
      staff.push(rec);
      count++;
    });
    savePeriodStaff();
    renderStaffTable();
    document.getElementById('staff-import-text').value = '';
    document.getElementById('staff-import-box').classList.add('hidden');
    showToast(`${count}名を取り込みました`);
  });

  document.getElementById('staff-export-btn').addEventListener('click', () => {
    const rows = [['番号', '氏名', '級', '職名', '所属課', '係名', '市民課経験', '採用年月日']].concat(
      staff.map((s) => [s.number, s.name, LEVEL_LABEL[s.level], s.title || '', s.dept, s.section || '', s.citizenExp ? 'TRUE' : 'FALSE', s.hireDate || ''])
    );
    downloadCsv('職員名簿.csv', rows);
  });

  document.getElementById('staff-import-excluded-export-btn').addEventListener('click', () => {
    const excluded = periodImportExcluded[currentPeriod().id] || [];
    if (!excluded.length) {
      alert('この処理期でExcel名簿取込により除外された職員はいません。');
      return;
    }
    const rows = [['職員番号', '区分名', '身分', '名前', '所属名', '職名', '年齢']].concat(
      excluded.map((r) => [r.number, r.category || '', r.status || '', r.name, r.dept || '', r.title || '', r.age != null ? r.age : ''])
    );
    downloadCsv('Excel取込で除外された人.csv', rows);
  });

  document.getElementById('staff-excluded-list-export-btn').addEventListener('click', () => {
    const standingDepts = currentPeriod().standingExcludedDepts;
    const excludedList = staff.filter((s) => s.active === false || isStandingExcluded(s, standingDepts));
    if (!excludedList.length) {
      alert('この処理期の除外リストに該当する職員はいません。');
      return;
    }
    const rows = [['職員番号', '区分名', '身分', '名前', '所属名', '職名', '年齢', '除外理由']].concat(
      excludedList.map((s) => [s.number, s.category || '', s.status || '', s.name, s.dept || '', s.title || '', s.age != null ? s.age : '', exclusionReason(s)])
    );
    downloadCsv('除外リストの人.csv', rows);
  });

  const clearBtn = document.getElementById('staff-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const p = currentPeriod();
      if (!confirm(`「${p.label}」の名簿（${staff.length}名）をすべて削除し、未取込の状態に戻します。よろしいですか？`)) return;
      staff = [];
      savePeriodStaff();
      renderStaffTable();
      renderStandingRuleList();
      showToast(`「${p.label}」の名簿を削除しました`);
    });
  }
}

/* ------------------------------------------------------------
 * Excel（人事システム等の実データ）取込 共通ユーティリティ
 * ------------------------------------------------------------ */
function normalizeHeader(h) {
  return String(h ?? '').replace(/\s+/g, '').trim();
}
function excelValueToISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return toISO(v);
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + Math.round(v) * 86400000);
    return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return null;
}
function excelValueToDateTimeText(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const hh = String(v.getHours()).padStart(2, '0');
    const mm = String(v.getMinutes()).padStart(2, '0');
    return `${toISO(v)} ${hh}:${mm}`;
  }
  if (typeof v === 'string') return v.trim() || null;
  return null;
}
function readWorkbookFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      callback(null, workbook);
    } catch (err) {
      callback(err);
    }
  };
  reader.onerror = () => callback(reader.error);
  reader.readAsArrayBuffer(file);
}
function sheetRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

/* ------------------------------------------------------------
 * Excel名簿データの取込（番号・氏名・職名・所属名・係名・兼職・区分名・採用日等）
 * ------------------------------------------------------------ */
function suggestLevelForTitle(title) {
  const t = String(title || '');
  if (/部長|次長|課長|参事|所長|園長|館長|局長|理事|副市長|市長|教育長/.test(t)) return 'exclude';
  if (/係長|主幹|補佐|専門員/.test(t)) return 'senior';
  if (/主事|主任|技師|技手|保健師|看護師|保育士|栄養士|用務員|技能員/.test(t)) return 'junior';
  return 'exclude';
}
/** ランク（P列）から級を判定する。1〜399:課長級以上(除外) 400〜600:係長級 601〜999:主事級 1000以降:会計年度任用職員等(除外)。
 *  ランクが数値として読めない場合は null（判定不能）を返す。 */
function levelFromRank(rank) {
  if (rank === null || rank === undefined || rank === '' || isNaN(rank)) return null;
  const n = Number(rank);
  if (n >= 1 && n <= 399) return 'exclude';
  if (n >= 400 && n <= 600) return 'senior';
  if (n >= 601 && n <= 999) return 'junior';
  if (n >= 1000) return 'exclude';
  return null;
}
/** 性別（I列）を判定する。1:男性 0:女性。文字列の「男」「女」にも対応。判定できない場合はnull */
function genderFromValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s === '1' || s === '男') return 'M';
  if (s === '0' || s === '女') return 'F';
  return null;
}
function parseStaffWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const headerRowIdx = rows.findIndex((r) => r.some((c) => normalizeHeader(c) === '氏名') && r.some((c) => normalizeHeader(c) === '番号'));
    if (headerRowIdx === -1) continue;
    const headerRow = rows[headerRowIdx].map(normalizeHeader);
    const col = (name) => headerRow.indexOf(name);
    const idxNumber = col('番号');
    const idxName = col('氏名');
    if (idxNumber === -1 || idxName === -1) continue;
    const idxTitle = col('職名');
    const idxDeptCode = col('所属CD');
    const idxDept = col('所属名');
    const idxGender = col('性別');
    const idxSection = col('係名');
    const idxSideJob = col('兼職');
    const idxCategory = col('区分名');
    const idxStatus = col('身分');
    const idxAge = col('年度年齢');
    const idxRank = col('ランク');
    const idxHire = col('採用日');
    const idxRetire = col('退職日');
    const idxActive = col('在職');
    return rows
      .slice(headerRowIdx + 1)
      .filter((r) => r[idxNumber] !== null && r[idxNumber] !== undefined && r[idxName])
      .map((r) => ({
        number: String(r[idxNumber]).trim(),
        name: String(r[idxName]).trim(),
        title: idxTitle >= 0 ? String(r[idxTitle] || '').trim() : '',
        deptCode: idxDeptCode >= 0 && r[idxDeptCode] !== null && r[idxDeptCode] !== undefined ? String(r[idxDeptCode]).trim() : null,
        dept: idxDept >= 0 ? String(r[idxDept] || '').trim() : '',
        gender: idxGender >= 0 ? genderFromValue(r[idxGender]) : null,
        section: idxSection >= 0 ? String(r[idxSection] || '').trim() : '',
        sideJob: idxSideJob >= 0 ? String(r[idxSideJob] || '').trim() : '',
        category: idxCategory >= 0 ? String(r[idxCategory] || '').trim() : '',
        status: idxStatus >= 0 ? String(r[idxStatus] || '').trim() : '',
        age: idxAge >= 0 && r[idxAge] !== null && r[idxAge] !== undefined && r[idxAge] !== '' ? Number(r[idxAge]) : null,
        rank: idxRank >= 0 && r[idxRank] !== null && r[idxRank] !== undefined && r[idxRank] !== '' ? Number(r[idxRank]) : null,
        hireDate: idxHire >= 0 ? excelValueToISO(r[idxHire]) : null,
        retireDate: idxRetire >= 0 ? excelValueToISO(r[idxRetire]) : null,
        activeFlag: idxActive >= 0 ? r[idxActive] : null,
      }));
  }
  return null;
}
/** ランクで級が判定できる行にはマッピング不要。判定できない行のみ職名マッピングの対象とする */
function needsTitleMapping(r) {
  return !isExcludedCategory(r.category) && levelFromRank(r.rank) === null;
}
function resolveImportLevel(r) {
  const byRank = levelFromRank(r.rank);
  if (byRank !== null) return byRank;
  const titleKey = r.title || '（職名なし）';
  return titleLevelMap[titleKey] || suggestLevelForTitle(r.title);
}
function renderStaffXlsxMapping() {
  const tbody = document.getElementById('staff-xlsx-mapping-tbody');
  const mappingBox = document.getElementById('staff-xlsx-mapping-box');
  const noMappingNote = document.getElementById('staff-xlsx-no-mapping-note');
  const titleCounts = new Map();
  staffXlsxRows.forEach((r) => {
    if (!needsTitleMapping(r)) return; // ランクで判定できる行はマッピング対象外
    const key = r.title || '（職名なし）';
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });
  const titles = [...titleCounts.keys()].sort();
  if (!titles.length) {
    mappingBox.classList.add('hidden');
    noMappingNote.classList.remove('hidden');
  } else {
    mappingBox.classList.remove('hidden');
    noMappingNote.classList.add('hidden');
    tbody.innerHTML = titles
      .map((title) => {
        const current = titleLevelMap[title] || suggestLevelForTitle(title);
        const opt = (value, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
        return `
    <tr>
      <td>${escapeHtml(title)}</td>
      <td>${titleCounts.get(title)}</td>
      <td><select class="title-level-select" data-title="${escapeHtml(title)}">${opt('senior', '係長級')}${opt('junior', '主事級')}${opt('exclude', '取り込まない')}</select></td>
    </tr>`;
      })
      .join('');
  }
  document.getElementById('staff-xlsx-confirm').disabled = false;
}
function isExcludedCategory(category) {
  return category === '会計年度任用職員' || category === '派遣';
}
function initStaffXlsxImport() {
  document.getElementById('staff-xlsx-cancel').addEventListener('click', () => {
    document.getElementById('staff-xlsx-input').value = '';
    document.getElementById('staff-xlsx-mapping-tbody').innerHTML = '';
    document.getElementById('staff-xlsx-mapping-box').classList.add('hidden');
    document.getElementById('staff-xlsx-no-mapping-note').classList.add('hidden');
    document.getElementById('staff-xlsx-summary').textContent = '';
    document.getElementById('staff-xlsx-confirm').disabled = true;
    staffXlsxRows = null;
  });
  document.getElementById('staff-xlsx-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readWorkbookFile(file, (err, workbook) => {
      if (err) {
        alert('ファイルの読み込みに失敗しました：' + err.message);
        return;
      }
      const rows = parseStaffWorkbook(workbook);
      if (!rows || !rows.length) {
        alert('名簿データの列（番号・氏名など）が見つかりませんでした。ファイル形式をご確認ください。');
        return;
      }
      staffXlsxRows = rows;
      const excludedByCategory = rows.filter((r) => isExcludedCategory(r.category)).length;
      const excludedByRank = rows.filter((r) => !isExcludedCategory(r.category) && levelFromRank(r.rank) === 'exclude').length;
      const genderUnknown = rows.filter((r) => !isExcludedCategory(r.category) && levelFromRank(r.rank) !== 'exclude' && !r.gender).length;
      document.getElementById('staff-xlsx-summary').textContent =
        `${rows.length} 件のデータを検出しました（区分による除外対象 ${excludedByCategory} 件・ランクによる除外対象 ${excludedByRank} 件）。内容を確認してください。` +
        (genderUnknown ? `　※性別（I列）が読み取れない職員が ${genderUnknown} 件あります。日直のペアは性別ルールで割り当てるため、該当職員は割当対象になりません。` : '');
      renderStaffXlsxMapping();
    });
  });
  document.getElementById('staff-xlsx-confirm').addEventListener('click', () => {
    if (!staffXlsxRows) return;
    if (staff.length && !confirm(`「${currentPeriod().label}」の現在の名簿（${staff.length}名）を、今回取り込む内容で置き換えます。よろしいですか？`)) {
      return;
    }
    document.querySelectorAll('.title-level-select').forEach((sel) => {
      titleLevelMap[sel.dataset.title] = sel.value;
    });
    save(KEY_TITLE_LEVEL_MAP, titleLevelMap);

    const prevMap = previousPeriodStaffMap();
    const periodStartDate = currentPeriod().startDate;
    let imported = 0;
    let skipped = 0;
    let skippedByCategory = 0;
    let carriedCitizen = 0;
    let autoCitizen = 0;
    let carriedDispatched = 0;
    let carriedSeventy = 0;
    let carriedElectionDuty = 0;
    const newStaff = [];
    const excludedRows = [];
    staffXlsxRows.forEach((r) => {
      if (isExcludedCategory(r.category)) {
        skippedByCategory++;
        excludedRows.push({ ...r, reason: '区分による除外' });
        return;
      }
      const level = resolveImportLevel(r);
      if (level === 'exclude') {
        skipped++;
        excludedRows.push({ ...r, reason: '職名から級を判定できないため除外' });
        return;
      }
      const alreadyRetired = (r.retireDate && r.retireDate < periodStartDate) || r.activeFlag === 0 || r.activeFlag === '0';
      if (alreadyRetired) {
        skipped++;
        excludedRows.push({ ...r, reason: '退職済みのため除外' });
        return;
      }
      const prev = prevMap.get(r.number);
      const isCitizenDept = !!(r.dept && r.dept.includes('市民課'));
      const carriedIsCitizen = !!(prev && prev.citizenExp);
      const citizenExp = isCitizenDept || carriedIsCitizen;
      if (isCitizenDept && !carriedIsCitizen) autoCitizen++;
      else if (carriedIsCitizen) carriedCitizen++;
      const dispatched = !!(prev && prev.dispatched);
      if (dispatched) carriedDispatched++;
      const seventyPercent = !!(prev && prev.seventyPercent);
      if (seventyPercent) carriedSeventy++;
      const electionDuty = !!(prev && prev.electionDuty);
      if (electionDuty) carriedElectionDuty++;
      const deptHistory = prev ? [...(prev.deptHistory || [])] : [];
      if (prev && prev.dept && prev.dept !== r.dept && !deptHistory.includes(prev.dept)) deptHistory.push(prev.dept);

      newStaff.push({
        id: idForNumber(r.number),
        number: r.number,
        name: r.name,
        level,
        rank: rankForImportRow(r),
        title: r.title,
        dept: r.dept,
        deptCode: r.deptCode,
        gender: r.gender,
        section: r.section,
        sideJob: r.sideJob,
        category: r.category,
        status: r.status,
        age: r.age,
        citizenExp,
        dispatched,
        seventyPercent,
        electionDuty,
        deptHistory,
        hireDate: r.hireDate,
        retireDate: r.retireDate || (prev && prev.retireDate) || null,
        active: true,
      });
      imported++;
    });
    staff = newStaff;
    savePeriodStaff();
    periodImportExcluded[currentPeriod().id] = excludedRows;
    save(KEY_IMPORT_EXCLUDED, periodImportExcluded);
    renderStaffTable();
    renderStandingRuleList();
    document.getElementById('staff-xlsx-input').value = '';
    document.getElementById('staff-xlsx-mapping-tbody').innerHTML = '';
    document.getElementById('staff-xlsx-mapping-box').classList.add('hidden');
    document.getElementById('staff-xlsx-no-mapping-note').classList.add('hidden');
    staffXlsxRows = null;
    document.getElementById('staff-xlsx-confirm').disabled = true;
    const carryParts = [];
    if (carriedCitizen || autoCitizen) carryParts.push(`市民課経験${carriedCitizen + autoCitizen}名（現所属からの自動判定${autoCitizen}名を含む）`);
    if (carriedDispatched) carryParts.push(`派遣${carriedDispatched}名`);
    if (carriedSeventy) carryParts.push(`7割措置${carriedSeventy}名`);
    if (carriedElectionDuty) carryParts.push(`選挙管理委員会（併任）${carriedElectionDuty}名`);
    document.getElementById('staff-xlsx-summary').textContent =
      `「${currentPeriod().label}」の名簿を ${imported} 件で置き換えました（対象外 ${skipped} 件・区分除外 ${skippedByCategory} 件）。` +
      (carryParts.length ? `前回処理期から ${carryParts.join('・')} を引き継ぎました。` : '');
    showToast('名簿を取り込みました');
  });
}

/* ------------------------------------------------------------
 * ルール設定：基本設定・資格要件・常時除外
 * ------------------------------------------------------------ */
function renderOptions() {
  document.getElementById('opt-mingap').value = settings.minGapDays;
  document.getElementById('opt-newhire').value = settings.newHireMonths;
  document.getElementById('opt-lookback').value = settings.specialLookback;
  document.getElementById('opt-pair-lookback').value = settings.pairLookbackYears;
  document.getElementById('opt-retire-lead').value = settings.retireLeadMonths;
}
function initOptions() {
  renderOptions();
  document.getElementById('opt-save').addEventListener('click', () => {
    settings.minGapDays = Number(document.getElementById('opt-mingap').value) || 0;
    settings.newHireMonths = Number(document.getElementById('opt-newhire').value) || 0;
    settings.specialLookback = Number(document.getElementById('opt-lookback').value) || 0;
    settings.pairLookbackYears = Number(document.getElementById('opt-pair-lookback').value) || 0;
    settings.retireLeadMonths = Number(document.getElementById('opt-retire-lead').value) || 0;
    save(KEY_SETTINGS, settings);
    showToast('設定を保存しました');
  });
}

/** 育休等による除外期間：職員番号・区分・開始日・終了日の一覧表示 */
/** 育休・産休期間が処理期の範囲と重なるか（開始日が処理期終了日以前、かつ終了日未定または処理期開始日以降） */
function leaveOverlapsPeriod(lv, p) {
  if (lv.startDate > p.endDate) return false;
  if (lv.endDate && lv.endDate < p.startDate) return false;
  return true;
}
function renderLeaveTable() {
  const tbody = document.getElementById('leave-tbody');
  const p = currentPeriod();
  const visible = leaves.filter((lv) => leaveOverlapsPeriod(lv, p));
  const sorted = [...visible].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  tbody.innerHTML = sorted
    .map((lv) => {
      const s = staff.find((x) => String(x.number) === String(lv.staffNumber));
      const name = s ? escapeHtml(s.name) : lv.importedName
        ? `${escapeHtml(lv.importedName)}<span class="muted">（名簿になし）</span>`
        : '<span class="muted">（名簿に該当職員なし）</span>';
      return `
    <tr>
      <td>${escapeHtml(lv.staffNumber)}</td>
      <td>${name}</td>
      <td>${escapeHtml(lv.category || '')}</td>
      <td>${escapeHtml(lv.startDate)}</td>
      <td>${lv.endDate ? escapeHtml(lv.endDate) : '<span class="muted">未定</span>'}</td>
      <td><button class="btn-danger" data-del="${lv.id}">削除</button></td>
    </tr>`;
    })
    .join('');
  const countEl = document.getElementById('leave-count');
  if (countEl) countEl.textContent = `${visible.length} 件` + (leaves.length !== visible.length ? `（全処理期では ${leaves.length} 件）` : '');
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      leaves = leaves.filter((lv) => lv.id !== btn.dataset.del);
      save(KEY_LEAVES, leaves);
      renderLeaveTable();
    });
  });
  renderSickLeaveExtensionList();
}

/* ------------------------------------------------------------
 * 長期病気休暇の延長確認チェックリスト
 * ------------------------------------------------------------
 * 病気休暇は実績ベースで登録されるため、勤務表作成時点では処理期内の
 * 病気休暇がまだ登録されていないことが多い。処理期開始の3ヶ月前までに
 * 開始していた（＝長期化している）病気休暇のうち、この処理期と重なる
 * ものを候補としてリストアップし、延長の可能性があるかどうかを担当者が
 * チェックで判断する。チェックした職員は、実際の病気休暇の登録終了日に
 * 関係なく、この処理期の間ずっと割当対象から除外する。
 * ------------------------------------------------------------ */
/** 処理期開始の3ヶ月以上前から始まっている病気休暇のうち、この処理期と重なるものを返す */
function sickLeaveExtensionCandidates(period) {
  const threshold = toISO(addMonths(parseISO(period.startDate), -3));
  return leaves
    .filter((lv) => lv.kind === 'sick' && lv.startDate <= threshold && leaveOverlapsPeriod(lv, period))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}
function renderSickLeaveExtensionList() {
  const card = document.getElementById('sick-leave-extension-card');
  if (!card) return;
  const p = currentPeriod();
  const candidates = sickLeaveExtensionCandidates(p);
  card.classList.toggle('hidden', candidates.length === 0);
  if (!candidates.length) return;
  const excludedSet = new Set((p.sickLeaveExcludedNumbers || []).map(String));
  const tbody = document.getElementById('sick-leave-extension-tbody');
  tbody.innerHTML = candidates
    .map((lv) => {
      const s = staff.find((x) => String(x.number) === String(lv.staffNumber));
      const name = s ? escapeHtml(s.name) : lv.importedName ? `${escapeHtml(lv.importedName)}<span class="muted">（名簿になし）</span>` : '<span class="muted">（名簿に該当職員なし）</span>';
      const checked = excludedSet.has(String(lv.staffNumber));
      return `
    <tr>
      <td><input type="checkbox" class="sick-extension-toggle" data-number="${escapeHtml(lv.staffNumber)}" ${checked ? 'checked' : ''}></td>
      <td>${escapeHtml(lv.staffNumber)}</td>
      <td>${name}</td>
      <td>${escapeHtml(lv.category || '')}</td>
      <td>${escapeHtml(lv.startDate)}</td>
      <td>${lv.endDate ? escapeHtml(lv.endDate) : '<span class="muted">未定</span>'}</td>
    </tr>`;
    })
    .join('');
  tbody.querySelectorAll('.sick-extension-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      const number = cb.dataset.number;
      const cur = currentPeriod();
      const set = new Set((cur.sickLeaveExcludedNumbers || []).map(String));
      if (cb.checked) set.add(number);
      else set.delete(number);
      cur.sickLeaveExcludedNumbers = [...set];
      save(KEY_PERIODS, periods);
    });
  });
}
/** 長期病気休暇の延長確認でチェックされた職員を、この処理期の間ずっと除外する
 *  仮想的な育休等除外期間（leaves）として合成し、実際のleavesに追加して返す。
 *  勤務表作成・未割当理由の説明の両方で、この合成後の配列を渡す。 */
function effectiveLeavesForPeriod(period) {
  const excludedNumbers = period.sickLeaveExcludedNumbers || [];
  if (!excludedNumbers.length) return leaves;
  const synthetic = excludedNumbers.map((number) => ({
    id: `sick-ext-${period.id}-${number}`,
    staffNumber: String(number),
    startDate: period.startDate,
    endDate: period.endDate,
    category: '病気休暇（延長確認によりこの処理期は除外）',
    importedName: '',
    kind: 'sick',
  }));
  return leaves.concat(synthetic);
}
/** 育休Excelを解析する（職員番号・氏名・区分・開始・終了の列を読む）
 *  B列とD列がどちらも「氏名」のため、先に現れる列（職員氏名）を採用する */
function parseLeaveWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const headerRowIdx = rows.findIndex(
      (r) => r.some((c) => normalizeHeader(c) === '職員番号') && r.some((c) => normalizeHeader(c) === '開始')
    );
    if (headerRowIdx === -1) continue;
    const headerRow = rows[headerRowIdx].map(normalizeHeader);
    const col = (name) => headerRow.indexOf(name);
    const idxNumber = col('職員番号');
    const idxName = col('氏名');
    const idxCategory = col('区分');
    const idxStart = col('開始');
    const idxEnd = col('終了');
    if (idxNumber === -1 || idxStart === -1) continue;
    return rows
      .slice(headerRowIdx + 1)
      .filter((r) => r[idxNumber] !== null && r[idxNumber] !== undefined && r[idxNumber] !== '')
      .map((r) => ({
        staffNumber: String(r[idxNumber]).trim(),
        name: idxName >= 0 ? String(r[idxName] || '').trim() : '',
        category: idxCategory >= 0 ? String(r[idxCategory] || '').trim() : '',
        startDate: excelValueToISO(r[idxStart]),
        endDate: idxEnd >= 0 ? excelValueToISO(r[idxEnd]) : null,
        kind: 'childcare',
      }))
      .filter((r) => r.startDate);
  }
  return null;
}
/** 産休Excelを解析する（職員番号・氏名・出産予定日・出産日・産前休暇・産後休暇・備考の列を読む）
 *  除外期間は「産前休暇」（開始日）〜「産後休暇」（終了日）の範囲。産後休暇が空欄の場合は終了日未定として扱う */
function parseMaternityWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const headerRowIdx = rows.findIndex(
      (r) => r.some((c) => normalizeHeader(c) === '職員番号') && r.some((c) => normalizeHeader(c) === '産前休暇')
    );
    if (headerRowIdx === -1) continue;
    const headerRow = rows[headerRowIdx].map(normalizeHeader);
    const col = (name) => headerRow.indexOf(name);
    const idxNumber = col('職員番号');
    const idxName = col('氏名');
    const idxStart = col('産前休暇');
    const idxEnd = col('産後休暇');
    if (idxNumber === -1 || idxStart === -1) continue;
    return rows
      .slice(headerRowIdx + 1)
      .filter((r) => r[idxNumber] !== null && r[idxNumber] !== undefined && r[idxNumber] !== '')
      .map((r) => ({
        staffNumber: String(r[idxNumber]).trim(),
        name: idxName >= 0 ? String(r[idxName] || '').trim() : '',
        category: '産休',
        startDate: excelValueToISO(r[idxStart]),
        endDate: idxEnd >= 0 ? excelValueToISO(r[idxEnd]) : null,
        kind: 'maternity',
      }))
      .filter((r) => r.startDate);
  }
  return null;
}
/** 病気休暇Excelを解析する（職員番号・氏名・病名・開始・終了の列を読む）
 *  「区分」欄には病名をそのまま表示するため、category に病名の文字列をそのまま入れる */
function parseSickLeaveWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const headerRowIdx = rows.findIndex(
      (r) =>
        r.some((c) => normalizeHeader(c) === '職員番号') &&
        r.some((c) => normalizeHeader(c) === '病名') &&
        r.some((c) => normalizeHeader(c) === '開始')
    );
    if (headerRowIdx === -1) continue;
    const headerRow = rows[headerRowIdx].map(normalizeHeader);
    const col = (name) => headerRow.indexOf(name);
    const idxNumber = col('職員番号');
    const idxName = col('氏名');
    const idxDisease = col('病名');
    const idxStart = col('開始');
    const idxEnd = col('終了');
    if (idxNumber === -1 || idxStart === -1) continue;
    return rows
      .slice(headerRowIdx + 1)
      .filter((r) => r[idxNumber] !== null && r[idxNumber] !== undefined && r[idxNumber] !== '')
      .map((r) => ({
        staffNumber: String(r[idxNumber]).trim(),
        name: idxName >= 0 ? String(r[idxName] || '').trim() : '',
        category: idxDisease >= 0 ? String(r[idxDisease] || '').trim() : '病気休暇',
        startDate: excelValueToISO(r[idxStart]),
        endDate: idxEnd >= 0 ? excelValueToISO(r[idxEnd]) : null,
        kind: 'sick',
      }))
      .filter((r) => r.startDate);
  }
  return null;
}
/** 育休・産休・病気休暇Excelの解析結果を育休等除外期間（leaves）へ取り込む共通処理。
 *  名簿にない職員番号（会計年度任用職員等）の行は取込対象外とする。
 *  kind（'childcare'/'maternity'/'sick'）は、産休終了後の育休みなし判定（app.js
 *  isOnLeave）や、長期病気休暇の延長確認リストの絞り込みに使う機械可読な区分。 */
function importLeaveRows(rows, kindLabel) {
  let added = 0;
  let duplicated = 0;
  let skippedUnknown = 0;
  const knownNumbers = new Set(staff.map((s) => String(s.number)));
  rows.forEach((r) => {
    if (!knownNumbers.has(r.staffNumber)) {
      skippedUnknown++;
      return;
    }
    const dup = leaves.some(
      (lv) =>
        String(lv.staffNumber) === r.staffNumber && lv.startDate === r.startDate && (lv.endDate || null) === (r.endDate || null)
    );
    if (dup) {
      duplicated++;
      return;
    }
    leaves.push({
      id: uid('lv'),
      staffNumber: r.staffNumber,
      startDate: r.startDate,
      endDate: r.endDate,
      category: r.category || '',
      importedName: r.name || '',
      kind: r.kind || null,
    });
    added++;
  });
  save(KEY_LEAVES, leaves);
  renderLeaveTable();
  showToast(
    `${kindLabel}データを取り込みました（新規${added}件・重複${duplicated}件スキップ` +
      (skippedUnknown ? `・名簿にない職員${skippedUnknown}件は対象外` : '') +
      '）'
  );
}
function initLeaveXlsxImport() {
  const input = document.getElementById('leave-xlsx-input');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readWorkbookFile(file, (err, workbook) => {
      e.target.value = '';
      if (err) {
        alert('ファイルの読み込みに失敗しました：' + err.message);
        return;
      }
      const rows = parseLeaveWorkbook(workbook);
      if (!rows || !rows.length) {
        alert('育休データの列（職員番号・開始など）が見つかりませんでした。ファイル形式をご確認ください。');
        return;
      }
      importLeaveRows(rows, '育休');
    });
  });
}
function initMaternityXlsxImport() {
  const input = document.getElementById('maternity-xlsx-input');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readWorkbookFile(file, (err, workbook) => {
      e.target.value = '';
      if (err) {
        alert('ファイルの読み込みに失敗しました：' + err.message);
        return;
      }
      const rows = parseMaternityWorkbook(workbook);
      if (!rows || !rows.length) {
        alert('産休データの列（職員番号・産前休暇など）が見つかりませんでした。ファイル形式をご確認ください。');
        return;
      }
      importLeaveRows(rows, '産休');
    });
  });
}
function initSickLeaveXlsxImport() {
  const input = document.getElementById('sick-leave-xlsx-input');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readWorkbookFile(file, (err, workbook) => {
      e.target.value = '';
      if (err) {
        alert('ファイルの読み込みに失敗しました：' + err.message);
        return;
      }
      const rows = parseSickLeaveWorkbook(workbook);
      if (!rows || !rows.length) {
        alert('病気休暇データの列（職員番号・病名・開始など）が見つかりませんでした。ファイル形式をご確認ください。');
        return;
      }
      importLeaveRows(rows, '病気休暇');
    });
  });
}

function initLeaveForm() {
  renderLeaveTable();
}

/** 常時除外する所属：名簿に登録済みの所属（所属CD順）をチェックボックスで表示する */
function renderStandingRuleList() {
  const el = document.getElementById('standing-rule-list');
  const depts = sortedDeptList();
  if (!depts.length) {
    el.innerHTML = '<span class="empty-hint">名簿に所属が登録されていません</span>';
    return;
  }
  const p = currentPeriod();
  el.innerHTML = depts
    .map(
      ({ name }) => `
    <label class="checkbox-label" style="gap:6px">
      <input type="checkbox" class="standing-dept-toggle" value="${escapeHtml(name)}" ${p.standingExcludedDepts.includes(name) ? 'checked' : ''}>
      ${escapeHtml(name)}
    </label>`
    )
    .join('');
  el.querySelectorAll('.standing-dept-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      const cp = currentPeriod();
      if (cb.checked) {
        if (!cp.standingExcludedDepts.includes(cb.value)) cp.standingExcludedDepts.push(cb.value);
      } else {
        cp.standingExcludedDepts = cp.standingExcludedDepts.filter((d) => d !== cb.value);
      }
      save(KEY_PERIODS, periods);
      renderStaffTable();
    });
  });
}
function initStandingRuleForm() {
  renderStandingRuleList();
}

function renderMonthRuleTable() {
  const tbody = document.getElementById('monthrule-tbody');
  tbody.innerHTML = monthRules
    .map(
      (r) => `
    <tr>
      <td>${r.months.map((m) => m + '月').join('・')}</td>
      <td>${r.depts.map(escapeHtml).join('、')}</td>
      <td>${escapeHtml(r.note || '')}</td>
      <td><button class="btn-danger" data-del="${r.id}">削除</button></td>
    </tr>`
    )
    .join('');
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      monthRules = monthRules.filter((r) => r.id !== btn.dataset.del);
      save(KEY_MONTH_RULES, monthRules);
      renderMonthRuleTable();
    });
  });
}
function initMonthRuleForm() {
  document.getElementById('monthrule-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const months = document
      .getElementById('mr-months')
      .value.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 1 && n <= 12);
    const depts = document
      .getElementById('mr-depts')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!months.length || !depts.length) return;
    monthRules.push({ id: uid('mr'), months, depts, note: document.getElementById('mr-note').value.trim() });
    save(KEY_MONTH_RULES, monthRules);
    renderMonthRuleTable();
    e.target.reset();
  });
}

/* ------------------------------------------------------------
 * 行事管理（年度別）
 * ------------------------------------------------------------ */
function populateFiscalYearSelect() {
  const sel = document.getElementById('ev-fiscal-year');
  const thisFY = fiscalYearOf(new Date());
  const years = new Set([thisFY - 1, thisFY, thisFY + 1, thisFY + 2]);
  fiscalEvents.forEach((e) => years.add(e.fiscalYear));
  const sorted = [...years].sort((a, b) => a - b);
  const keep = currentEventYear;
  sel.innerHTML = sorted.map((y) => `<option value="${y}" ${y === keep ? 'selected' : ''}>${y}年度</option>`).join('');
  sel.value = String(keep);
  sel.onchange = () => {
    currentEventYear = Number(sel.value);
    renderEventTable();
    renderPrevYearEventReference();
  };
}
function renderEventDeptOptions() {
  const sel = document.getElementById('ev-depts');
  const depts = uniqueDepts();
  sel.innerHTML = depts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
}
function recalcExcludeFrom() {
  const dateVal = document.getElementById('ev-date').value;
  const lead = Number(document.getElementById('ev-lead').value) || 0;
  if (!dateVal) return;
  const from = addDays(parseISO(dateVal), -lead);
  document.getElementById('ev-exclude-from').value = toISO(from);
}
/** 除外を続ける日数（行事日の何日後まで）から終了日を自動計算する（既定0日で行事日当日まで） */
function recalcEndDate() {
  const dateVal = document.getElementById('ev-date').value;
  const after = Number(document.getElementById('ev-after').value) || 0;
  if (!dateVal) return;
  const to = addDays(parseISO(dateVal), after);
  document.getElementById('ev-end').value = toISO(to);
}
function renderEventTable() {
  document.getElementById('ev-list-title').textContent = `${currentEventYear}年度の行事一覧`;
  const tbody = document.getElementById('event-tbody');
  const list = fiscalEvents.filter((e) => e.fiscalYear === currentEventYear).sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  tbody.innerHTML = list
    .map(
      (e) => `
    <tr>
      <td>${escapeHtml(e.name || '')}</td>
      <td>${escapeHtml(e.date || '')}</td>
      <td>${escapeHtml(e.excludeFrom || '')}${e.endDate ? ' 〜 ' + escapeHtml(e.endDate) : ''}</td>
      <td>${(e.depts || []).map(escapeHtml).join('、')}</td>
      <td>${e.targetElectionDuty ? '対象' : ''}</td>
      <td><button class="btn-danger" data-del="${e.id}">削除</button></td>
    </tr>`
    )
    .join('');
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fiscalEvents = fiscalEvents.filter((e) => e.id !== btn.dataset.del);
      save(KEY_FISCAL_EVENTS, fiscalEvents);
      renderEventTable();
    });
  });
}
/** 参考表示：ひとつ前の年度に登録済みの行事一覧（読み取り専用） */
function renderPrevYearEventReference() {
  const el = document.getElementById('ev-prev-year-ref');
  if (!el) return;
  const prevYear = currentEventYear - 1;
  document.getElementById('ev-prev-year-ref-title').textContent = `${prevYear}年度の登録状況（参考）`;
  const list = fiscalEvents.filter((e) => e.fiscalYear === prevYear).sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  if (!list.length) {
    el.innerHTML = `<span class="empty-hint">${prevYear}年度の行事は登録されていません。</span>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>行事名</th><th>行事日</th><th>除外開始日〜終了日</th><th>除外する所属</th><th>選挙管理委員会（併任）</th></tr></thead>
      <tbody>
        ${list
          .map(
            (e) => `
        <tr>
          <td>${escapeHtml(e.name || '')}</td>
          <td>${escapeHtml(e.date || '')}</td>
          <td>${escapeHtml(e.excludeFrom || '')}${e.endDate ? ' 〜 ' + escapeHtml(e.endDate) : ''}</td>
          <td>${(e.depts || []).map(escapeHtml).join('、')}</td>
          <td>${e.targetElectionDuty ? '対象' : ''}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}
function initEventForm() {
  populateFiscalYearSelect();
  renderEventDeptOptions();
  renderEventTable();
  renderPrevYearEventReference();

  document.getElementById('ev-date').addEventListener('change', recalcExcludeFrom);
  document.getElementById('ev-lead').addEventListener('change', recalcExcludeFrom);
  document.getElementById('ev-date').addEventListener('change', recalcEndDate);
  document.getElementById('ev-after').addEventListener('change', recalcEndDate);

  document.getElementById('event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('ev-label').value.trim();
    const date = document.getElementById('ev-date').value;
    const afterDays = Number(document.getElementById('ev-after').value) || 0;
    const endDate = document.getElementById('ev-end').value || date;
    const leadDays = Number(document.getElementById('ev-lead').value) || 0;
    const excludeFrom = document.getElementById('ev-exclude-from').value || date;
    const depts = [...document.getElementById('ev-depts').selectedOptions].map((o) => o.value);
    const targetElectionDuty = document.getElementById('ev-target-election').checked;
    if (!date || (!depts.length && !targetElectionDuty)) {
      alert('行事日を入力し、除外する所属を選ぶか「選挙管理委員会事務局を併任している職員も対象にする」にチェックしてください');
      return;
    }
    fiscalEvents.push({
      id: uid('ev'),
      fiscalYear: currentEventYear,
      name,
      date,
      endDate,
      leadDays,
      excludeFrom,
      afterDays,
      depts,
      targetElectionDuty,
    });
    save(KEY_FISCAL_EVENTS, fiscalEvents);
    renderEventTable();
    e.target.reset();
    document.getElementById('ev-lead').value = 30;
    document.getElementById('ev-after').value = 10;
  });

  document.getElementById('ev-copy-prev').addEventListener('click', () => {
    const prevYear = currentEventYear - 1;
    const prevEvents = fiscalEvents.filter((e) => e.fiscalYear === prevYear);
    if (!prevEvents.length) {
      alert(`${prevYear}年度の行事が登録されていません`);
      return;
    }
    const copied = prevEvents.map((e) => ({
      id: uid('ev'),
      fiscalYear: currentEventYear,
      name: e.name,
      date: '',
      endDate: '',
      leadDays: e.leadDays,
      excludeFrom: '',
      afterDays: e.afterDays || 0,
      depts: e.depts,
      targetElectionDuty: !!e.targetElectionDuty,
    }));
    fiscalEvents = fiscalEvents.concat(copied);
    save(KEY_FISCAL_EVENTS, fiscalEvents);
    renderEventTable();
    showToast(`${prevYear}年度から${copied.length}件の行事をコピーしました（日付は入力してください）`);
  });
}
/** 対象期間に適用する行事除外リストを組み立てる（generateAssignments渡し用）。
 *  所属による除外（depts）と、選挙管理委員会事務局の併任者を対象にする除外（targetElectionDuty）は
 *  併用できる（例：選挙管理委員会の所属自体は名簿上存在しないため、併任フラグ側で職員を特定する） */
function computeEventExclusions() {
  return fiscalEvents
    .filter((e) => e.excludeFrom && ((e.depts && e.depts.length) || e.targetElectionDuty))
    .map((e) => ({ date: e.excludeFrom, endDate: e.endDate || e.date, depts: e.depts || [], targetElectionDuty: !!e.targetElectionDuty }));
}

/* ------------------------------------------------------------
 * 勤務表作成
 * ------------------------------------------------------------ */
let genDatesEmptyReason = null; // 抽出結果が0件だった理由（表示用）
function renderGenDatesTable() {
  const locked = genStatus === 'confirmed';
  const tbody = document.getElementById('gen-dates-tbody');
  tbody.innerHTML = draftDates
    .map(
      (d, i) => `
    <tr>
      <td>${d.date}</td>
      <td>${WEEKDAY_LABEL[d.weekday]}</td>
      <td>${escapeHtml(d.holidayName || '')}</td>
      <td><input type="checkbox" class="gen-date-toggle" data-idx="${i}" ${d.include !== false ? 'checked' : ''} ${locked ? 'disabled' : ''}></td>
    </tr>`
    )
    .join('');
  document.getElementById('gen-dates-summary').textContent = draftDates.length
    ? `${draftDates.length} 日を抽出しました${locked ? '' : '（対象から外したい日はチェックを外してください）'}`
    : genDatesEmptyReason || '';
  tbody.querySelectorAll('.gen-date-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (genStatus === 'confirmed') return;
      draftDates[Number(cb.dataset.idx)].include = cb.checked;
      genApprovalChecked = false;
      saveGenSession();
      renderGenApprovalUi();
    });
  });
}
function initGenerateDates() {
  document.getElementById('gen-list-dates').addEventListener('click', () => {
    if (genStatus === 'confirmed') {
      alert('確定済みです。修正するには「引き戻して修正」を押してください。');
      return;
    }
    const start = document.getElementById('gen-start').value;
    const end = document.getElementById('gen-end').value;
    if (!start || !end) {
      alert('開始日・終了日を入力してください');
      return;
    }
    const already = new Set(history.map((h) => h.date));
    const raw = listDesignatedDates(start, end);
    draftDates = raw.filter((d) => !already.has(d.date)).map((d) => ({ ...d, include: true }));
    genDatesEmptyReason = draftDates.length
      ? null
      : raw.length
      ? '対象期間内の土日・祝日・年末年始は、すべて確定済み履歴に含まれています（履歴・確認タブでご確認ください）。'
      : '対象期間内に土日・祝日・年末年始がありません。';
    genApprovalChecked = false;
    saveGenSession();
    renderGenApprovalUi();
    renderGenDatesTable();
  });
}

function renderGenResultTable() {
  const locked = genStatus === 'confirmed';
  const tbody = document.getElementById('gen-result-tbody');
  tbody.innerHTML = draftResults
    .map(
      (r, i) => `
    <tr class="${statusRowClass(r.status)}">
      <td>${r.date}</td>
      <td>${WEEKDAY_LABEL[r.weekday]}</td>
      <td>${escapeHtml(r.holidayName || '')}</td>
      <td>
        <span class="assign-name-chip" draggable="${locked ? 'false' : 'true'}" data-idx="${i}" data-level="senior" title="ドラッグして他の日・欄の職員と入れ替えられます">${r.seniorName ? escapeHtml(r.seniorName) : '未定'}</span>
        ${renderStaffSelect(i, 'senior', r.seniorId, locked)}
      </td>
      <td>
        <span class="assign-name-chip" draggable="${locked ? 'false' : 'true'}" data-idx="${i}" data-level="junior" title="ドラッグして他の日・欄の職員と入れ替えられます">${r.juniorName ? escapeHtml(r.juniorName) : '未定'}</span>
        ${renderStaffSelect(i, 'junior', r.juniorId, locked)}
      </td>
      <td>${statusReasonHtml(r)}</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.result-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (genStatus === 'confirmed') return;
      const idx = Number(sel.dataset.idx);
      const level = sel.dataset.level;
      const newId = sel.value || null;
      const s = newId ? staffById(newId) : null;

      // プルダウンで選んだ職員が既に別の日・別の欄に割り当てられている場合、それが1箇所だけなら
      // 「移動」とみなしてそちらをクリアする（クリアしないと元の割当が残ったまま二重に割り当てられ、
      //  元の日は何も警告が出ないまま「2回目の割当」エラーだけが新しい日に出てしまう）。
      // 2箇所以上に既に割り当て済み（人数不足で複数回割当済み）の場合は、どちらを元の場所として
      // 消すべきか判断できないためクリアはせず、影響する行をすべて再判定して警告を正しく表示する。
      const affectedIdxs = new Set([idx]);
      if (newId) {
        const otherOccurrences = [];
        draftResults.forEach((r, i) => {
          if (i === idx) return;
          if (r.seniorId === newId) otherOccurrences.push({ i, idKey: 'seniorId', nameKey: 'seniorName' });
          if (r.juniorId === newId) otherOccurrences.push({ i, idKey: 'juniorId', nameKey: 'juniorName' });
        });
        if (otherOccurrences.length === 1) {
          const { i, idKey, nameKey } = otherOccurrences[0];
          draftResults[i][idKey] = null;
          draftResults[i][nameKey] = '';
          affectedIdxs.add(i);
        } else {
          otherOccurrences.forEach(({ i }) => affectedIdxs.add(i));
        }
      }

      draftResults[idx][level + 'Id'] = s ? s.id : null;
      draftResults[idx][level + 'Name'] = s ? s.name : '';
      affectedIdxs.forEach((i) => revalidateDraftResult(i));
      genOptimizeSummary = null; // 手動で入れ替えたら、作成直後の見直しサマリは実態と合わなくなるため消す
      genApprovalChecked = false;
      saveGenSession();
      renderGenResultTable();
    });
  });

  let dragSource = null;
  tbody.querySelectorAll('.assign-name-chip').forEach((chip) => {
    chip.addEventListener('dragstart', (e) => {
      if (genStatus === 'confirmed') return;
      dragSource = { idx: Number(chip.dataset.idx), level: chip.dataset.level };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chip.textContent);
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => {
      dragSource = null;
      tbody.querySelectorAll('.assign-name-chip').forEach((c) => c.classList.remove('dragging', 'drag-over'));
    });
    chip.addEventListener('dragover', (e) => {
      if (!dragSource) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      chip.classList.add('drag-over');
    });
    chip.addEventListener('dragleave', () => {
      chip.classList.remove('drag-over');
    });
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      if (!dragSource) return;
      const target = { idx: Number(chip.dataset.idx), level: chip.dataset.level };
      if (dragSource.idx === target.idx && dragSource.level === target.level) {
        dragSource = null;
        return;
      }
      swapDraftResultSlots(dragSource, target);
      dragSource = null;
      genApprovalChecked = false;
      saveGenSession();
      renderGenResultTable();
    });
  });

  const warnCount = draftResults.filter((r) => r.status === 'warning').length;
  const noteCount = draftResults.filter((r) => r.status === 'note').length;
  const errorCount = draftResults.filter((r) => r.status === 'error').length;
  // 係長級を含まない日（市民課経験者が資格要件を満たしている日）は、基本の形ではないため件数を明示する
  const noSeniorCount = draftResults.filter((r) => {
    const s = resolveAnyStaff(r.seniorId);
    const j = resolveAnyStaff(r.juniorId);
    return s && j && s.level !== 'senior' && j.level !== 'senior';
  }).length;
  document.getElementById('gen-warning-summary').innerHTML = draftResults.length
    ? `<p class="hint">合計 ${draftResults.length} 日 / 要確認 ${warnCount} 日${noteCount ? ` / 補足 ${noteCount} 日（人数の都合で避けられない緩和。内容は理由欄に表示しています）` : ''}${errorCount ? ` / <strong style="color:var(--danger)">人数不足エラー ${errorCount} 日</strong>` : ''}${noSeniorCount ? ` / 係長級を含まない日 ${noSeniorCount} 日（市民課経験者が資格要件を満たしています）` : ''}</p>`
    : '';

  const optEl = document.getElementById('gen-optimize-summary');
  if (optEl) optEl.innerHTML = draftResults.length ? computeOptimizeSummaryHtml() : '';

  const unassignedEl = document.getElementById('gen-unassigned-summary');
  const overEl = document.getElementById('gen-overburdened-summary');
  if (locked && (genFrozenUnassignedHtml !== null || genFrozenOverburdenedHtml !== null)) {
    // 確定済み：確定時点のスナップショットをそのまま表示する（その後の名簿・履歴の変更に影響されない）
    if (unassignedEl) unassignedEl.innerHTML = genFrozenUnassignedHtml || '';
    if (overEl) overEl.innerHTML = genFrozenOverburdenedHtml || '';
  } else {
    if (unassignedEl) unassignedEl.innerHTML = computeUnassignedSummaryHtml();
    if (overEl) overEl.innerHTML = computeOverburdenedSummaryHtml();
  }

  document.getElementById('gen-export').disabled = draftResults.length === 0;
  document.getElementById('gen-pdf').disabled = draftResults.length === 0;
  renderGenApprovalUi();
}
/** 作成後の見直し（optimizeAssignments）で何がどれだけ良くなったかを表示するHTML。
 *  絶対条件（同性ペア・所属除外・育休等）を崩す入替えは一切行われないため、
 *  ここに出るのは「同じ条件のまま、より良い組合せに入れ替えた結果」だけ。 */
function computeOptimizeSummaryHtml() {
  const s = genOptimizeSummary;
  if (!s || !s.moves) return '';
  if (!s.moves.length) {
    return '<p style="margin:0">作成後の見直しを行いました。<strong>入れ替えたほうが良い組合せは見つかりませんでした</strong>（すでに条件の範囲で最も良い状態です）。</p>';
  }
  const b = s.before || {};
  const a = s.after || {};
  const fair = a.fairShare != null ? a.fairShare : b.fairShare;
  const rows = [
    ['1回も割り当てられていない職員', b.unassigned, a.unassigned, '名'],
    ['1人あたりの最大担当回数', b.maxDuties, a.maxDuties, '回'],
    [`担当回数の目安（${fair}回）を超える職員`, b.overFairShare, a.overFairShare, '名'],
    ['同一課の組合せ', b.sameDept, a.sameDept, '日'],
    ['課長補佐・副主幹の組合せ', b.titleClash, a.titleClash, '日'],
    ['過去のペアと重複', b.pairRepeat, a.pairRepeat, '日'],
    ['最低間隔日数を下回る間隔', b.gapViolations, a.gapViolations, '件'],
    ['係長級が含まれない日', b.noSenior, a.noSenior, '日'],
    ['2名を埋められない日', b.errorDays, a.errorDays, '日'],
  ].filter(([, x, y]) => x != null && y != null && x !== y);
  const list = (items) =>
    `<ul style="margin:2px 0 0;padding-left:20px;font-weight:normal">${items
      .map(([label, x, y, unit]) => `<li>${escapeHtml(label)}：${x}${unit} → <strong>${y}${unit}</strong></li>`)
      .join('')}</ul>`;
  const better = rows.filter(([, x, y]) => y < x);
  const worse = rows.filter(([, x, y]) => y > x);
  const changed =
    (better.length ? '<p style="margin:6px 0 0">改善したもの</p>' + list(better) : '') +
    (worse.length
      ? '<p style="margin:6px 0 0">引き換えに増えたもの（全員に出番を作ること・担当回数の偏りをなくすことを優先しています）</p>' +
        list(worse)
      : '');
  const added = s.addedStaff && s.addedStaff.length
    ? `<p style="margin:6px 0 0">この見直しで新たに担当が付いた職員：<strong>${s.addedStaff.map(escapeHtml).join('、')}</strong></p>`
    : '';
  return (
    `<p style="margin:0;font-weight:600">作成後の見直しで ${s.moves.length} 件を入れ替えました</p>` +
    changed +
    added
  );
}
/** 「今期まだ割り当てられていない対象職員」サマリのHTMLを、現在のstaff/historyから計算する */
function computeUnassignedSummaryHtml() {
  if (!draftResults.length) return '';
  const genTargetStaff = staff.filter((s) => s.active !== false && !isStandingExcluded(s, currentPeriod().standingExcludedDepts));
  const p = currentPeriod();
  const assignedIds = new Set();
  history.forEach((h) => {
    if (h.periodId !== p.id) return;
    if (h.seniorId) assignedIds.add(h.seniorId);
    if (h.juniorId) assignedIds.add(h.juniorId);
  });
  draftResults.forEach((r) => {
    if (r.seniorId) assignedIds.add(r.seniorId);
    if (r.juniorId) assignedIds.add(r.juniorId);
  });
  const genUnassigned = genTargetStaff.filter((s) => !assignedIds.has(s.id));
  if (!genUnassigned.length) {
    return '<p style="margin:0;font-weight:600">対象職員は全員、今期すでに少なくとも1回は割り当てられています。</p>';
  }
  const explainCtx = {
    dutyDates: draftResults.map((r) => ({ date: r.date })),
    results: draftResults,
    staffList: staff,
    monthRules,
    eventExclusions: computeEventExclusions(),
    history,
    minGapDays: settings.minGapDays,
    newHireMonths: settings.newHireMonths,
    leaves: effectiveLeavesForPeriod(p),
    specialLookback: settings.specialLookback,
    retireLeadMonths: settings.retireLeadMonths,
  };
  const items = genUnassigned
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.name)}</strong>（${LEVEL_LABEL[s.level]}・${escapeHtml(s.dept)}）：${escapeHtml(
          explainUnassignedStaff(s, explainCtx)
        )}</li>`
    )
    .join('');
  return `<p style="margin:0 0 4px;font-weight:600">今期まだ割り当てられていない対象職員（${genUnassigned.length}名）</p><ul style="margin:0;padding-left:20px;font-weight:normal">${items}</ul>`;
}
/** 「今期の担当回数が多い職員」サマリのHTMLを、現在のstaff/historyから計算する */
function computeOverburdenedSummaryHtml() {
  if (!draftResults.length) return '';
  const genTargetStaff = staff.filter((s) => s.active !== false && !isStandingExcluded(s, currentPeriod().standingExcludedDepts));
  const p = currentPeriod();
  const countMap = new Map();
  const bump = (id) => {
    if (id) countMap.set(id, (countMap.get(id) || 0) + 1);
  };
  history.forEach((h) => {
    if (h.periodId !== p.id) return;
    bump(h.seniorId);
    bump(h.juniorId);
  });
  draftResults.forEach((r) => {
    bump(r.seniorId);
    bump(r.juniorId);
  });
  const overburdened = genTargetStaff
    .map((s) => ({ s, count: countMap.get(s.id) || 0 }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count);
  if (!overburdened.length) return '';
  const counts = genTargetStaff.map((s) => countMap.get(s.id) || 0);
  const max = counts.length ? Math.max(...counts) : 0;
  const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const items = overburdened
    .map(({ s, count }) => `<li><strong>${escapeHtml(s.name)}</strong>（${LEVEL_LABEL[s.level]}・${escapeHtml(s.dept)}）：${count}回</li>`)
    .join('');
  return `<p style="margin:0 0 4px;font-weight:600">今期の担当回数：最大${max}回／平均${avg.toFixed(1)}回／2回以上 ${overburdened.length}名</p><ul style="margin:0;padding-left:20px;font-weight:normal">${items}</ul>`;
}
/** level='senior'（1人目）は必ず係長級から選ぶ。level='junior'（2人目）は係長級・主事級のどちらも選べる
 *（1日2名のうち少なくとも1名が係長級であればよいため、係長級2名の組合せも許可している）。 */
function renderStaffSelect(idx, level, currentId, disabled) {
  const standingDepts = currentPeriod().standingExcludedDepts;
  const pool = (level === 'senior' ? staff.filter((s) => s.level === 'senior') : staff).filter(
    (s) => s.active !== false && !isStandingExcluded(s, standingDepts)
  );
  const options = pool
    .map((s) => {
      const label = level === 'senior' ? `${escapeHtml(s.name)}（${escapeHtml(s.dept)}）` : `${escapeHtml(s.name)}（${escapeHtml(s.dept)}・${LEVEL_LABEL[s.level]}）`;
      return `<option value="${s.id}" ${s.id === currentId ? 'selected' : ''}>${label}</option>`;
    })
    .join('');
  return `<select class="result-select" data-idx="${idx}" data-level="${level}" ${disabled ? 'disabled' : ''}><option value="">未定</option>${options}</select>`;
}
/** 手動での入れ替え・選択後に、その日の組合せが実際のルールに反しないかを確認し、
 *  違反があれば理由の一覧を返す（空配列なら問題なし）。入れ替え自体は常に許可し、
 *  違反時は「要確認」表示に切り替えるだけにとどめる。 */
function validateManualPair(seniorRec, juniorRec) {
  const reasons = [];
  if (!seniorRec && !juniorRec) {
    reasons.push('対象者がいません');
    return reasons;
  }
  if (!seniorRec || !juniorRec) {
    reasons.push('人数不足のため1名のみの割当です');
    return reasons;
  }
  if (seniorRec.level !== 'senior' && juniorRec.level !== 'senior') {
    reasons.push('係長級が含まれていません');
  }
  if (seniorRec.gender && juniorRec.gender && seniorRec.gender !== juniorRec.gender) {
    reasons.push('性別が異なる組合せです');
  }
  if (seniorRec.dept && juniorRec.dept && seniorRec.dept === juniorRec.dept) {
    reasons.push('同一課の組合せです');
  }
  if (seniorRec.level === 'senior' && juniorRec.level === 'senior' && isSeniorTitleClash(seniorRec, juniorRec)) {
    reasons.push('課長補佐・副主幹の組合せです');
  }
  return reasons;
}
/** 手動での変更（プルダウン選択・ドラッグ入れ替え）後に、その行の状態・理由を再計算する。
 *  同一課回避・性別一致・課長補佐/副主幹の組合せに加え、同一処理期内での2回目の割当
 *  （他の日の作成分・確定済み履歴の両方を見る）も再判定する。 */
function revalidateDraftResult(idx) {
  const r = draftResults[idx];
  if (!r) return;
  const s = r.seniorId ? staffById(r.seniorId) : null;
  const j = r.juniorId ? staffById(r.juniorId) : null;
  const violations = validateManualPair(s, j);

  const p = currentPeriod();
  // 同一処理期内の担当回数を数える（他の日の作成分・確定済み履歴の両方を見る）
  const countElsewhere = new Map();
  const bump = (id) => { if (id) countElsewhere.set(id, (countElsewhere.get(id) || 0) + 1); };
  history.forEach((h) => {
    if (h.periodId !== p.id) return;
    bump(h.seniorId);
    bump(h.juniorId);
  });
  draftResults.forEach((other, oi) => {
    if (oi === idx) return;
    bump(other.seniorId);
    bump(other.juniorId);
  });
  // 1人あたりの担当回数の目安を超えたときだけ要確認にする（目安の範囲内は補足として表示する）
  const targetCount = staff.filter(
    (s2) => s2.active !== false && !!s2.gender && !isStandingExcluded(s2, p.standingExcludedDepts)
  ).length;
  const fairShare = Math.max(1, Math.ceil((draftResults.length * 2) / (targetCount || 1)));
  const counts = [r.seniorId, r.juniorId].filter(Boolean).map((id) => (countElsewhere.get(id) || 0) + 1);
  const repeatMax = counts.length ? Math.max(...counts) : 0;
  const notes = [];
  if (repeatMax >= 2) {
    const over = repeatMax > fairShare;
    (over ? violations : notes).push(
      `同一処理期内で${repeatMax}回目の割当です（1人あたりの目安${fairShare}回${over ? 'を超えています' : 'の範囲内です'}）`
    );
  }

  r.status = !s || !j ? 'error' : violations.length ? 'warning' : notes.length ? 'note' : 'ok';
  r.reason = violations.length || notes.length ? [...violations, ...notes].join(' / ') : '（手動で修正済み）';
  r.manuallyEdited = true;
}
/** ドラッグ&ドロップで2つのセル（行×スロット）の職員を入れ替える。列（1人目／2人目）をまたいでも可 */
function swapDraftResultSlots(a, b) {
  const ra = draftResults[a.idx];
  const rb = draftResults[b.idx];
  if (!ra || !rb) return;
  const aId = ra[a.level + 'Id'];
  const aName = ra[a.level + 'Name'];
  const bId = rb[b.level + 'Id'];
  const bName = rb[b.level + 'Name'];
  ra[a.level + 'Id'] = bId;
  ra[a.level + 'Name'] = bName;
  rb[b.level + 'Id'] = aId;
  rb[b.level + 'Name'] = aName;
  revalidateDraftResult(a.idx);
  if (b.idx !== a.idx) revalidateDraftResult(b.idx);
  genOptimizeSummary = null; // 手動で入れ替えたら、作成直後の見直しサマリは実態と合わなくなるため消す
}

function initGenerateRun() {
  document.getElementById('gen-run').addEventListener('click', () => {
    if (genStatus === 'confirmed') {
      alert('確定済みです。修正するには「引き戻して修正」を押してください。');
      return;
    }
    const targetDates = draftDates.filter((d) => d.include !== false);
    if (!targetDates.length) {
      alert('対象の指定日がありません。まず「土日・祝日・年末年始を自動抽出」を実行してください。');
      return;
    }
    const genParams = {
      staffList: staff,
      dutyDates: targetDates,
      monthRules,
      eventExclusions: computeEventExclusions(),
      history,
      minGapDays: settings.minGapDays,
      newHireMonths: settings.newHireMonths,
      specialLookback: settings.specialLookback,
      pairLookbackYears: settings.pairLookbackYears,
      standingExcludedDepts: currentPeriod().standingExcludedDepts,
      leaves: effectiveLeavesForPeriod(currentPeriod()),
      retireLeadMonths: settings.retireLeadMonths,
      periodId: currentPeriod().id,
    };
    const firstPass = generateAssignments(genParams);
    // 作成し終わった勤務表全体を見直し、絶対条件を崩さない入替えだけで質を上げる
    const optimized = optimizeAssignments({ ...genParams, results: firstPass });
    draftResults = optimized.results;
    genOptimizeSummary = optimized.summary;
    genApprovalChecked = false;
    saveGenSession();
    renderGenResultTable();
    showToast('勤務表を作成しました');
  });

  document.getElementById('gen-approval-check').addEventListener('change', (e) => {
    if (genStatus === 'confirmed') return;
    genApprovalChecked = e.target.checked;
    saveGenSession();
    renderGenApprovalUi();
  });

  document.getElementById('gen-confirm').addEventListener('click', () => {
    if (genStatus === 'confirmed' || !draftResults.length) return;
    if (!genApprovalChecked) {
      alert('「決裁が完了したことを確認しました」にチェックを入れてから確定してください。勤務表の内容を確認・決裁してから確定してください。');
      return;
    }
    // 除外対象者等の判断根拠（未割当・担当過多サマリ）を確定時点のまま凍結する。
    // 確定後に名簿やルールが変わっても、確定時点の判断根拠が変化して見えないようにするため。
    genFrozenUnassignedHtml = computeUnassignedSummaryHtml();
    genFrozenOverburdenedHtml = computeOverburdenedSummaryHtml();

    const p = currentPeriod();
    const batchId = uid('cb');
    const confirmedAt = new Date().toISOString();
    const withLabel = draftResults.map((r) => ({
      ...r,
      periodId: p.id,
      periodLabel: p.label,
      confirmedAt,
      confirmBatchId: batchId,
    }));
    history = history.concat(withLabel).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    save(KEY_HISTORY, history);
    renderHistoryTable();
    renderCheckTable();

    // 確定後も作成時の画面・内容を保持する（自動処理等で変更されないよう、以後は編集ロックする）
    draftResults = withLabel;
    genStatus = 'confirmed';
    genConfirmBatchId = batchId;
    genConfirmedAt = confirmedAt;
    saveGenSession();
    renderGenDatesTable();
    renderGenResultTable();
    showToast('決裁済みとして確定し、履歴に保存しました');
  });

  document.getElementById('gen-revert').addEventListener('click', () => {
    if (genStatus !== 'confirmed') return;
    if (
      !confirm(
        '確定を引き戻して修正可能な状態に戻します。この回の確定分は確定済み履歴から削除されます（引き戻し前の内容は作成履歴として残ります）。よろしいですか？'
      )
    ) {
      return;
    }
    const batchId = genConfirmBatchId;
    history = history.filter((h) => h.confirmBatchId !== batchId);
    save(KEY_HISTORY, history);
    renderHistoryTable();
    renderCheckTable();

    genLog.push({
      confirmBatchId: batchId,
      confirmedAt: genConfirmedAt,
      revokedAt: new Date().toISOString(),
      dates: draftDates,
      results: draftResults,
    });
    genStatus = 'draft';
    genConfirmBatchId = null;
    genConfirmedAt = null;
    genApprovalChecked = false;
    genFrozenUnassignedHtml = null;
    genFrozenOverburdenedHtml = null;
    saveGenSession();
    renderGenDatesTable();
    renderGenResultTable();
    renderGenLog();
    showToast('確定を引き戻しました。内容を修正のうえ、再度決裁・確定してください');
  });

  document.getElementById('gen-export').addEventListener('click', () => {
    const rows = [['日付', '曜日', '祝日等', '1人目', '2人目', '状態']].concat(
      draftResults.map((r) => [r.date, WEEKDAY_LABEL[r.weekday], r.holidayName || '', r.seniorName, r.juniorName, statusLabel(r.status)])
    );
    downloadCsv('日直勤務表.csv', rows);
  });

  document.getElementById('gen-pdf').addEventListener('click', () => {
    const period = currentPeriod();
    exportPeriodPdfByQuarter(period, draftResults, `日直勤務表_${period.label}.pdf`);
  });
}
/** 勤務表作成タブの作業状態（指定日・結果・決裁/確定状態・引き戻し履歴）を、選択中の処理期に紐づけて保存する。
 *  これにより、タブを離れたり画面を再読み込みしたりしても、作成時の内容がそのまま保持される。 */
function saveGenSession() {
  genSessions[currentPeriod().id] = {
    status: genStatus,
    dates: draftDates,
    results: draftResults,
    genDatesEmptyReason,
    approvalChecked: genApprovalChecked,
    confirmBatchId: genConfirmBatchId,
    confirmedAt: genConfirmedAt,
    log: genLog,
    optimizeSummary: genOptimizeSummary,
    frozenUnassignedHtml: genFrozenUnassignedHtml,
    frozenOverburdenedHtml: genFrozenOverburdenedHtml,
  };
  save(KEY_GEN_SESSION, genSessions);
}
/** 選択中の処理期の作業状態を読み込む（未保存の処理期は空の下書き状態から開始する） */
function loadGenSessionForCurrentPeriod() {
  const s = genSessions[currentPeriod().id];
  genStatus = s && s.status === 'confirmed' ? 'confirmed' : 'draft';
  draftDates = (s && s.dates) || [];
  draftResults = (s && s.results) || [];
  genDatesEmptyReason = (s && s.genDatesEmptyReason) || null;
  genApprovalChecked = !!(s && s.approvalChecked);
  genConfirmBatchId = (s && s.confirmBatchId) || null;
  genConfirmedAt = (s && s.confirmedAt) || null;
  genLog = (s && s.log) || [];
  genOptimizeSummary = (s && s.optimizeSummary) || null;
  genFrozenUnassignedHtml = (s && s.frozenUnassignedHtml) || null;
  genFrozenOverburdenedHtml = (s && s.frozenOverburdenedHtml) || null;
}
/** 決裁・確定に関する表示（注意書き／チェックボックス／確定バナー／各ボタンの活性状態）を更新する */
function renderGenApprovalUi() {
  const locked = genStatus === 'confirmed';
  const hasResults = draftResults.length > 0;

  const banner = document.getElementById('gen-confirmed-banner');
  if (banner) {
    banner.classList.toggle('hidden', !locked);
    if (locked) {
      const when = genConfirmedAt ? new Date(genConfirmedAt).toLocaleString('ja-JP') : '';
      banner.textContent = `確定済みです（決裁・確定日時：${when}）。自動処理でこの内容が変更されることはありません。修正する場合は「引き戻して修正」を押してください。`;
    }
  }
  const note = document.getElementById('gen-approval-note');
  if (note) note.classList.toggle('hidden', locked);
  const checkWrap = document.getElementById('gen-approval-checkbox-wrap');
  if (checkWrap) checkWrap.classList.toggle('hidden', locked);
  const check = document.getElementById('gen-approval-check');
  if (check) {
    check.checked = genApprovalChecked;
    check.disabled = locked || !hasResults;
  }

  const confirmBtn = document.getElementById('gen-confirm');
  if (confirmBtn) {
    confirmBtn.classList.toggle('hidden', locked);
    confirmBtn.disabled = locked || !hasResults || !genApprovalChecked;
  }
  const revertBtn = document.getElementById('gen-revert');
  if (revertBtn) revertBtn.classList.toggle('hidden', !locked);

  ['gen-start', 'gen-end', 'gen-list-dates', 'gen-run'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
}
/** 引き戻しにより解除された過去の確定内容（作成履歴）を一覧表示する */
function renderGenLog() {
  const el = document.getElementById('gen-log');
  if (!el) return;
  if (!genLog.length) {
    el.innerHTML = '';
    return;
  }
  const rows = genLog
    .slice()
    .reverse()
    .map((l) => {
      const confirmedAt = l.confirmedAt ? new Date(l.confirmedAt).toLocaleString('ja-JP') : '';
      const revokedAt = l.revokedAt ? new Date(l.revokedAt).toLocaleString('ja-JP') : '';
      return `
    <tr>
      <td>${escapeHtml(confirmedAt)}</td>
      <td>${escapeHtml(revokedAt)}</td>
      <td>${l.results.length} 日分</td>
      <td><button class="btn-secondary gen-log-export" data-batch="${escapeHtml(l.confirmBatchId || '')}">CSVで書き出す</button></td>
    </tr>`;
    })
    .join('');
  el.innerHTML = `
    <h3 style="margin-top:18px">作成履歴（引き戻し前の確定内容）</h3>
    <p class="hint">「引き戻して修正」により解除された、この処理期の過去の確定内容です。件数はその時点で確定していた日数を示します。</p>
    <div class="table-wrap small-table">
      <table>
        <thead><tr><th>決裁・確定日時</th><th>引き戻し日時</th><th>件数</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  el.querySelectorAll('.gen-log-export').forEach((btn) => {
    btn.addEventListener('click', () => {
      const log = genLog.find((l) => l.confirmBatchId === btn.dataset.batch);
      if (!log) return;
      const rows = [['日付', '曜日', '祝日等', '1人目', '2人目', '状態']].concat(
        log.results.map((r) => [r.date, WEEKDAY_LABEL[r.weekday], r.holidayName || '', r.seniorName, r.juniorName, statusLabel(r.status)])
      );
      const stamp = log.confirmedAt ? log.confirmedAt.slice(0, 10) : '';
      downloadCsv(`日直勤務表_引き戻し前_${stamp}.csv`, rows);
    });
  });
}
/** 処理期の期間を勤務表作成タブの入力欄へ反映し、その処理期に保存済みの作業状態（作成中／確定済み）を復元する */
function applyPeriodToGenerateTab() {
  const p = currentPeriod();
  document.getElementById('gen-start').value = p.startDate;
  document.getElementById('gen-end').value = p.endDate;
  const label = document.getElementById('gen-period-label');
  if (label) label.textContent = p.label;
  loadGenSessionForCurrentPeriod();
  renderGenDatesTable();
  renderGenResultTable();
  renderGenLog();
}

/* ------------------------------------------------------------
 * 履歴・確認
 * ------------------------------------------------------------ */
let historyPeriodFilter = currentPeriod().id; // 既定は選択中の処理期（「全期間」「未分類」も選択可）
/** 表示対象の履歴（処理期フィルタ適用後）。判定・集計には常に全履歴を使う */
function visibleHistory() {
  if (historyPeriodFilter === 'all') return history;
  if (historyPeriodFilter === 'unassigned') return history.filter((r) => !r.periodId);
  const p = periodById(historyPeriodFilter);
  if (!p) return history;
  return history.filter((r) => (r.periodId ? r.periodId === p.id : r.date >= p.startDate && r.date <= p.endDate));
}
function renderHistoryPeriodFilter() {
  const sel = document.getElementById('history-period-filter');
  if (!sel) return;
  sel.innerHTML =
    `<option value="all" ${historyPeriodFilter === 'all' ? 'selected' : ''}>全期間</option>` +
    `<option value="unassigned" ${historyPeriodFilter === 'unassigned' ? 'selected' : ''}>未分類</option>` +
    periods
      .map((p) => `<option value="${p.id}" ${historyPeriodFilter === p.id ? 'selected' : ''}>${escapeHtml(p.label)}</option>`)
      .join('');
}
/** 「交代を反映」で職員同士が入れ替わった（AさんからBさんへ、別の日にBさんからAさんへ）ペアを
 *  検出し、それぞれに同じ色を割り当てる。同じ日・同じ欄（係長級／主事級）に複数回変更が
 *  入っている場合は、最新の変更のみを現在有効な変更として扱う。
 *  戻り値は Map<"日付|欄", 色> 。 */
const SWAP_MARKER_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42b0b0', '#c2185b', '#7cb342', '#0277bd', '#f9a825'];
function computeSwapMarkers() {
  const existingDates = new Set(history.map((h) => h.date));
  const latestByKey = new Map();
  changeLog.forEach((log) => {
    if (!existingDates.has(log.date)) return; // 該当日の履歴が削除済みの変更ログは対象外
    const key = log.date + '|' + log.level;
    const existing = latestByKey.get(key);
    if (!existing || log.loggedAt > existing.loggedAt) latestByKey.set(key, log);
  });
  const entries = [...latestByKey.entries()];
  const markers = new Map(); // key(date|level) -> { color, partnerName }
  const used = new Set();
  let colorIdx = 0;
  for (let i = 0; i < entries.length; i++) {
    const [keyA, logA] = entries[i];
    if (used.has(keyA) || !logA.fromId || !logA.toId) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const [keyB, logB] = entries[j];
      if (used.has(keyB) || !logB.fromId || !logB.toId) continue;
      if (logA.fromId === logB.toId && logA.toId === logB.fromId) {
        const color = SWAP_MARKER_COLORS[colorIdx % SWAP_MARKER_COLORS.length];
        colorIdx++;
        markers.set(keyA, { color, partnerName: logB.toName, partnerDate: logB.date });
        markers.set(keyB, { color, partnerName: logA.toName, partnerDate: logA.date });
        used.add(keyA);
        used.add(keyB);
        break;
      }
    }
  }
  return markers;
}
/** 交換ペアの色マーカー（丸印）のHTML。対象でなければ空文字を返す。 */
function swapMarkerHtml(date, level, markers) {
  const info = markers.get(date + '|' + level);
  if (!info) return '';
  const title = `${escapeHtml(info.partnerName)}さん（${escapeHtml(info.partnerDate)}）と交代（入れ替え）`;
  return `<span class="swap-marker" style="background:${info.color}" title="${title}"></span>`;
}
function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  renderHistoryPeriodFilter();
  const rows = visibleHistory();
  const swapMarkers = computeSwapMarkers();
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr class="${statusRowClass(r.status)}">
      <td>${escapeHtml(r.periodLabel || '')}</td>
      <td>${r.date}</td>
      <td>${WEEKDAY_LABEL[r.weekday]}</td>
      <td>${swapMarkerHtml(r.date, 'senior', swapMarkers)}${escapeHtml(r.seniorName)}<div class="row-actions"><button class="btn-secondary change-btn" data-date="${r.date}" data-level="senior">交代を反映</button></div></td>
      <td>${escapeHtml(r.seniorChangedAt || '')}</td>
      <td>${swapMarkerHtml(r.date, 'junior', swapMarkers)}${escapeHtml(r.juniorName)}<div class="row-actions"><button class="btn-secondary change-btn" data-date="${r.date}" data-level="junior">交代を反映</button></div></td>
      <td>${escapeHtml(r.juniorChangedAt || '')}</td>
      <td>${statusLabel(r.status)}</td>
      <td><button class="btn-danger" data-del="${r.date}" data-date="${r.date}">削除</button></td>
    </tr>`
    )
    .join('');
  document.getElementById('history-count').textContent =
    historyPeriodFilter === 'all' ? `${history.length} 件` : `${rows.length} 件 ／ 全 ${history.length} 件`;
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('この履歴を削除しますか？')) return;
      const date = btn.dataset.date;
      const idx = history.findIndex((r) => r.date === date);
      if (idx >= 0) history.splice(idx, 1);
      save(KEY_HISTORY, history);
      renderHistoryTable();
    });
  });
  tbody.querySelectorAll('.change-btn').forEach((btn) => {
    btn.addEventListener('click', () => openChangeModal(btn.dataset.date, btn.dataset.level));
  });
}
function initHistoryPeriodFilter() {
  const sel = document.getElementById('history-period-filter');
  if (!sel) return;
  sel.addEventListener('change', () => {
    historyPeriodFilter = sel.value;
    renderHistoryTable();
    renderCheckTable();
  });
}
/** 表示フィルタで絞り込まれている確定済み履歴をまとめて削除する（別PC等で改修前に確定した
 *  疑似データ等、1件ずつの削除では手間がかかる場合の一括削除用）。visibleHistory() と同じ
 *  絞り込み条件を使うため、常に画面に表示されている件数と削除件数が一致する */
function initHistoryBulkDelete() {
  const btn = document.getElementById('history-bulk-delete-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const rows = visibleHistory();
    if (!rows.length) {
      alert('削除対象の履歴がありません。');
      return;
    }
    const scopeLabel =
      historyPeriodFilter === 'all'
        ? '全期間（すべての確定済み履歴）'
        : historyPeriodFilter === 'unassigned'
        ? '未分類'
        : (periodById(historyPeriodFilter) || {}).label || '選択中の処理期';
    if (!confirm(`「${scopeLabel}」に表示されている確定済み履歴 ${rows.length} 件をまとめて削除します。この操作は元に戻せません。よろしいですか？`)) {
      return;
    }
    const removedBatchIds = new Set(rows.map((r) => r.confirmBatchId).filter(Boolean));
    const removedPeriodIds = new Set(rows.map((r) => r.periodId).filter(Boolean));

    history = history.filter((h) => !rows.includes(h));
    save(KEY_HISTORY, history);

    // 削除した履歴が、勤務表作成タブで「確定済み」として保持されているセッションのものだった場合、
    // 実体のない確定表示が残らないよう、そのセッションも下書き状態へ戻す
    removedPeriodIds.forEach((pid) => {
      const s = genSessions[pid];
      if (s && s.status === 'confirmed' && s.confirmBatchId && removedBatchIds.has(s.confirmBatchId)) {
        genSessions[pid] = {
          ...s,
          status: 'draft',
          confirmBatchId: null,
          confirmedAt: null,
          approvalChecked: false,
          frozenUnassignedHtml: null,
          frozenOverburdenedHtml: null,
        };
      }
    });
    save(KEY_GEN_SESSION, genSessions);
    if (removedPeriodIds.has(currentPeriod().id)) {
      loadGenSessionForCurrentPeriod();
      renderGenDatesTable();
      renderGenResultTable();
      renderGenLog();
    }

    renderHistoryTable();
    renderCheckTable();
    showToast(`${rows.length} 件の履歴を削除しました`);
  });
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'history-export-btn') {
    const rows = [['期間', '日付', '曜日', '1人目', '変更日時', '2人目', '変更日時', '状態']].concat(
      visibleHistory().map((r) => [
        r.periodLabel || '',
        r.date,
        WEEKDAY_LABEL[r.weekday],
        r.seniorName,
        r.seniorChangedAt || '',
        r.juniorName,
        r.juniorChangedAt || '',
        statusLabel(r.status),
      ])
    );
    downloadCsv('日直勤務表_履歴.csv', rows);
  }
});

/* ------------------------------------------------------------
 * 変更届の反映（確定済み履歴の編集）
 * ------------------------------------------------------------ */
/** 変更届のテキスト（OCR結果、またはグループウェア等からの直接貼り付け）から、交代後の氏名・
 *  申請日時をプレフィルする。結果は下書きとして入力欄にセットするだけで、反映には引き続き
 *  「反映する」の操作が必要。戻り値は画面表示用のメッセージ配列。 */
function applyChangeDraftFromText(text, targetDate, candidates, currentName) {
  const nameRaw = extractLabelValue(text, '交代相手氏名');
  const applicantRaw = extractLabelValue(text, '申請者');
  const appliedRaw = extractLabelValue(text, '申請日');
  const changedDateRaw = extractLabelValue(text, '変更する日付');

  const messages = [];
  const matched = nameRaw ? bestNameMatch(nameRaw, candidates) : null;
  if (matched) {
    document.getElementById('change-new-staff').value = matched.id;
    messages.push(`交代後の氏名：${matched.name} を選択しました（読み取り結果「${nameRaw}」）`);
  } else if (nameRaw) {
    messages.push(`交代相手氏名「${nameRaw}」を読み取りましたが、名簿の職員と一致しませんでした。手動で選択してください。`);
  } else {
    messages.push('交代相手氏名を読み取れませんでした。手動で選択してください。');
  }

  const appliedAt = parseOcrDateTime(appliedRaw);
  if (appliedAt) {
    document.getElementById('change-applied-at').value = appliedAt;
    messages.push(`申請日時：${appliedAt.replace('T', ' ')} を入力しました`);
  } else {
    messages.push('申請日時を読み取れませんでした。手動で入力してください。');
  }

  const changedDate = parseOcrDate(changedDateRaw);
  if (changedDate && changedDate !== targetDate) {
    messages.push(`⚠ 読み取った変更対象日（${changedDate}）が、この行の日付（${targetDate}）と一致しません。別の変更届でないかご確認ください。`);
  }

  if (applicantRaw && currentName) {
    const normalize = (s) => String(s || '').replace(/[\s　]+/g, '');
    if (normalize(applicantRaw) !== normalize(currentName)) {
      messages.push(`⚠ 申請者「${applicantRaw}」が、現在の担当者「${currentName}」と一致しません。別の変更届でないかご確認ください。`);
    }
  }

  return messages;
}
/** 変更届のスクリーンショットをOCRで読み取り、applyChangeDraftFromText で下書きに反映する。 */
async function runChangeOcr(file, targetDate, candidates, currentName) {
  const statusEl = document.getElementById('change-ocr-status');
  if (typeof Tesseract === 'undefined') {
    if (statusEl) statusEl.textContent = 'OCR機能を読み込めませんでした。手入力をご利用ください。';
    return;
  }
  if (statusEl) statusEl.textContent = '画像を読み取っています…（数秒かかることがあります）';
  let worker;
  try {
    worker = await Tesseract.createWorker('jpn', 1, {
      workerPath: 'vendor/tesseract-worker.min.js',
      corePath: 'vendor/',
      langPath: 'vendor/',
      gzip: true,
    });
    const { data } = await worker.recognize(file);
    const messages = applyChangeDraftFromText(data.text, targetDate, candidates, currentName);
    if (statusEl) statusEl.innerHTML = messages.map((m) => escapeHtml(m)).join('<br>') + '<br>内容を確認のうえ「反映する」を押してください。';
  } catch (err) {
    if (statusEl) statusEl.textContent = '読み取りに失敗しました：' + (err && err.message ? err.message : String(err)) + '（手入力をご利用ください）';
  } finally {
    if (worker) await worker.terminate();
  }
}
/** 変更届のテキスト（グループウェア等の申請内容画面をコピー＆ペーストしたもの）を
 *  applyChangeDraftFromText で下書きに反映する。file:// でも画像OCRと異なり制約なく使える。 */
function runChangeTextPaste(text, targetDate, candidates, currentName, statusEl) {
  if (!text || !text.trim()) {
    if (statusEl) statusEl.textContent = '貼り付けたテキストが空です。';
    return;
  }
  const messages = applyChangeDraftFromText(text, targetDate, candidates, currentName);
  if (statusEl) statusEl.innerHTML = messages.map((m) => escapeHtml(m)).join('<br>') + '<br>内容を確認のうえ「反映する」を押してください。';
}
/** 指定した職員が、同じ処理期内の他の日に割り当てられている箇所（係長級・主事級を問わない）を
 *  すべて返す。「交代を反映」で選んだ交代相手が別の日にも担当予定の場合、その日をあわせて
 *  交換できるようにするための候補探索に使う（変更届のOCR任せで2日分を読み取ろうとすると
 *  誤読・不一致警告が出やすいため、名簿データから直接引く）。 */
function findOtherAssignments(staffId, periodId, excludeDate) {
  return history
    .filter((h) => h.periodId === periodId && h.date !== excludeDate && (h.seniorId === staffId || h.juniorId === staffId))
    .map((h) => ({
      date: h.date,
      weekday: h.weekday,
      level: h.seniorId === staffId ? 'senior' : 'junior',
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
function openChangeModal(date, level) {
  const record = history.find((r) => r.date === date);
  if (!record) return;
  const currentName = level === 'senior' ? record.seniorName : record.juniorName;
  const currentId = level === 'senior' ? record.seniorId : record.juniorId;
  const candidates = staff.filter((s) => s.level === level && s.active !== false);
  const options = candidates
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}（${escapeHtml(s.dept)}）</option>`)
    .join('');

  const isFileProtocol = location.protocol === 'file:';
  const ocrSectionHtml = isFileProtocol
    ? `<p class="hint">スクリーンショットからの読み取りは、この画面を <code>file://</code> で直接開いている場合は使用できません。<code>python3 -m http.server</code> 等でこのフォルダを配信して開くと使用できます（手入力はそのままお使いいただけます）。</p>`
    : `
      <label>変更申請のスクリーンショットから読み取る（任意）
        <input type="file" id="change-ocr-input" accept="image/*">
      </label>
      <p class="hint" id="change-ocr-status"></p>`;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="change-modal-backdrop">
      <div class="modal-box">
        <h3>交代を反映（${escapeHtml(date)}・${LEVEL_LABEL[level]}）</h3>
        <p class="hint">現在：${escapeHtml(currentName || '未定')}</p>
        <label>変更届のテキストを貼り付ける（任意）
          <textarea id="change-text-input" rows="5" placeholder="グループウェア等の申請内容画面をコピーしてここに貼り付けてください"></textarea>
        </label>
        <div class="row-actions" style="margin-bottom:8px">
          <button id="change-text-parse-btn" class="btn-secondary">貼り付けたテキストから読み取る</button>
        </div>
        <p class="hint" id="change-text-status"></p>
        ${ocrSectionHtml}
        <div class="grid-form">
          <label>交代後の氏名
            <select id="change-new-staff"><option value="">選択してください</option>${options}</select>
          </label>
          <label>申請日時（変更届に記載の日時）
            <input type="datetime-local" id="change-applied-at">
          </label>
        </div>
        <div id="change-swap-section" class="hidden">
          <label>交代後の職員は、同じ処理期の他の日にも担当予定があります。あわせて交換しますか？
            <select id="change-swap-target"></select>
          </label>
          <p class="hint">選んだ日の担当を、この行の元の担当者（${escapeHtml(currentName || '未定')}）に交代します。1回の操作で両方の変更が反映されます。</p>
        </div>
        <div class="row-actions">
          <button id="change-confirm" class="btn-primary">反映する</button>
          <button id="change-cancel" class="btn-secondary">閉じる</button>
        </div>
      </div>
    </div>`;

  document.getElementById('change-cancel').addEventListener('click', closeChangeModal);
  document.getElementById('change-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'change-modal-backdrop') closeChangeModal();
  });
  const ocrInput = document.getElementById('change-ocr-input');
  if (ocrInput) {
    ocrInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) runChangeOcr(file, date, candidates, currentName);
    });
  }
  const textInput = document.getElementById('change-text-input');
  const textStatus = document.getElementById('change-text-status');
  const runFromPastedText = () => runChangeTextPaste(textInput.value, date, candidates, currentName, textStatus);
  document.getElementById('change-text-parse-btn').addEventListener('click', runFromPastedText);
  textInput.addEventListener('paste', () => { setTimeout(runFromPastedText, 0); });

  const swapSection = document.getElementById('change-swap-section');
  const swapTargetSelect = document.getElementById('change-swap-target');
  document.getElementById('change-new-staff').addEventListener('change', (e) => {
    const newId = e.target.value;
    if (!newId || !currentId) {
      swapSection.classList.add('hidden');
      return;
    }
    const others = findOtherAssignments(newId, record.periodId, date);
    if (!others.length) {
      swapSection.classList.add('hidden');
      return;
    }
    swapTargetSelect.innerHTML =
      '<option value="">交換しない（この日だけ変更する）</option>' +
      others
        .map((o) => `<option value="${o.date}|${o.level}">${o.date}（${WEEKDAY_LABEL[o.weekday]}・${LEVEL_LABEL[o.level]}）</option>`)
        .join('');
    swapSection.classList.remove('hidden');
  });

  document.getElementById('change-confirm').addEventListener('click', () => {
    const newId = document.getElementById('change-new-staff').value;
    const appliedAtRaw = document.getElementById('change-applied-at').value;
    if (!newId || !appliedAtRaw) {
      alert('交代後の氏名と申請日時を入力してください');
      return;
    }
    const newStaff = staffById(newId);
    const appliedAt = appliedAtRaw.replace('T', ' ');
    const fromId = level === 'senior' ? record.seniorId : record.juniorId;
    const fromName = level === 'senior' ? record.seniorName : record.juniorName;
    changeLog.push({
      id: uid('chg'),
      date,
      level,
      fromId: fromId || null,
      fromName: fromName || '',
      toId: newStaff.id,
      toName: newStaff.name,
      appliedAt,
      loggedAt: new Date().toISOString(),
    });
    if (level === 'senior') {
      record.seniorId = newStaff.id;
      record.seniorName = newStaff.name;
      record.seniorChangedAt = appliedAt;
    } else {
      record.juniorId = newStaff.id;
      record.juniorName = newStaff.name;
      record.juniorChangedAt = appliedAt;
    }
    record.manuallyEdited = true;

    const swapValue = swapTargetSelect && !swapSection.classList.contains('hidden') ? swapTargetSelect.value : '';
    let swapApplied = false;
    if (swapValue && fromId) {
      const [swapDate, swapLevel] = swapValue.split('|');
      const swapRecord = history.find((h) => h.date === swapDate);
      if (swapRecord) {
        changeLog.push({
          id: uid('chg'),
          date: swapDate,
          level: swapLevel,
          fromId: newStaff.id,
          fromName: newStaff.name,
          toId: fromId,
          toName: fromName,
          appliedAt,
          loggedAt: new Date().toISOString(),
        });
        if (swapLevel === 'senior') {
          swapRecord.seniorId = fromId;
          swapRecord.seniorName = fromName;
          swapRecord.seniorChangedAt = appliedAt;
        } else {
          swapRecord.juniorId = fromId;
          swapRecord.juniorName = fromName;
          swapRecord.juniorChangedAt = appliedAt;
        }
        swapRecord.manuallyEdited = true;
        swapApplied = true;
      }
    }

    save(KEY_CHANGE_LOG, changeLog);
    save(KEY_HISTORY, history);
    closeChangeModal();
    renderHistoryTable();
    renderCheckTable();
    showToast(swapApplied ? '交代を反映しました（交換として2件の日付に反映）' : '交代を反映しました');
  });
}
function closeChangeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

/* ------------------------------------------------------------
 * 引継ぎ用Excel書出
 * ------------------------------------------------------------ */
/* ------------------------------------------------------------
 * 全データのバックアップ・復元（JSON）
 * ------------------------------------------------------------ */
const BACKUP_KEYS = {
  staffIdMap: KEY_STAFF_ID_MAP,
  periodStaff: KEY_PERIOD_STAFF,
  periodImportExcluded: KEY_IMPORT_EXCLUDED,
  genSessions: KEY_GEN_SESSION,
  historyStaff: KEY_HISTORY_STAFF,
  monthRules: KEY_MONTH_RULES,
  fiscalEvents: KEY_FISCAL_EVENTS,
  settings: KEY_SETTINGS,
  history: KEY_HISTORY,
  titleLevelMap: KEY_TITLE_LEVEL_MAP,
  leaves: KEY_LEAVES,
  periods: KEY_PERIODS,
  currentPeriodId: KEY_CURRENT_PERIOD,
  changeLog: KEY_CHANGE_LOG,
};
function initBackup() {
  document.getElementById('backup-export-btn').addEventListener('click', () => {
    const data = {};
    Object.entries(BACKUP_KEYS).forEach(([name, key]) => {
      data[name] = load(key, null);
    });
    const payload = {
      app: '日直勤務表 自動作成アプリ',
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const now = new Date();
    const stamp =
      toISO(now).replace(/-/g, '') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    downloadBlob(`日直勤務表_バックアップ_${stamp}.json`, blob);
    showToast('バックアップを作成しました');
  });

  document.getElementById('backup-import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      e.target.value = '';
      let payload;
      try {
        payload = JSON.parse(reader.result);
      } catch (err) {
        alert('バックアップファイルの読み込みに失敗しました（JSON形式ではありません）。');
        return;
      }
      const isNewFormat = payload && typeof payload === 'object' && payload.data && typeof payload.data.periodStaff === 'object';
      const isOldFormat = payload && typeof payload === 'object' && payload.data && Array.isArray(payload.data.staff);
      if (!isNewFormat && !isOldFormat) {
        alert('バックアップファイルの内容が正しくありません。');
        return;
      }
      const exportedAt = payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('ja-JP') : '不明';
      if (!confirm(`このバックアップ（作成日時：${exportedAt}）で現在のデータをすべて上書きします。よろしいですか？`)) {
        return;
      }
      if (isOldFormat && !isNewFormat) {
        // 旧形式（処理期共通の名簿）のバックアップ：一度そのまま書き戻し、次回起動時に処理期ごとの名簿へ自動移行させる
        localStorage.removeItem(KEY_PERIOD_STAFF);
        localStorage.removeItem(KEY_STAFF_ID_MAP);
        localStorage.removeItem(KEY_HISTORY_STAFF);
        save(KEY_STAFF, payload.data.staff);
      }
      Object.entries(BACKUP_KEYS).forEach(([name, key]) => {
        if (payload.data[name] !== undefined && payload.data[name] !== null) {
          save(key, payload.data[name]);
        }
      });
      showToast('バックアップを復元しました。画面を再読み込みします。');
      setTimeout(() => location.reload(), 800);
    };
    reader.readAsText(file, 'UTF-8');
  });
}

function initHandoverExport() {
  document.getElementById('history-handover-btn').addEventListener('click', () => {
    if (!history.length) {
      alert('書き出す履歴がありません');
      return;
    }
    const header = ['月 日', '曜日', '職員番号', '氏名', '変更日時', '職員番号', '氏名', '変更日時', '状態', '期間'];
    const rows = [header].concat(
      history.map((r) => [
        r.date,
        WEEKDAY_LABEL[r.weekday],
        (resolveAnyStaff(r.seniorId) || {}).number || '',
        r.seniorName || '',
        r.seniorChangedAt || '',
        (resolveAnyStaff(r.juniorId) || {}).number || '',
        r.juniorName || '',
        r.juniorChangedAt || '',
        statusLabel(r.status),
        r.periodLabel || '',
      ])
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '日直勤務表');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob('日直勤務表_引継ぎ用.xlsx', new Blob([wbout], { type: 'application/octet-stream' }));
    showToast('引継ぎ用Excelを書き出しました');
  });
}

/* ------------------------------------------------------------
 * PDF出力（html2canvasで画像化し、jsPDFに埋め込む）
 * ------------------------------------------------------------ */
/** PDF用の印刷シート要素を1枚作る。見出し欄は「氏名」で統一する（係長級・主事級の別は表示しない）。 */
function buildPrintSheetEl(headingHtml, rows) {
  const swapMarkers = computeSwapMarkers();
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.innerHTML = `
    ${headingHtml}
    <table>
      <thead><tr><th>日付</th><th>曜日</th><th>氏名</th><th>変更日時</th><th>氏名</th><th>変更日時</th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (r) => `<tr>
              <td>${r.date}</td>
              <td>${WEEKDAY_LABEL[r.weekday]}</td>
              <td>${swapMarkerHtml(r.date, 'senior', swapMarkers)}${escapeHtml(r.seniorName || '')}</td>
              <td>${escapeHtml(r.seniorChangedAt || '')}</td>
              <td>${swapMarkerHtml(r.date, 'junior', swapMarkers)}${escapeHtml(r.juniorName || '')}</td>
              <td>${escapeHtml(r.juniorChangedAt || '')}</td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="6" style="text-align:center;color:#666">該当日はありません</td></tr>'
        }
      </tbody>
    </table>`;
  return sheet;
}
/** .print-sheet の固定幅（style.css）。ページに収まる行数の見積もりに使う。 */
const PRINT_SHEET_WIDTH_PX = 780;
/** 1ページに収まる行数を実測する。日付・氏名等の欄はwhite-space:nowrapで折り返さないため、
 *  行の高さは常に一定になる。行数が異なる2つのサンプルシートの高さの差分から、見出し・
 *  ヘッダー行分を除いた1行あたりの高さを逆算し、ページの縦幅から収まる行数を求める。
 *  フォントのレンダリング差等を見込んで少し余裕（5%）を持たせる。 */
function computeRowsPerPage(pdf, margin) {
  const sampleRow = { date: '2026-04-01', weekday: 3, seniorName: '見本太郎太郎', seniorChangedAt: '2026-04-01 09:00', juniorName: '見本花子花子', juniorChangedAt: '2026-04-01 09:00' };
  const measureHeight = (n) => {
    const sheet = buildPrintSheetEl('<h2>見本</h2>', Array(n).fill(sampleRow));
    document.body.appendChild(sheet);
    const h = sheet.getBoundingClientRect().height;
    document.body.removeChild(sheet);
    return h;
  };
  const hA = measureHeight(5);
  const hB = measureHeight(20);
  const rowHeight = (hB - hA) / 15;
  const fixedOverhead = hA - 5 * rowHeight;
  const usableWidthPt = pdf.internal.pageSize.getWidth() - margin * 2;
  const usableHeightPt = pdf.internal.pageSize.getHeight() - margin * 2;
  const ptPerCssPx = usableWidthPt / PRINT_SHEET_WIDTH_PX;
  const usableCssHeight = usableHeightPt / ptPerCssPx;
  const rowsPerPage = Math.floor(((usableCssHeight - fixedOverhead) / rowHeight) * 0.95);
  return Math.max(1, rowsPerPage);
}
/** 1枚の印刷シートを画像化し、PDFのページとして追加する（呼び出し側で1ページに収まる行数に
 *  分割している前提だが、見積もりがずれて収まらない場合の保険として、続けてページを追加する）。 */
function addSheetPagesToPdf(pdf, sheet, margin, isVeryFirstPage) {
  document.body.appendChild(sheet);
  return window.html2canvas(sheet, { scale: 2 }).then((canvas) => {
    document.body.removeChild(sheet);
    const imgData = canvas.toDataURL('image/png');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;

    if (!isVeryFirstPage) pdf.addPage();
    let heightLeft = imgHeight;
    let position = margin;
    pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }
  }).catch((err) => {
    if (sheet.parentNode) document.body.removeChild(sheet);
    throw err;
  });
}
/** 1枚の印刷シートを画像化し、必ず1ページに収まるよう縦横比を保ったまま縮小してPDFに
 *  埋め込む（行数が多くても複数ページに分かれない）。横方向は中央寄せにする。 */
function addSheetFitToOnePage(pdf, sheet, margin, isVeryFirstPage) {
  document.body.appendChild(sheet);
  return window.html2canvas(sheet, { scale: 2 }).then((canvas) => {
    document.body.removeChild(sheet);
    const imgData = canvas.toDataURL('image/png');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    let width = maxWidth;
    let height = (canvas.height * width) / canvas.width;
    if (height > maxHeight) {
      height = maxHeight;
      width = (canvas.width * height) / canvas.height;
    }
    const x = margin + (maxWidth - width) / 2;
    if (!isVeryFirstPage) pdf.addPage();
    pdf.addImage(imgData, 'PNG', x, margin, width, height);
  }).catch((err) => {
    if (sheet.parentNode) document.body.removeChild(sheet);
    throw err;
  });
}
/** 行数が多い場合に備え、1ページに収まる行数ごとにシートを分けてPDF化する
 *  （表の行の途中でページが分かれることがなく、罫線が欠けない）。 */
function exportRowsToPdf(title, rows, filename) {
  if (!rows.length) {
    alert('出力する内容がありません');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const margin = 24;
  const rowsPerPage = computeRowsPerPage(pdf, margin);
  const chunks = [];
  for (let i = 0; i < rows.length; i += rowsPerPage) chunks.push(rows.slice(i, i + rowsPerPage));
  let chain = Promise.resolve();
  chunks.forEach((chunk, i) => {
    const sheet = buildPrintSheetEl(`<h2>${escapeHtml(title)}　日直勤務表</h2>`, chunk);
    chain = chain.then(() => addSheetPagesToPdf(pdf, sheet, margin, i === 0));
  });
  chain
    .then(() => pdf.save(filename))
    .catch((err) => alert('PDFの生成に失敗しました：' + err.message));
}
/** 処理期（前期／後期）の勤務表を、四半期ごとに1ページへ収めてPDF出力する（行数が多い場合は
 *  自動的に縮小して1ページに収める）。
 *  前期：1ページ目=処理期開始から3ヶ月（4〜6月）／2ページ目=残り3ヶ月（7〜9月）。
 *  後期：1ページ目=処理期開始から3ヶ月（10〜12月）／2ページ目=残り3ヶ月（1〜3月）。 */
function exportPeriodPdfByQuarter(period, rows, filename) {
  if (!rows.length) {
    alert('出力する内容がありません');
    return;
  }
  // ページの境界は period.startDate から3ヶ月後の日付ではなく、各行の実際の月（暦月）で
  // 判定する。startDateがちょうど月初でない場合（対象期間を手動で変更した場合等）でも、
  // ページの見出し（4月〜6月等）と実際に載る行の月が必ず一致するようにするため。
  const quarterDefs =
    period.half === 'H1'
      ? [
          { label: '4月〜6月', months: [4, 5, 6] },
          { label: '7月〜9月', months: [7, 8, 9] },
        ]
      : [
          { label: '10月〜12月', months: [10, 11, 12] },
          { label: '1月〜3月', months: [1, 2, 3] },
        ];
  const quarters = quarterDefs.map((qd) => ({
    label: qd.label,
    rows: rows.filter((r) => qd.months.includes(parseISO(r.date).getMonth() + 1)),
  }));
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const margin = 24;
  let chain = Promise.resolve();
  quarters.forEach((q, i) => {
    const sheet = buildPrintSheetEl(`<h2>${escapeHtml(period.label)}　日直勤務表（${q.label}）</h2>`, q.rows);
    chain = chain.then(() => addSheetFitToOnePage(pdf, sheet, margin, i === 0));
  });
  chain
    .then(() => pdf.save(filename))
    .catch((err) => alert('PDFの生成に失敗しました：' + err.message));
}
function initHistoryPdf() {
  document.getElementById('history-pdf-btn').addEventListener('click', () => {
    exportRowsToPdf('確定済み履歴', visibleHistory(), '日直勤務表_履歴.pdf');
  });
}

/* ------------------------------------------------------------
 * 職員ごとの担当状況
 * ------------------------------------------------------------ */
function staffDutyDates(staffId) {
  return history
    .filter((r) => r.seniorId === staffId || r.juniorId === staffId)
    .map((r) => ({ date: r.date, role: r.seniorId === staffId ? 'senior' : 'junior' }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
function renderCheckTable() {
  const tbody = document.getElementById('check-tbody');
  const scoped = visibleHistory(); // 履歴一覧と同じ表示フィルタ（既定：選択中の処理期）を使う
  const countMap = new Map();
  const lastMap = new Map();
  scoped.forEach((r) => {
    [
      [r.seniorId, r.date],
      [r.juniorId, r.date],
    ].forEach(([id, date]) => {
      if (!id) return;
      countMap.set(id, (countMap.get(id) || 0) + 1);
      const cur = lastMap.get(id);
      if (!cur || date > cur) lastMap.set(id, date);
    });
  });

  // 担当実績のある職員のみを表示する（未割当の確認は勤務表作成タブで行う）
  const rows = [...countMap.keys()]
    .map((id) => ({
      s: resolveAnyStaff(id) || { id, number: '', name: '（不明）', level: null, dept: '' },
      count: countMap.get(id),
      last: lastMap.get(id) || '',
    }))
    .sort((a, b) => a.count - b.count);
  tbody.innerHTML = rows
    .map(
      ({ s, count, last }) => `
    <tr>
      <td>${escapeHtml(s.number)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.level ? LEVEL_LABEL[s.level] : ''}</td>
      <td>${escapeHtml(s.dept || '')}</td>
      <td>${count}</td>
      <td>${last}</td>
      <td><button class="btn-secondary check-detail-btn" data-id="${s.id}">履歴を見る</button></td>
    </tr>
    <tr class="check-detail-row hidden" data-detail-for="${s.id}">
      <td colspan="7"></td>
    </tr>`
    )
    .join('');
  tbody.querySelectorAll('.check-detail-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = tbody.querySelector(`.check-detail-row[data-detail-for="${btn.dataset.id}"]`);
      const nowHidden = row.classList.contains('hidden');
      if (nowHidden) {
        const dates = staffDutyDates(btn.dataset.id);
        row.querySelector('td').textContent = dates.length
          ? dates.map((d) => `${d.date}(${LEVEL_LABEL[d.role]})`).join('、')
          : '（担当履歴なし）';
        btn.textContent = '閉じる';
      } else {
        btn.textContent = '履歴を見る';
      }
      row.classList.toggle('hidden');
    });
  });
}

/* ------------------------------------------------------------
 * Excel勤務実績データの取込
 * ------------------------------------------------------------ */
function parseHistoryWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const headerRowIdx = rows.findIndex((r) => r.filter((c) => normalizeHeader(c) === '職員番号').length >= 2);
    if (headerRowIdx === -1) continue;
    const headerRow = rows[headerRowIdx].map(normalizeHeader);
    const numberCols = [];
    headerRow.forEach((h, i) => {
      if (h === '職員番号') numberCols.push(i);
    });
    const nameCols = [];
    headerRow.forEach((h, i) => {
      if (h === '氏名') nameCols.push(i);
    });
    const changeCols = [];
    headerRow.forEach((h, i) => {
      if (h === '変更日時') changeCols.push(i);
    });
    if (numberCols.length < 2 || nameCols.length < 2) continue;
    let dateColIdx = headerRow.findIndex((h) => h.includes('月') || h.includes('日付'));
    if (dateColIdx === -1) dateColIdx = 0;
    return rows
      .slice(headerRowIdx + 1)
      .map((r) => {
        const dateIso = excelValueToISO(r[dateColIdx]);
        if (!dateIso) return null;
        return {
          date: dateIso,
          weekday: parseISO(dateIso).getDay(),
          seniorNumber: r[numberCols[0]] !== null && r[numberCols[0]] !== undefined ? String(r[numberCols[0]]).trim() : null,
          seniorName: r[nameCols[0]] ? String(r[nameCols[0]]).trim() : '',
          seniorChangedAt: changeCols[0] !== undefined ? excelValueToDateTimeText(r[changeCols[0]]) : null,
          juniorNumber: r[numberCols[1]] !== null && r[numberCols[1]] !== undefined ? String(r[numberCols[1]]).trim() : null,
          juniorName: r[nameCols[1]] ? String(r[nameCols[1]]).trim() : '',
          juniorChangedAt: changeCols[1] !== undefined ? excelValueToDateTimeText(r[changeCols[1]]) : null,
        };
      })
      .filter(Boolean);
  }
  return null;
}
function initHistoryXlsxImport() {
  document.getElementById('history-xlsx-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readWorkbookFile(file, (err, workbook) => {
      if (err) {
        alert('ファイルの読み込みに失敗しました：' + err.message);
        return;
      }
      const rows = parseHistoryWorkbook(workbook);
      if (!rows || !rows.length) {
        alert('勤務実績データの列（日付・職員番号・氏名など）が見つかりませんでした。ファイル形式をご確認ください。');
        return;
      }
      historyXlsxRows = rows;
      const dates = rows.map((r) => r.date).sort();
      document.getElementById('history-xlsx-summary').textContent =
        `${rows.length} 件のデータを検出しました（${dates[0]} 〜 ${dates[dates.length - 1]}）。既存の同じ日付のデータは取り込んだ内容で上書きされます。`;
      document.getElementById('history-xlsx-actions').classList.remove('hidden');
    });
  });

  document.getElementById('history-xlsx-cancel').addEventListener('click', () => {
    historyXlsxRows = null;
    document.getElementById('history-xlsx-input').value = '';
    document.getElementById('history-xlsx-summary').textContent = '';
    document.getElementById('history-xlsx-actions').classList.add('hidden');
  });

  document.getElementById('history-xlsx-confirm').addEventListener('click', () => {
    if (!historyXlsxRows) return;
    const targetPeriod = currentPeriod();
    let stubsCreated = 0;
    const resolveStaff = (number, name, level) => {
      if (!number) return null;
      const id = idForNumber(number);
      const existing = resolveAnyStaff(id);
      if (existing) return existing;
      const stub = {
        id, number, name: name || '（不明）', level, title: '', dept: '', section: '', sideJob: '',
        citizenExp: false, dispatched: false, seventyPercent: false, deptHistory: [], hireDate: null, retireDate: null, active: false,
      };
      historyStaffStubs.push(stub);
      invalidateStaffMapCache();
      stubsCreated++;
      return stub;
    };
    let imported = 0;
    historyXlsxRows.forEach((r) => {
      const seniorStaff = resolveStaff(r.seniorNumber, r.seniorName, 'senior');
      const juniorStaff = resolveStaff(r.juniorNumber, r.juniorName, 'junior');
      history = history.filter((h) => h.date !== r.date);
      const special = detectSpecialPeriod(parseISO(r.date));
      history.push({
        date: r.date,
        weekday: r.weekday,
        holidayName: null,
        seniorId: seniorStaff ? seniorStaff.id : null,
        juniorId: juniorStaff ? juniorStaff.id : null,
        seniorName: seniorStaff ? seniorStaff.name : r.seniorName,
        juniorName: juniorStaff ? juniorStaff.name : r.juniorName,
        seniorChangedAt: r.seniorChangedAt || null,
        juniorChangedAt: r.juniorChangedAt || null,
        manuallyEdited: !!(r.seniorChangedAt || r.juniorChangedAt),
        status: 'ok',
        reason: '',
        specialPeriodKey: special ? special.key : null,
        periodId: targetPeriod.id,
        periodLabel: targetPeriod.label,
      });
      imported++;
    });
    history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    save(KEY_HISTORY_STAFF, historyStaffStubs);
    save(KEY_HISTORY, history);
    renderHistoryTable();
    renderCheckTable();
    historyXlsxRows = null;
    document.getElementById('history-xlsx-input').value = '';
    document.getElementById('history-xlsx-summary').textContent = '';
    document.getElementById('history-xlsx-actions').classList.add('hidden');
    showToast(`勤務実績を「${targetPeriod.label}」に取り込みました（${imported}件 / 名簿にない職員${stubsCreated}名を追加）`);
  });
}

/* ------------------------------------------------------------
 * 使い方アシスタント（アプリ内検索型チャットボット）
 * 外部API・外部通信は一切使わず、埋め込み済みの「使い方」タブと仕様書・設計書の
 * テキストをキーワード検索して、関連しそうな見出しを回答として提示する。
 * 日本語は分かち書きされていないため、形態素解析の代わりに文字バイグラム
 * （連続2文字の集合）の一致数でスコアリングする簡易的な方法を使う。
 * ------------------------------------------------------------ */
let chatSearchIndex = null;
/** ユーザーが入力しがちな言い回しから、実際に文書中で使われている語への言い換え辞書。
 *  検索時にキーがクエリに含まれていれば、対応する語も一緒に検索対象に加える（同義語展開）。 */
const CHAT_SYNONYMS = {
  '印刷': ['PDF', '出力'],
  'プリント': ['PDF', '出力'],
  '出力': ['PDF', 'エクスポート'],
  'エクセル': ['xlsx', 'Excel', 'エクスポート'],
  'excel': ['xlsx', 'エクセル'],
  '交換': ['交代', '変更届'],
  '入れ替え': ['交代', '交換'],
  '差し替え': ['交代', '変更届'],
  '休み': ['休暇', '休業'],
  '休日': ['休暇'],
  '名前': ['氏名', '職員名'],
  '削除': ['消す', '取り消し'],
  '消去': ['削除', '取り消し'],
  '取り消し': ['削除', '取消'],
  '追加': ['登録', '新規'],
  '登録': ['追加', '新規'],
  '保存': ['バックアップ', 'エクスポート'],
  'バックアップ': ['保存', 'エクスポート', 'インポート'],
  '選挙': ['投票', '期日前'],
  '担当': ['当番', '日直'],
  '当番': ['担当', '日直'],
  '日直': ['担当', '当番'],
  '順番': ['割当', '割り当て', 'ローテーション'],
  '割り当て': ['割当', '順番'],
  '間違い': ['修正', '訂正', '変更'],
  '訂正': ['修正', '変更'],
  'やり方': ['方法', '手順'],
  '使い方': ['方法', '手順'],
};
/** Markdown由来の装飾記号を検索・表示のために取り除く（太字**、コード`、箇条書き記号、表の|、見出し#）。
 *  あわせて、HTML/Markdownソースのインデント由来の余分な空白・連続する空行も整える
 *  （チャット内でのその場プレビュー表示が読みやすくなるように）。 */
function stripMdArtifacts(text) {
  const cleaned = String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/^#+\s*/gm, '');
  const lines = cleaned.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
  const out = [];
  lines.forEach((line) => {
    if (line === '' && out[out.length - 1] === '') return;
    out.push(line);
  });
  return out.join('\n').trim();
}
/** 「使い方」タブのDOMから、見出し（h2/h3）ごとにセクションを切り出す。
 *  その他使い方（#help-other-content）内の見出しも対象に含む（折りたたまれていても検索対象）。
 *  h3は h2 の中にネストされたDOM構造になっているため、単純に「次の兄弟要素」を辿ると、
 *  大枠のh2（「その他使い方」等）が配下の全h3の本文を丸ごと抱え込んでしまい、
 *  ほぼどんな検索語にもヒットする巨大セクションになってしまう。そのため Range を使い、
 *  ネスト位置に関係なく「このヘッダーの直後」から「（ネスト有無を問わず）次のヘッダーの直前」までを
 *  文書順で取り出す。 */
function buildHelpChatSections() {
  const panel = document.getElementById('panel-help');
  if (!panel) return [];
  const headings = Array.from(panel.querySelectorAll('h2, h3'));
  return headings.map((h, i) => {
    const range = document.createRange();
    range.setStartAfter(h);
    if (headings[i + 1]) range.setEndBefore(headings[i + 1]);
    else range.setEndAfter(panel.lastChild);
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    return { source: 'help', label: '使い方', heading: h.textContent.trim(), content: stripMdArtifacts(holder.textContent), element: h };
  });
}
/** 仕様書・設計書のMarkdown文字列から、見出し（#〜####）ごとにセクションを切り出す。
 *  アンカーIDは renderMarkdownDoc() と同じ採番方法（見出し行の配列インデックス）に合わせる。 */
function buildDocChatSections(md, docKind, label) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  lines.forEach((line, idx) => {
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { source: 'doc', docKind, label, heading: m[2].trim(), content: '', anchorId: `doc-h-${idx}` };
    } else if (current) {
      current.content += ' ' + line;
    }
  });
  if (current) sections.push(current);
  sections.forEach((sec) => { sec.content = stripMdArtifacts(sec.content); });
  return sections;
}
/** 検索用インデックスを（初回のみ）まとめて構築する。使い方タブの文言は将来変わりうるため
 *  都度再構築しても軽いが、仕様書・設計書は分量があるので初回だけ解析してキャッシュする。 */
function getChatSearchIndex() {
  if (chatSearchIndex) return chatSearchIndex;
  const specMd = typeof SPEC_DOC_MD !== 'undefined' ? SPEC_DOC_MD : '';
  const designMd = typeof DESIGN_DOC_MD !== 'undefined' ? DESIGN_DOC_MD : '';
  chatSearchIndex = [
    ...buildHelpChatSections(),
    ...buildDocChatSections(specMd, 'spec', '仕様書'),
    ...buildDocChatSections(designMd, 'design', '設計書'),
  ];
  return chatSearchIndex;
}
/** 文字列を連続2文字（バイグラム）の集合にする（空白は無視する）。1文字以下の場合は
 *  そのまま1文字の集合として扱う（短いキーワードでも検索できるようにするため）。 */
function toBigramSet(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const set = new Set();
  if (s.length <= 1) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function countOverlap(setA, setB) {
  let n = 0;
  setA.forEach((g) => { if (setB.has(g)) n++; });
  return n;
}
/** クエリに含まれる同義語辞書のキーに対応する言い換え語を集める（重複除去）。 */
function expandQuerySynonyms(query) {
  const q = String(query || '');
  const extra = new Set();
  Object.keys(CHAT_SYNONYMS).forEach((key) => {
    if (q.includes(key)) CHAT_SYNONYMS[key].forEach((t) => extra.add(t));
  });
  return Array.from(extra);
}
/** クエリに関連しそうなセクションをスコア降順で返す（呼び出し側で表示件数を絞る）。
 *  見出しとの一致を本文との一致より重く評価し、完全な部分一致にはボーナスを与える。
 *  仕様書・設計書にはコード識別子等の英数字も含まれるため、単純に「バイグラムが1つでも
 *  一致すれば採用」にすると、無関係な文字列でも巨大な文書全体のどこかとたまたま一致して
 *  ヒットしてしまう。そのため、クエリのバイグラムのうち一定割合（34%）以上が同じセクションの
 *  見出しまたは本文にまとまって含まれている場合（＝完全な部分一致の場合を含む）のみ採用する。
 *  同義語辞書で展開した言い換え語も検索・完全一致判定・ハイライト表示の対象に加える。 */
function searchChatIndex(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const synonymTerms = expandQuerySynonyms(q);
  const qGrams = toBigramSet([q, ...synonymTerms].join(' '));
  const highlightTerms = [q, ...synonymTerms].filter((t) => t && t.length >= 1);
  const index = getChatSearchIndex();
  const scored = index.map((sec) => {
    const headingGrams = toBigramSet(sec.heading);
    const contentGrams = toBigramSet(sec.content);
    const headingOverlap = countOverlap(qGrams, headingGrams);
    const contentOverlap = countOverlap(qGrams, contentGrams);
    const bestRatio = Math.max(headingOverlap, contentOverlap) / qGrams.size;
    const exactHit = [q, ...synonymTerms].some((t) => sec.heading.includes(t) || sec.content.includes(t));
    let score = headingOverlap * 3 + contentOverlap;
    if (sec.heading.includes(q)) score += 30;
    if (sec.content.includes(q)) score += 10;
    return { sec, score, bestRatio, exactHit, highlightTerms };
  });
  return scored
    .filter((r) => r.exactHit || r.bestRatio >= 0.34)
    .sort((a, b) => b.score - a.score);
}
/** テキスト中でヒットした語（terms）を <strong class="chatbot-hit"> で囲みつつ、その他はHTMLエスケープする。 */
function highlightHtml(text, terms) {
  const s = String(text || '');
  const ranges = [];
  (terms || []).forEach((t) => {
    if (!t) return;
    let idx = 0;
    while (true) {
      const pos = s.indexOf(t, idx);
      if (pos === -1) break;
      ranges.push([pos, pos + t.length]);
      idx = pos + t.length;
    }
  });
  if (!ranges.length) return escapeHtml(s);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  ranges.slice(1).forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  let html = '';
  let last = 0;
  merged.forEach(([start, end]) => {
    html += escapeHtml(s.slice(last, start));
    html += '<strong class="chatbot-hit">' + escapeHtml(s.slice(start, end)) + '</strong>';
    last = end;
  });
  html += escapeHtml(s.slice(last));
  return html;
}
/** 本文からヒット語の周辺を抜き出したスニペット（HTML、ハイライト済み）を作る。 */
function extractSnippet(content, terms, maxLen) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const limit = maxLen || 70;
  if (text.length <= limit) return highlightHtml(text, terms);
  let hitPos = -1;
  (terms || []).some((t) => {
    if (!t) return false;
    const idx = text.indexOf(t);
    if (idx !== -1) { hitPos = idx; return true; }
    return false;
  });
  let start = hitPos === -1 ? 0 : Math.max(0, hitPos - Math.floor(limit / 3));
  if (start + limit > text.length) start = Math.max(0, text.length - limit);
  let snippet = text.slice(start, start + limit);
  if (start > 0) snippet = '…' + snippet;
  if (start + limit < text.length) snippet += '…';
  return highlightHtml(snippet, terms);
}
function chatAppendMessage(role, html) {
  const wrap = document.getElementById('chatbot-messages');
  const div = document.createElement('div');
  div.className = 'chatbot-msg ' + (role === 'user' ? 'chatbot-msg-user' : 'chatbot-msg-bot');
  div.innerHTML = html;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}
/** 検索結果の該当箇所へ移動する。使い方タブ内の見出しはそのままスクロールし、
 *  「その他使い方」に隠れている場合は先に展開する。仕様書・設計書は該当タブに切り替えて
 *  必要なら仕様書/設計書を切り替えたうえで再描画し、アンカーへスクロールする。 */
function chatJumpToSection(sec) {
  if (sec.source === 'help') {
    document.querySelector('.tab-btn[data-tab="help"]').click();
    const otherContent = document.getElementById('help-other-content');
    if (otherContent && otherContent.contains(sec.element) && otherContent.classList.contains('hidden')) {
      otherContent.classList.remove('hidden');
      const toggleBtn = document.getElementById('help-other-toggle');
      if (toggleBtn) toggleBtn.textContent = 'その他使い方を隠す';
    }
    requestAnimationFrame(() => {
      sec.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sec.element.classList.add('chatbot-highlight');
      setTimeout(() => sec.element.classList.remove('chatbot-highlight'), 1600);
    });
  } else {
    document.querySelector('.tab-btn[data-tab="docs"]').click();
    if (currentDocKind !== sec.docKind) {
      document.querySelectorAll('.doc-switch-btn').forEach((b) => b.classList.toggle('active', b.dataset.doc === sec.docKind));
      currentDocKind = sec.docKind;
      renderDocTab();
    }
    requestAnimationFrame(() => {
      const target = document.getElementById(sec.anchorId);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('chatbot-highlight');
      setTimeout(() => target.classList.remove('chatbot-highlight'), 1600);
    });
  }
  document.getElementById('chatbot-panel').classList.add('hidden');
}
/** よくある質問チップ（クリックするだけでその語で検索できる）。 */
const CHATBOT_QUICK_CHIPS = [
  '勤務表を作る',
  '変更届を反映する',
  'PDFを出力する',
  '職員を登録する',
  'バックアップの取り方',
  '選挙の日直登録',
];
function chatScrollToBottom() {
  const wrap = document.getElementById('chatbot-messages');
  wrap.scrollTop = wrap.scrollHeight;
}
function appendQuickChips() {
  const wrap = document.createElement('div');
  wrap.className = 'chatbot-chips';
  CHATBOT_QUICK_CHIPS.forEach((label) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chatbot-chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      chatAppendMessage('user', escapeHtml(label));
      runChatQuery(label);
    });
    wrap.appendChild(chip);
  });
  document.getElementById('chatbot-messages').appendChild(wrap);
  chatScrollToBottom();
}
/** 1件の検索結果を表示するUIを組み立てる。見出し＋抜粋（ハイライト付き）のボタンを押すと、
 *  チャット内にその場で本文を展開する（画面遷移しない）。「この場所を画面で開く」で
 *  該当タブ・該当箇所へ実際にジャンプする。 */
function buildResultItem(r) {
  const sec = r.sec;
  const terms = r.highlightTerms || [];
  const item = document.createElement('div');
  item.className = 'chatbot-result-item';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chatbot-result-btn';
  const snippet = extractSnippet(sec.content, terms, 70);
  btn.innerHTML = `<span class="chatbot-result-heading">${highlightHtml(sec.heading, terms)}<span class="chatbot-result-source">${escapeHtml(sec.label)}</span></span>` +
    (snippet ? `<span class="chatbot-result-snippet">${snippet}</span>` : '');
  const inlineWrap = document.createElement('div');
  inlineWrap.className = 'chatbot-inline-content hidden';
  const fullText = sec.content.length > 500 ? sec.content.slice(0, 500) + '…' : sec.content;
  const inlineText = document.createElement('div');
  inlineText.className = 'chatbot-inline-text';
  inlineText.innerHTML = highlightHtml(fullText, terms) || '（本文はありません）';
  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'chatbot-jump-btn';
  jumpBtn.textContent = 'この場所を画面で開く';
  jumpBtn.addEventListener('click', () => chatJumpToSection(sec));
  inlineWrap.appendChild(inlineText);
  inlineWrap.appendChild(jumpBtn);
  btn.addEventListener('click', () => {
    inlineWrap.classList.toggle('hidden');
    if (!inlineWrap.classList.contains('hidden')) {
      requestAnimationFrame(() => inlineWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  });
  item.appendChild(btn);
  item.appendChild(inlineWrap);
  return item;
}
/** キーワードqで検索し、結果をチャットに追加する。使い方タブの内容がヒットした場合は
 *  それを優先して表示し、仕様書・設計書は「詳しい資料も見る」の折りたたみに回す
 *  （使い方タブが専門用語の少ない案内文であるのに対し、仕様書・設計書は章番号や
 *  専門的な記述が多く、初見では分かりづらいため）。使い方タブに該当が無い場合のみ、
 *  仕様書・設計書を通常表示する。 */
function runChatQuery(q) {
  const results = searchChatIndex(q);
  if (!results.length) {
    chatAppendMessage('bot', '関連しそうな内容が見つかりませんでした。別のキーワードでお試しいただくか、下のよくある質問からお選びください。');
    appendQuickChips();
    return;
  }
  const helpResults = results.filter((r) => r.sec.source === 'help').slice(0, 5);
  const docResults = results.filter((r) => r.sec.source !== 'help').slice(0, 5);
  const primary = helpResults.length ? helpResults : docResults;
  const secondary = helpResults.length ? docResults : [];
  const msgEl = chatAppendMessage('bot', `「${escapeHtml(q)}」に関連しそうな内容です。押すとその場で詳しく開けます。`);
  const resultsWrap = document.createElement('div');
  resultsWrap.className = 'chatbot-results';
  primary.forEach((r) => resultsWrap.appendChild(buildResultItem(r)));
  msgEl.appendChild(resultsWrap);
  if (secondary.length) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'chatbot-more-btn';
    const moreLabel = `詳しい資料も見る（仕様書・設計書 ${secondary.length}件）`;
    moreBtn.textContent = moreLabel;
    const secWrap = document.createElement('div');
    secWrap.className = 'chatbot-results hidden';
    secondary.forEach((r) => secWrap.appendChild(buildResultItem(r)));
    moreBtn.addEventListener('click', () => {
      secWrap.classList.toggle('hidden');
      moreBtn.textContent = secWrap.classList.contains('hidden') ? moreLabel : '詳しい資料を隠す';
      chatScrollToBottom();
    });
    msgEl.appendChild(moreBtn);
    msgEl.appendChild(secWrap);
  }
  chatScrollToBottom();
}
function initChatbot() {
  const toggleBtn = document.getElementById('chatbot-toggle');
  const panel = document.getElementById('chatbot-panel');
  const closeBtn = document.getElementById('chatbot-close');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  let greeted = false;
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      if (!greeted) {
        chatAppendMessage(
          'bot',
          'こんにちは。使い方や機能についてキーワードで質問するか、下のよくある質問から選んでください。<br>このアプリの使い方・仕様書・設計書の中から関連しそうな箇所を検索して回答します。外部との通信は行いません。'
        );
        appendQuickChips();
        greeted = true;
      }
      input.focus();
    }
  });
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    chatAppendMessage('user', escapeHtml(q));
    input.value = '';
    runChatQuery(q);
  });
}

/* ------------------------------------------------------------
 * 初期化
 * ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initStaffForm();
  initStaffSearch();
  initStaffXlsxImport();
  initHistoryXlsxImport();
  initBackup();
  initHandoverExport();
  initHistoryPdf();
  initOptions();
  initLeaveForm();
  initStandingRuleForm();
  initMonthRuleForm();
  initEventForm();
  initGenerateDates();
  initGenerateRun();
  initHistoryPeriodFilter();
  initHistoryBulkDelete();
  initLeaveXlsxImport();
  initMaternityXlsxImport();
  initSickLeaveXlsxImport();
  initPeriodBar();
  initDocsTab();
  initHelpToggle();
  initChatbot();

  renderStaffTable();
  renderMonthRuleTable();
  renderHistoryTable();
  renderCheckTable();

  applyPeriodToGenerateTab();
});
