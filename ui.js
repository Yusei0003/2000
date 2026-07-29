'use strict';

/* ============================================================
 * 画面制御（app.js のロジックを利用してUIを組み立てる）
 * ============================================================ */

const KEY_STAFF = 'duty_staff_v1';
const KEY_MONTH_RULES = 'duty_month_rules_v1';
const KEY_EVENT_EXCL = 'duty_event_exclusions_v1';
const KEY_SETTINGS = 'duty_settings_v1';
const KEY_HISTORY = 'duty_history_v1';
const KEY_TITLE_LEVEL_MAP = 'duty_title_level_map_v1';

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
let titleLevelMap = load(KEY_TITLE_LEVEL_MAP, {});

let draftDates = []; // 勤務表作成タブの作業中の指定日
let draftResults = []; // 作成された勤務表（未確定）
let staffXlsxRows = null; // Excel名簿取込：解析結果の一時保持
let historyXlsxRows = null; // Excel勤務実績取込：解析結果の一時保持

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
 * Excel（人事システム等の実データ）取込 共通ユーティリティ
 * ------------------------------------------------------------ */
function normalizeHeader(h) {
  return String(h ?? '').replace(/\s+/g, '').trim();
}
function excelValueToISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return toISO(v);
  if (typeof v === 'number') {
    // Excelのシリアル値（1900年日付システム）からの変換（保険用フォールバック）
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
 * Excel名簿データの取込（番号・氏名・職名・所属名・係名・採用日等の列を持つ出力形式）
 * ------------------------------------------------------------ */
function suggestLevelForTitle(title) {
  const t = String(title || '');
  if (/部長|次長|課長|参事|所長|園長|館長|局長|理事|副市長|市長|教育長/.test(t)) return 'exclude';
  if (/係長|主幹|補佐|専門員/.test(t)) return 'senior';
  if (/主事|主任|技師|技手|保健師|看護師|保育士|栄養士|用務員|技能員/.test(t)) return 'junior';
  return 'exclude';
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
    const idxDept = col('所属名');
    const idxSection = col('係名');
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
        dept: idxDept >= 0 ? String(r[idxDept] || '').trim() : '',
        section: idxSection >= 0 ? String(r[idxSection] || '').trim() : '',
        hireDate: idxHire >= 0 ? excelValueToISO(r[idxHire]) : null,
        retireDate: idxRetire >= 0 ? excelValueToISO(r[idxRetire]) : null,
        activeFlag: idxActive >= 0 ? r[idxActive] : null,
      }));
  }
  return null;
}
function renderStaffXlsxMapping() {
  const tbody = document.getElementById('staff-xlsx-mapping-tbody');
  const titleCounts = new Map();
  staffXlsxRows.forEach((r) => {
    const key = r.title || '（職名なし）';
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });
  const titles = [...titleCounts.keys()].sort();
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
  document.getElementById('staff-xlsx-confirm').disabled = false;
}
function initStaffXlsxImport() {
  document.getElementById('staff-xlsx-btn').addEventListener('click', () => {
    document.getElementById('staff-xlsx-box').classList.toggle('hidden');
  });
  document.getElementById('staff-xlsx-cancel').addEventListener('click', () => {
    document.getElementById('staff-xlsx-box').classList.add('hidden');
    document.getElementById('staff-xlsx-input').value = '';
    document.getElementById('staff-xlsx-mapping-tbody').innerHTML = '';
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
      document.getElementById('staff-xlsx-summary').textContent = `${rows.length} 件のデータを検出しました。職名ごとの取り込み方法を確認してください。`;
      renderStaffXlsxMapping();
    });
  });
  document.getElementById('staff-xlsx-confirm').addEventListener('click', () => {
    if (!staffXlsxRows) return;
    document.querySelectorAll('.title-level-select').forEach((sel) => {
      titleLevelMap[sel.dataset.title] = sel.value;
    });
    save(KEY_TITLE_LEVEL_MAP, titleLevelMap);

    const byNumber = new Map(staff.map((s) => [String(s.number), s]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    staffXlsxRows.forEach((r) => {
      const titleKey = r.title || '（職名なし）';
      const level = titleLevelMap[titleKey] || suggestLevelForTitle(r.title);
      const retired = !!r.retireDate || r.activeFlag === 0 || r.activeFlag === '0';
      if (level === 'exclude' || retired) {
        skipped++;
        return;
      }
      const dept = [r.dept, r.section].filter(Boolean).join(' ');
      const existing = byNumber.get(r.number);
      if (existing) {
        existing.name = r.name;
        existing.level = level;
        existing.dept = dept;
        existing.hireDate = r.hireDate || existing.hireDate;
        existing.active = true;
        updated++;
      } else {
        const rec = {
          id: uid('st'),
          number: r.number,
          name: r.name,
          level,
          dept,
          citizenExp: false,
          hireDate: r.hireDate,
          active: true,
        };
        staff.push(rec);
        byNumber.set(r.number, rec);
        added++;
      }
    });
    save(KEY_STAFF, staff);
    renderStaffTable();
    document.getElementById('staff-xlsx-box').classList.add('hidden');
    document.getElementById('staff-xlsx-input').value = '';
    document.getElementById('staff-xlsx-mapping-tbody').innerHTML = '';
    document.getElementById('staff-xlsx-summary').textContent = '';
    document.getElementById('staff-xlsx-confirm').disabled = true;
    staffXlsxRows = null;
    showToast(`名簿を取り込みました（新規${added}件・更新${updated}件・対象外${skipped}件）`);
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

function staffDutyDates(staffId) {
  return history
    .filter((r) => r.seniorId === staffId || r.juniorId === staffId)
    .map((r) => ({ date: r.date, role: r.seniorId === staffId ? 'senior' : 'junior' }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
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
    .map((s) => ({ s, count: countMap.get(s.id) || 0, last: lastMap.get(s.id) || '' }))
    .sort((a, b) => a.count - b.count);
  tbody.innerHTML = rows
    .map(
      ({ s, count, last }) => `
    <tr class="${count === 0 ? 'row-warning' : ''}">
      <td>${escapeHtml(s.number)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${LEVEL_LABEL[s.level]}</td>
      <td>${escapeHtml(s.dept)}</td>
      <td>${s.active !== false ? '○' : '対象外'}</td>
      <td>${count}</td>
      <td>${last || '（担当履歴なし）'}</td>
      <td><button class="btn-secondary check-detail-btn" data-id="${s.id}">履歴を見る</button></td>
    </tr>
    <tr class="check-detail-row hidden" data-detail-for="${s.id}">
      <td colspan="8"></td>
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
          juniorNumber: r[numberCols[1]] !== null && r[numberCols[1]] !== undefined ? String(r[numberCols[1]]).trim() : null,
          juniorName: r[nameCols[1]] ? String(r[nameCols[1]]).trim() : '',
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
    const byNumber = new Map(staff.map((s) => [String(s.number), s]));
    let stubsCreated = 0;
    const resolveStaff = (number, name, level) => {
      if (!number) return null;
      if (byNumber.has(number)) return byNumber.get(number);
      const stub = { id: uid('st'), number, name: name || '（不明）', level, dept: '', citizenExp: false, hireDate: null, active: false };
      staff.push(stub);
      byNumber.set(number, stub);
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
        status: 'ok',
        reason: '',
        specialPeriodKey: special ? special.key : null,
        periodLabel: '取込データ',
      });
      imported++;
    });
    history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    save(KEY_STAFF, staff);
    save(KEY_HISTORY, history);
    renderStaffTable();
    renderHistoryTable();
    renderCheckTable();
    historyXlsxRows = null;
    document.getElementById('history-xlsx-input').value = '';
    document.getElementById('history-xlsx-summary').textContent = '';
    document.getElementById('history-xlsx-actions').classList.add('hidden');
    showToast(`勤務実績を取り込みました（${imported}件 / 名簿にない職員${stubsCreated}名を追加）`);
  });
}

/* ------------------------------------------------------------
 * 初期化
 * ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initStaffForm();
  initStaffXlsxImport();
  initHistoryXlsxImport();
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
