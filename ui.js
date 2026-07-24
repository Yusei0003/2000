'use strict';

/* ============================================================
 * 画面制御（app.js のロジックを利用してUIを組み立てる）
 * ============================================================ */

const KEY_STAFF = 'duty_staff_v1';
const KEY_MONTH_RULES = 'duty_month_rules_v1';
const KEY_EVENT_EXCL = 'duty_event_exclusions_v1';
const KEY_SETTINGS = 'duty_settings_v1';
const KEY_HISTORY = 'duty_history_v1';

const DEFAULT_SETTINGS = { minGapDays: 120, newHireMonths: 6, specialLookback: 2 };
const DEFAULT_MONTH_RULES = [
  { id: 'default-1', months: [10, 11], depts: ['商工観光課', '広報係'], note: 'イベントが多いため' },
  { id: 'default-2', months: [12, 1], depts: ['ブランド推進係'], note: 'ふるさと納税繁忙期のため' },
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
  showToast._t = setTimeout(() => el.classList.remove('show'), 2000);
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

let staff = load(KEY_STAFF, []);
let monthRules = load(KEY_MONTH_RULES, DEFAULT_MONTH_RULES);
let eventExclusions = load(KEY_EVENT_EXCL, []);
let settings = { ...DEFAULT_SETTINGS, ...load(KEY_SETTINGS, {}) };
let history = load(KEY_HISTORY, []);

let draftDates = []; // 勤務表作成タブの作業中の指定日
let draftResults = []; // 作成された勤務表（未確定）

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
    });
  });
}

/* ------------------------------------------------------------
 * 名簿管理
 * ------------------------------------------------------------ */
function staffById(id) {
  return staff.find((s) => s.id === id);
}
function renderStaffTable() {
  const tbody = document.getElementById('staff-tbody');
  tbody.innerHTML = staff
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.number)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${LEVEL_LABEL[s.level]}</td>
      <td>${escapeHtml(s.dept)}</td>
      <td>${s.citizenExp ? '○' : ''}</td>
      <td>${escapeHtml(s.hireDate || '')}</td>
      <td>${s.active !== false ? '○' : '除外'}</td>
      <td><button class="btn-danger" data-del="${s.id}">削除</button></td>
    </tr>`
    )
    .join('');
  document.getElementById('staff-count').textContent = `${staff.length} 名（係長級 ${staff.filter((s) => s.level === 'senior').length} / 主事級 ${staff.filter((s) => s.level === 'junior').length}）`;
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('この職員を削除しますか？（履歴の表示名は残ります）')) return;
      staff = staff.filter((s) => s.id !== btn.dataset.del);
      save(KEY_STAFF, staff);
      renderStaffTable();
    });
  });
}

function initStaffForm() {
  document.getElementById('staff-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const rec = {
      id: uid('st'),
      number: document.getElementById('st-number').value.trim(),
      name: document.getElementById('st-name').value.trim(),
      level: document.getElementById('st-level').value,
      dept: document.getElementById('st-dept').value.trim(),
      hireDate: document.getElementById('st-hire').value || null,
      citizenExp: document.getElementById('st-citizen').checked,
      active: document.getElementById('st-active').checked,
    };
    if (!rec.name || !rec.dept) return;
    staff.push(rec);
    save(KEY_STAFF, staff);
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
    let count = 0;
    rows.forEach((cols) => {
      const [number, name, levelRaw, dept, citizenRaw, hireDate] = cols;
      if (!name || !dept) return;
      const level = levelRaw && levelRaw.includes('主事') ? 'junior' : 'senior';
      const citizenExp = /true|○|はい/i.test(citizenRaw || '');
      staff.push({
        id: uid('st'),
        number: (number || '').trim(),
        name: name.trim(),
        level,
        dept: dept.trim(),
        citizenExp,
        hireDate: (hireDate || '').trim() || null,
        active: true,
      });
      count++;
    });
    save(KEY_STAFF, staff);
    renderStaffTable();
    document.getElementById('staff-import-text').value = '';
    document.getElementById('staff-import-box').classList.add('hidden');
    showToast(`${count}名を取り込みました`);
  });

  document.getElementById('staff-export-btn').addEventListener('click', () => {
    const rows = [['番号', '氏名', '級', '所属課', '市民課経験', '採用年月日']].concat(
      staff.map((s) => [s.number, s.name, LEVEL_LABEL[s.level], s.dept, s.citizenExp ? 'TRUE' : 'FALSE', s.hireDate || ''])
    );
    downloadCsv('職員名簿.csv', rows);
  });
}

/* ------------------------------------------------------------
 * ルール設定
 * ------------------------------------------------------------ */
function renderOptions() {
  document.getElementById('opt-mingap').value = settings.minGapDays;
  document.getElementById('opt-newhire').value = settings.newHireMonths;
  document.getElementById('opt-lookback').value = settings.specialLookback;
}
function initOptions() {
  renderOptions();
  document.getElementById('opt-save').addEventListener('click', () => {
    settings = {
      minGapDays: Number(document.getElementById('opt-mingap').value) || 0,
      newHireMonths: Number(document.getElementById('opt-newhire').value) || 0,
      specialLookback: Number(document.getElementById('opt-lookback').value) || 0,
    };
    save(KEY_SETTINGS, settings);
    showToast('設定を保存しました');
  });
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

function renderEventTable() {
  const tbody = document.getElementById('event-tbody');
  tbody.innerHTML = eventExclusions
    .map((ev) => {
      const period = ev.endDate && ev.endDate !== ev.date ? `${ev.date} 〜 ${ev.endDate}` : ev.date;
      return `
    <tr>
      <td>${period}</td>
      <td>${ev.depts.map(escapeHtml).join('、')}</td>
      <td>${escapeHtml(ev.label || '')}</td>
      <td><button class="btn-danger" data-del="${ev.id}">削除</button></td>
    </tr>`;
    })
    .join('');
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      eventExclusions = eventExclusions.filter((ev) => ev.id !== btn.dataset.del);
      save(KEY_EVENT_EXCL, eventExclusions);
      renderEventTable();
    });
  });
}
function initEventForm() {
  document.getElementById('event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = document.getElementById('ev-start').value;
    const end = document.getElementById('ev-end').value || start;
    const depts = document
      .getElementById('ev-depts')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!start || !depts.length) return;
    eventExclusions.push({ id: uid('ev'), date: start, endDate: end, depts, label: document.getElementById('ev-label').value.trim() });
    save(KEY_EVENT_EXCL, eventExclusions);
    renderEventTable();
    e.target.reset();
  });
}

/* ------------------------------------------------------------
 * 勤務表作成
 * ------------------------------------------------------------ */
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
    : '';
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
    draftDates = listDesignatedDates(start, end)
      .filter((d) => !already.has(d.date))
      .map((d) => ({ ...d, include: true }));
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
      <td>${renderStaffSelect(i, 'senior', r.seniorId)}</td>
      <td>${renderStaffSelect(i, 'junior', r.juniorId)}</td>
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
      if (draftResults[idx].seniorId && draftResults[idx].juniorId) {
        draftResults[idx].status = 'ok';
        draftResults[idx].reason = '（手動で修正済み）';
      }
      renderGenResultTable();
    });
  });

  const warnCount = draftResults.filter((r) => r.status === 'warning').length;
  document.getElementById('gen-warning-summary').innerHTML = draftResults.length
    ? `<p class="hint">合計 ${draftResults.length} 日 / 要確認 ${warnCount} 日</p>`
    : '';
  document.getElementById('gen-confirm').disabled = draftResults.length === 0;
  document.getElementById('gen-export').disabled = draftResults.length === 0;
}
function renderStaffSelect(idx, level, currentId) {
  const options = staff
    .filter((s) => s.level === level && s.active !== false)
    .map((s) => `<option value="${s.id}" ${s.id === currentId ? 'selected' : ''}>${escapeHtml(s.name)}（${escapeHtml(s.dept)}）</option>`)
    .join('');
  return `<select class="result-select" data-idx="${idx}" data-level="${level}"><option value="">未定</option>${options}</select>`;
}

function initGenerateRun() {
  document.getElementById('gen-run').addEventListener('click', () => {
    const targetDates = draftDates.filter((d) => d.include !== false);
    if (!targetDates.length) {
      alert('対象の指定日がありません。まず「土日・祝日を自動抽出」を実行してください。');
      return;
    }
    draftResults = generateAssignments({
      staffList: staff,
      dutyDates: targetDates,
      monthRules,
      eventExclusions,
      history,
      minGapDays: settings.minGapDays,
      newHireMonths: settings.newHireMonths,
      specialLookback: settings.specialLookback,
    });
    renderGenResultTable();
    showToast('勤務表を作成しました');
  });

  document.getElementById('gen-confirm').addEventListener('click', () => {
    if (!draftResults.length) return;
    const label = document.getElementById('gen-label').value.trim() || '未設定期間';
    const withLabel = draftResults.map((r) => ({ ...r, periodLabel: label, confirmedAt: new Date().toISOString() }));
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
}

/* ------------------------------------------------------------
 * 履歴・確認
 * ------------------------------------------------------------ */
function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = history
    .map(
      (r) => `
    <tr class="${r.status === 'warning' ? 'row-warning' : ''}">
      <td>${escapeHtml(r.periodLabel || '')}</td>
      <td>${r.date}</td>
      <td>${WEEKDAY_LABEL[r.weekday]}</td>
      <td>${escapeHtml(r.seniorName)}</td>
      <td>${escapeHtml(r.juniorName)}</td>
      <td>${r.status === 'ok' ? 'OK' : '要確認'}</td>
      <td><button class="btn-danger" data-del="${r.date}-${r.seniorId}-${r.juniorId}" data-date="${r.date}">削除</button></td>
    </tr>`
    )
    .join('');
  document.getElementById('history-count').textContent = `${history.length} 件`;
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
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'history-export-btn') {
    const rows = [['期間', '日付', '曜日', '係長級', '主事級', '状態']].concat(
      history.map((r) => [r.periodLabel || '', r.date, WEEKDAY_LABEL[r.weekday], r.seniorName, r.juniorName, r.status === 'ok' ? 'OK' : '要確認'])
    );
    downloadCsv('日直勤務表_履歴.csv', rows);
  }
});

function renderCheckTable() {
  const tbody = document.getElementById('check-tbody');
  const countMap = new Map();
  const lastMap = new Map();
  history.forEach((r) => {
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
  const rows = staff
    .filter((s) => s.active !== false)
    .map((s) => ({ s, count: countMap.get(s.id) || 0, last: lastMap.get(s.id) || '' }))
    .sort((a, b) => a.count - b.count);
  tbody.innerHTML = rows
    .map(
      ({ s, count, last }) => `
    <tr class="${count === 0 ? 'row-warning' : ''}">
      <td>${escapeHtml(s.name)}</td>
      <td>${LEVEL_LABEL[s.level]}</td>
      <td>${escapeHtml(s.dept)}</td>
      <td>${count}</td>
      <td>${last || '（担当履歴なし）'}</td>
    </tr>`
    )
    .join('');
}

/* ------------------------------------------------------------
 * 初期化
 * ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initStaffForm();
  initOptions();
  initMonthRuleForm();
  initEventForm();
  initGenerateDates();
  initGenerateRun();

  renderStaffTable();
  renderMonthRuleTable();
  renderEventTable();
  renderHistoryTable();
  renderCheckTable();

  const today = new Date();
  document.getElementById('gen-start').value = toISO(today);
  document.getElementById('gen-end').value = toISO(addMonths(today, 6));
});
