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

const DEFAULT_SETTINGS = {
  minGapDays: 120,
  newHireMonths: 6,
  specialLookback: 2,
  pairLookbackYears: 2,
  standingExcludedDepts: [],
};
const DEFAULT_MONTH_RULES = [
  { id: 'default-1', months: [10, 11], depts: ['商工観光課', '広報係'], note: 'イベントが多いため' },
  { id: 'default-2', months: [12, 1], depts: ['ふるさと納税係'], note: 'ふるさと納税繁忙期のため' },
  { id: 'default-3', months: [1, 2, 3, 4], depts: ['税務課'], note: '' },
];

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
let historyStaffStubs = load(KEY_HISTORY_STAFF, []); // どの処理期の名簿にもいない、勤務実績のみの職員

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
let draftResults = []; // 作成された勤務表（未確定）
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
    });
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
      <td>
        <label class="checkbox-label" style="gap:4px">
          <input type="checkbox" class="citizen-toggle" data-id="${s.id}" ${citizen ? 'checked' : ''}>
          ${autoCitizen ? '<span class="muted" style="font-size:11px">（自動判定あり）</span>' : ''}
        </label>
      </td>
      <td><input type="checkbox" class="dispatched-toggle" data-id="${s.id}" ${s.dispatched ? 'checked' : ''}></td>
      <td><input type="checkbox" class="seventy-toggle" data-id="${s.id}" ${s.seventyPercent ? 'checked' : ''}></td>
      ${showReason ? `<td>${escapeHtml(exclusionReason(s))}</td>` : ''}
      <td>${escapeHtml(s.hireDate || '')}</td>
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
  document.getElementById('staff-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const number = document.getElementById('st-number').value.trim();
    const carry = number ? previousPeriodStaffMap().get(number) : null;
    const rec = {
      id: number ? idForNumber(number) : uid('st'),
      number,
      name: document.getElementById('st-name').value.trim(),
      level: document.getElementById('st-level').value,
      gender: null,
      title: document.getElementById('st-title').value.trim(),
      dept: document.getElementById('st-dept').value.trim(),
      section: document.getElementById('st-section').value.trim(),
      sideJob: document.getElementById('st-sidejob').value.trim(),
      hireDate: document.getElementById('st-hire').value || null,
      retireDate: null,
      deptHistory: [],
      citizenExp: document.getElementById('st-citizen').checked || !!(carry && carry.citizenExp),
      dispatched: !!(carry && carry.dispatched),
      seventyPercent: !!(carry && carry.seventyPercent),
      active: document.getElementById('st-active').checked,
    };
    if (!rec.name || !rec.dept) return;
    staff.push(rec);
    savePeriodStaff();
    renderStaffTable();
    e.target.reset();
    document.getElementById('st-active').checked = true;
    showToast('職員を追加しました');
  });

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
        title: '',
        dept: dept.trim(),
        section: '',
        sideJob: '',
        deptHistory: [],
        hireDate: (hireDate || '').trim() || null,
        retireDate: null,
        citizenExp: /true|○|はい/i.test(citizenRaw || '') || !!(carry && carry.citizenExp),
        dispatched: !!(carry && carry.dispatched),
        seventyPercent: !!(carry && carry.seventyPercent),
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
    let imported = 0;
    let skipped = 0;
    let skippedByCategory = 0;
    let carriedCitizen = 0;
    let autoCitizen = 0;
    let carriedDispatched = 0;
    let carriedSeventy = 0;
    const newStaff = [];
    staffXlsxRows.forEach((r) => {
      if (isExcludedCategory(r.category)) {
        skippedByCategory++;
        return;
      }
      const level = resolveImportLevel(r);
      const retired = !!r.retireDate || r.activeFlag === 0 || r.activeFlag === '0';
      if (level === 'exclude' || retired) {
        skipped++;
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
      const deptHistory = prev ? [...(prev.deptHistory || [])] : [];
      if (prev && prev.dept && prev.dept !== r.dept && !deptHistory.includes(prev.dept)) deptHistory.push(prev.dept);

      newStaff.push({
        id: idForNumber(r.number),
        number: r.number,
        name: r.name,
        level,
        title: r.title,
        dept: r.dept,
        deptCode: r.deptCode,
        gender: r.gender,
        section: r.section,
        sideJob: r.sideJob,
        citizenExp,
        dispatched,
        seventyPercent,
        deptHistory,
        hireDate: r.hireDate,
        retireDate: null,
        active: true,
      });
      imported++;
    });
    staff = newStaff;
    savePeriodStaff();
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
}
function initOptions() {
  renderOptions();
  document.getElementById('opt-save').addEventListener('click', () => {
    settings.minGapDays = Number(document.getElementById('opt-mingap').value) || 0;
    settings.newHireMonths = Number(document.getElementById('opt-newhire').value) || 0;
    settings.specialLookback = Number(document.getElementById('opt-lookback').value) || 0;
    settings.pairLookbackYears = Number(document.getElementById('opt-pair-lookback').value) || 0;
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
      }))
      .filter((r) => r.startDate);
  }
  return null;
}
/** 育休・産休Excelの解析結果を育休等除外期間（leaves）へ取り込む共通処理。
 *  名簿にない職員番号（会計年度任用職員等）の行は取込対象外とする */
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

function initLeaveForm() {
  renderLeaveTable();
  document.getElementById('leave-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const staffNumber = document.getElementById('lv-number').value.trim();
    const startDate = document.getElementById('lv-start').value;
    const endDate = document.getElementById('lv-end').value || null;
    if (!staffNumber || !startDate) return;
    if (!staff.some((s) => String(s.number) === staffNumber)) {
      alert(`職員番号「${staffNumber}」は名簿に登録されていません。名簿にある職員番号のみ登録できます。`);
      return;
    }
    if (endDate && startDate > endDate) {
      alert('終了日は開始日以降の日付にしてください。');
      return;
    }
    leaves.push({ id: uid('lv'), staffNumber, startDate, endDate, category: '', importedName: '' });
    save(KEY_LEAVES, leaves);
    renderLeaveTable();
    e.target.reset();
    showToast('育休等の除外期間を登録しました');
  });
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
function renderEventTable() {
  document.getElementById('ev-list-title').textContent = `${currentEventYear}年度の行事一覧`;
  const tbody = document.getElementById('event-tbody');
  const list = fiscalEvents.filter((e) => e.fiscalYear === currentEventYear).sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  tbody.innerHTML = list
    .map(
      (e) => `
    <tr>
      <td>${escapeHtml(e.name || '')}</td>
      <td>${escapeHtml(e.date || '')}${e.endDate && e.endDate !== e.date ? ' 〜 ' + escapeHtml(e.endDate) : ''}</td>
      <td>${escapeHtml(e.excludeFrom || '')}</td>
      <td>${(e.depts || []).map(escapeHtml).join('、')}</td>
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
      <thead><tr><th>行事名</th><th>行事日</th><th>除外開始日</th><th>除外する所属</th></tr></thead>
      <tbody>
        ${list
          .map(
            (e) => `
        <tr>
          <td>${escapeHtml(e.name || '')}</td>
          <td>${escapeHtml(e.date || '')}${e.endDate && e.endDate !== e.date ? ' 〜 ' + escapeHtml(e.endDate) : ''}</td>
          <td>${escapeHtml(e.excludeFrom || '')}</td>
          <td>${(e.depts || []).map(escapeHtml).join('、')}</td>
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

  document.getElementById('event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('ev-label').value.trim();
    const date = document.getElementById('ev-date').value;
    const endDate = document.getElementById('ev-end').value || date;
    const leadDays = Number(document.getElementById('ev-lead').value) || 0;
    const excludeFrom = document.getElementById('ev-exclude-from').value || date;
    const depts = [...document.getElementById('ev-depts').selectedOptions].map((o) => o.value);
    if (!date || !depts.length) {
      alert('行事日と除外する所属を入力してください');
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
      depts,
    });
    save(KEY_FISCAL_EVENTS, fiscalEvents);
    renderEventTable();
    e.target.reset();
    document.getElementById('ev-lead').value = 30;
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
      depts: e.depts,
    }));
    fiscalEvents = fiscalEvents.concat(copied);
    save(KEY_FISCAL_EVENTS, fiscalEvents);
    renderEventTable();
    showToast(`${prevYear}年度から${copied.length}件の行事をコピーしました（日付は入力してください）`);
  });
}
/** 対象期間に適用する行事除外リストを組み立てる（generateAssignments渡し用） */
function computeEventExclusions() {
  return fiscalEvents
    .filter((e) => e.excludeFrom && e.depts && e.depts.length)
    .map((e) => ({ date: e.excludeFrom, endDate: e.endDate || e.date, depts: e.depts }));
}

/* ------------------------------------------------------------
 * 勤務表作成
 * ------------------------------------------------------------ */
let genDatesEmptyReason = null; // 抽出結果が0件だった理由（表示用）
function renderGenDatesTable() {
  const tbody = document.getElementById('gen-dates-tbody');
  tbody.innerHTML = draftDates
    .map(
      (d, i) => `
    <tr>
      <td>${d.date}</td>
      <td>${WEEKDAY_LABEL[d.weekday]}</td>
      <td>${escapeHtml(d.holidayName || '')}</td>
      <td><input type="checkbox" class="gen-date-toggle" data-idx="${i}" ${d.include !== false ? 'checked' : ''}></td>
    </tr>`
    )
    .join('');
  document.getElementById('gen-dates-summary').textContent = draftDates.length
    ? `${draftDates.length} 日を抽出しました（対象から外したい日はチェックを外してください）`
    : genDatesEmptyReason || '';
  tbody.querySelectorAll('.gen-date-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      draftDates[Number(cb.dataset.idx)].include = cb.checked;
    });
  });
}
function initGenerateDates() {
  document.getElementById('gen-list-dates').addEventListener('click', () => {
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
    renderGenDatesTable();
  });
}

function renderGenResultTable() {
  const tbody = document.getElementById('gen-result-tbody');
  tbody.innerHTML = draftResults
    .map(
      (r, i) => `
    <tr class="${r.status === 'warning' ? 'row-warning' : ''}">
      <td>${r.date}</td>
      <td>${WEEKDAY_LABEL[r.weekday]}</td>
      <td>${escapeHtml(r.holidayName || '')}</td>
      <td>
        <span class="assign-name-chip" draggable="true" data-idx="${i}" data-level="senior" title="ドラッグして他の日・欄の職員と入れ替えられます">${r.seniorName ? escapeHtml(r.seniorName) : '未定'}</span>
        ${renderStaffSelect(i, 'senior', r.seniorId)}
      </td>
      <td>
        <span class="assign-name-chip" draggable="true" data-idx="${i}" data-level="junior" title="ドラッグして他の日・欄の職員と入れ替えられます">${r.juniorName ? escapeHtml(r.juniorName) : '未定'}</span>
        ${renderStaffSelect(i, 'junior', r.juniorId)}
      </td>
      <td>${r.status === 'ok' ? 'OK' : '要確認：' + escapeHtml(r.reason)}</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.result-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const idx = Number(sel.dataset.idx);
      const level = sel.dataset.level;
      const s = staffById(sel.value) || null;
      draftResults[idx][level + 'Id'] = s ? s.id : null;
      draftResults[idx][level + 'Name'] = s ? s.name : '';
      revalidateDraftResult(idx);
      renderGenResultTable();
    });
  });

  let dragSource = null;
  tbody.querySelectorAll('.assign-name-chip').forEach((chip) => {
    chip.addEventListener('dragstart', (e) => {
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
      renderGenResultTable();
    });
  });

  const warnCount = draftResults.filter((r) => r.status === 'warning').length;
  document.getElementById('gen-warning-summary').innerHTML = draftResults.length
    ? `<p class="hint">合計 ${draftResults.length} 日 / 要確認 ${warnCount} 日</p>`
    : '';

  const unassignedEl = document.getElementById('gen-unassigned-summary');
  if (unassignedEl) {
    if (!draftResults.length) {
      unassignedEl.innerHTML = '';
    } else {
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
        unassignedEl.innerHTML = '<p style="margin:0;font-weight:600">対象職員は全員、今期すでに少なくとも1回は割り当てられています。</p>';
      } else {
        const explainCtx = {
          dutyDates: draftResults.map((r) => ({ date: r.date })),
          results: draftResults,
          staffList: staff,
          monthRules,
          eventExclusions: computeEventExclusions(),
          history,
          minGapDays: settings.minGapDays,
          newHireMonths: settings.newHireMonths,
          leaves,
        };
        const items = genUnassigned
          .map(
            (s) =>
              `<li><strong>${escapeHtml(s.name)}</strong>（${LEVEL_LABEL[s.level]}・${escapeHtml(s.dept)}）：${escapeHtml(
                explainUnassignedStaff(s, explainCtx)
              )}</li>`
          )
          .join('');
        unassignedEl.innerHTML = `<p style="margin:0 0 4px;font-weight:600">今期まだ割り当てられていない対象職員（${genUnassigned.length}名）</p><ul style="margin:0;padding-left:20px;font-weight:normal">${items}</ul>`;
      }
    }
  }

  document.getElementById('gen-confirm').disabled = draftResults.length === 0;
  document.getElementById('gen-export').disabled = draftResults.length === 0;
  document.getElementById('gen-pdf').disabled = draftResults.length === 0;
}
/** level='senior'（1人目）は必ず係長級から選ぶ。level='junior'（2人目）は係長級・主事級のどちらも選べる
 *（1日2名のうち少なくとも1名が係長級であればよいため、係長級2名の組合せも許可している）。 */
function renderStaffSelect(idx, level, currentId) {
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
  return `<select class="result-select" data-idx="${idx}" data-level="${level}"><option value="">未定</option>${options}</select>`;
}
/** 手動での入れ替え・選択後に、その日の組合せが実際のルールに反しないかを確認し、
 *  違反があれば理由の一覧を返す（空配列なら問題なし）。入れ替え自体は常に許可し、
 *  違反時は「要確認」表示に切り替えるだけにとどめる。 */
function validateManualPair(seniorRec, juniorRec) {
  const reasons = [];
  if (!seniorRec || !juniorRec) {
    reasons.push('片方が未定です');
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
  const usedElsewhere = new Set();
  history.forEach((h) => {
    if (h.periodId !== p.id) return;
    if (h.seniorId) usedElsewhere.add(h.seniorId);
    if (h.juniorId) usedElsewhere.add(h.juniorId);
  });
  draftResults.forEach((other, oi) => {
    if (oi === idx) return;
    if (other.seniorId) usedElsewhere.add(other.seniorId);
    if (other.juniorId) usedElsewhere.add(other.juniorId);
  });
  if ((r.seniorId && usedElsewhere.has(r.seniorId)) || (r.juniorId && usedElsewhere.has(r.juniorId))) {
    violations.push('同一処理期内で2回目の割当です');
  }

  r.status = violations.length ? 'warning' : 'ok';
  r.reason = violations.length ? violations.join(' / ') : '（手動で修正済み）';
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
}

function initGenerateRun() {
  document.getElementById('gen-run').addEventListener('click', () => {
    const targetDates = draftDates.filter((d) => d.include !== false);
    if (!targetDates.length) {
      alert('対象の指定日がありません。まず「土日・祝日・年末年始を自動抽出」を実行してください。');
      return;
    }
    draftResults = generateAssignments({
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
      leaves,
      periodId: currentPeriod().id,
    });
    renderGenResultTable();
    showToast('勤務表を作成しました');
  });

  document.getElementById('gen-confirm').addEventListener('click', () => {
    if (!draftResults.length) return;
    const p = currentPeriod();
    const withLabel = draftResults.map((r) => ({
      ...r,
      periodId: p.id,
      periodLabel: p.label,
      confirmedAt: new Date().toISOString(),
    }));
    history = history.concat(withLabel).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    save(KEY_HISTORY, history);
    showToast('履歴に保存しました');
    draftResults = [];
    draftDates = [];
    renderGenResultTable();
    renderGenDatesTable();
  });

  document.getElementById('gen-export').addEventListener('click', () => {
    const rows = [['日付', '曜日', '祝日等', '係長級', '主事級', '状態']].concat(
      draftResults.map((r) => [r.date, WEEKDAY_LABEL[r.weekday], r.holidayName || '', r.seniorName, r.juniorName, r.status === 'ok' ? 'OK' : '要確認'])
    );
    downloadCsv('日直勤務表.csv', rows);
  });

  document.getElementById('gen-pdf').addEventListener('click', () => {
    const label = currentPeriod().label;
    exportRowsToPdf(label, draftResults, `日直勤務表_${label}.pdf`);
  });
}
/** 処理期の期間を勤務表作成タブの入力欄へ反映する */
function applyPeriodToGenerateTab() {
  const p = currentPeriod();
  document.getElementById('gen-start').value = p.startDate;
  document.getElementById('gen-end').value = p.endDate;
  const label = document.getElementById('gen-period-label');
  if (label) label.textContent = p.label;
  draftDates = [];
  draftResults = [];
  genDatesEmptyReason = null;
  renderGenDatesTable();
  renderGenResultTable();
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
function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  renderHistoryPeriodFilter();
  const rows = visibleHistory();
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr class="${r.status === 'warning' ? 'row-warning' : ''}">
      <td>${escapeHtml(r.periodLabel || '')}</td>
      <td>${r.date}</td>
      <td>${WEEKDAY_LABEL[r.weekday]}</td>
      <td>${escapeHtml(r.seniorName)}<div class="row-actions"><button class="btn-secondary change-btn" data-date="${r.date}" data-level="senior">交代を反映</button></div></td>
      <td>${escapeHtml(r.seniorChangedAt || '')}</td>
      <td>${escapeHtml(r.juniorName)}<div class="row-actions"><button class="btn-secondary change-btn" data-date="${r.date}" data-level="junior">交代を反映</button></div></td>
      <td>${escapeHtml(r.juniorChangedAt || '')}</td>
      <td>${r.status === 'ok' ? 'OK' : '要確認'}</td>
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

document.addEventListener('click', (e) => {
  if (e.target.id === 'history-export-btn') {
    const rows = [['期間', '日付', '曜日', '係長級', '変更日時', '主事級', '変更日時', '状態']].concat(
      history.map((r) => [
        r.periodLabel || '',
        r.date,
        WEEKDAY_LABEL[r.weekday],
        r.seniorName,
        r.seniorChangedAt || '',
        r.juniorName,
        r.juniorChangedAt || '',
        r.status === 'ok' ? 'OK' : '要確認',
      ])
    );
    downloadCsv('日直勤務表_履歴.csv', rows);
  }
});

/* ------------------------------------------------------------
 * 変更届の反映（確定済み履歴の編集）
 * ------------------------------------------------------------ */
/** 変更申請のスクリーンショットをOCRで読み取り、交代後の氏名・申請日時をプレフィルする。
 *  読み取り結果は下書きとして入力欄にセットするだけで、反映には引き続き「反映する」の操作が必要。 */
async function runChangeOcr(file, targetDate, candidates) {
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
    const text = data.text;

    const nameRaw = extractLabelValue(text, '交代相手氏名');
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
      messages.push(`⚠ 読み取った変更対象日（${changedDate}）が、この行の日付（${targetDate}）と一致しません。別の変更届の画像でないかご確認ください。`);
    }

    if (statusEl) statusEl.innerHTML = messages.map((m) => escapeHtml(m)).join('<br>') + '<br>内容を確認のうえ「反映する」を押してください。';
  } catch (err) {
    if (statusEl) statusEl.textContent = '読み取りに失敗しました：' + (err && err.message ? err.message : String(err)) + '（手入力をご利用ください）';
  } finally {
    if (worker) await worker.terminate();
  }
}
function openChangeModal(date, level) {
  const record = history.find((r) => r.date === date);
  if (!record) return;
  const currentName = level === 'senior' ? record.seniorName : record.juniorName;
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
        ${ocrSectionHtml}
        <div class="grid-form">
          <label>交代後の氏名
            <select id="change-new-staff"><option value="">選択してください</option>${options}</select>
          </label>
          <label>申請日時（変更届に記載の日時）
            <input type="datetime-local" id="change-applied-at">
          </label>
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
      if (file) runChangeOcr(file, date, candidates);
    });
  }
  document.getElementById('change-confirm').addEventListener('click', () => {
    const newId = document.getElementById('change-new-staff').value;
    const appliedAtRaw = document.getElementById('change-applied-at').value;
    if (!newId || !appliedAtRaw) {
      alert('交代後の氏名と申請日時を入力してください');
      return;
    }
    const newStaff = staffById(newId);
    const appliedAt = appliedAtRaw.replace('T', ' ');
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
    save(KEY_HISTORY, history);
    closeChangeModal();
    renderHistoryTable();
    renderCheckTable();
    showToast('交代を反映しました');
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
  historyStaff: KEY_HISTORY_STAFF,
  monthRules: KEY_MONTH_RULES,
  fiscalEvents: KEY_FISCAL_EVENTS,
  settings: KEY_SETTINGS,
  history: KEY_HISTORY,
  titleLevelMap: KEY_TITLE_LEVEL_MAP,
  leaves: KEY_LEAVES,
  periods: KEY_PERIODS,
  currentPeriodId: KEY_CURRENT_PERIOD,
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
        r.status === 'ok' ? 'OK' : '要確認',
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
function exportRowsToPdf(title, rows, filename) {
  if (!rows.length) {
    alert('出力する内容がありません');
    return;
  }
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.innerHTML = `
    <h2>${escapeHtml(title)}　日直勤務表</h2>
    <table>
      <thead><tr><th>日付</th><th>曜日</th><th>係長級</th><th>変更日時</th><th>主事級</th><th>変更日時</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td>${r.date}</td>
              <td>${WEEKDAY_LABEL[r.weekday]}</td>
              <td>${escapeHtml(r.seniorName || '')}</td>
              <td>${escapeHtml(r.seniorChangedAt || '')}</td>
              <td>${escapeHtml(r.juniorName || '')}</td>
              <td>${escapeHtml(r.juniorChangedAt || '')}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  document.body.appendChild(sheet);

  window.html2canvas(sheet, { scale: 2 }).then((canvas) => {
    document.body.removeChild(sheet);
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;

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
    pdf.save(filename);
  }).catch((err) => {
    if (sheet.parentNode) document.body.removeChild(sheet);
    alert('PDFの生成に失敗しました：' + err.message);
  });
}
function initHistoryPdf() {
  document.getElementById('history-pdf-btn').addEventListener('click', () => {
    exportRowsToPdf('確定済み履歴', history, '日直勤務表_履歴.pdf');
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
  initLeaveXlsxImport();
  initMaternityXlsxImport();
  initPeriodBar();

  renderStaffTable();
  renderMonthRuleTable();
  renderHistoryTable();
  renderCheckTable();

  applyPeriodToGenerateTab();
});
