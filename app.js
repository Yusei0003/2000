'use strict';

/* ============================================================
 * 日直勤務表 自動作成アプリ
 * ルール出典：日直勤務表の作成及び変更についてのマニュアル／追加仕様確認書
 * ============================================================ */

const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];
const LEVEL_LABEL = { senior: '係長級', junior: '主事級' };

/* ------------------------------------------------------------
 * 日付ユーティリティ
 * ------------------------------------------------------------ */
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function diffDays(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / MS);
}
function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}
/** 年度（4月始まり）。3月は前年の年度に属する。 */
function fiscalYearOf(d) {
  const m = d.getMonth() + 1;
  return m >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

/* ------------------------------------------------------------
 * 日本の祝日計算（春分・秋分は近似式。ハッピーマンデー・振替休日・
 * 国民の休日を反映。1980〜2099年の範囲で使用可能）
 * ------------------------------------------------------------ */
function shunbunDay(y) {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}
function shubunDay(y) {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}
function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const firstWeekday = first.getDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, month - 1, day);
}
function baseHolidaysOfYear(year) {
  const list = [];
  const add = (date, name) => list.push({ date, name });
  add(new Date(year, 0, 1), '元日');
  add(nthWeekdayOfMonth(year, 1, 1, 2), '成人の日');
  add(new Date(year, 1, 11), '建国記念の日');
  add(new Date(year, 1, 23), '天皇誕生日');
  add(new Date(year, 2, shunbunDay(year)), '春分の日');
  add(new Date(year, 3, 29), '昭和の日');
  add(new Date(year, 4, 3), '憲法記念日');
  add(new Date(year, 4, 4), 'みどりの日');
  add(new Date(year, 4, 5), 'こどもの日');
  add(nthWeekdayOfMonth(year, 7, 1, 3), '海の日');
  add(new Date(year, 7, 11), '山の日');
  add(nthWeekdayOfMonth(year, 9, 1, 3), '敬老の日');
  add(new Date(year, 8, shubunDay(year)), '秋分の日');
  add(nthWeekdayOfMonth(year, 10, 1, 2), 'スポーツの日');
  add(new Date(year, 10, 3), '文化の日');
  add(new Date(year, 10, 23), '勤労感謝の日');
  return list;
}
const holidayCache = new Map();
function holidayMapOfYear(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const base = baseHolidaysOfYear(year - 1)
    .concat(baseHolidaysOfYear(year))
    .concat(baseHolidaysOfYear(year + 1));
  const map = new Map();
  base.forEach(({ date, name }) => map.set(toISO(date), name));

  // 振替休日：祝日が日曜のとき、直後の「祝日でない日」を休日にする
  const addedSubs = [];
  base.forEach(({ date }) => {
    if (date.getDay() === 0) {
      let cur = addDays(date, 1);
      while (map.has(toISO(cur))) cur = addDays(cur, 1);
      addedSubs.push({ iso: toISO(cur), name: '振替休日' });
    }
  });
  addedSubs.forEach(({ iso, name }) => {
    if (!map.has(iso)) map.set(iso, name);
  });

  // 国民の休日：前後を祝日に挟まれた平日（日曜以外）
  base.forEach(({ date }) => {
    const mid = addDays(date, 1);
    const midIso = toISO(mid);
    const nextIso = toISO(addDays(date, 2));
    if (!map.has(midIso) && mid.getDay() !== 0 && map.has(nextIso)) {
      map.set(midIso, '国民の休日');
    }
  });

  holidayCache.set(year, map);
  return map;
}
function isJapaneseHoliday(date) {
  const map = holidayMapOfYear(date.getFullYear());
  return map.get(toISO(date)) || null;
}

/* ------------------------------------------------------------
 * 年末年始の閉庁日判定（12/28〜1/3。曜日を問わず閉庁）
 * ------------------------------------------------------------ */
function isYearEndClosure(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return (m === 12 && d >= 28) || (m === 1 && d <= 3);
}

/* ------------------------------------------------------------
 * 指定日（土日・祝日・年末年始閉庁日）自動抽出
 * ------------------------------------------------------------ */
function listDesignatedDates(startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const dow = d.getDay();
    const holidayName = isJapaneseHoliday(d);
    const yearEnd = isYearEndClosure(d);
    if (dow === 0 || dow === 6 || holidayName || yearEnd) {
      out.push({
        date: toISO(d),
        weekday: dow,
        holidayName: holidayName || (yearEnd ? '年末年始閉庁' : null),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------
 * 特別期間（年末年始・ゴールデンウィーク）判定
 * ------------------------------------------------------------ */
function detectSpecialPeriod(date) {
  if (isYearEndClosure(date)) {
    const m = date.getMonth() + 1;
    const key = m === 1 ? date.getFullYear() : date.getFullYear() + 1; // 1/1を基準年とする
    return { type: 'newyear', key: `newyear-${key}` };
  }
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 4 && d >= 29) return { type: 'gw', key: `gw-${date.getFullYear()}` };
  if (m === 5 && d <= 5) return { type: 'gw', key: `gw-${date.getFullYear()}` };
  return null;
}
function previousSpecialKeys(key, count) {
  const [type, yearStr] = key.split('-');
  const year = Number(yearStr);
  const out = [];
  for (let i = 1; i <= count; i++) out.push(`${type}-${year - i}`);
  return out;
}

/* ------------------------------------------------------------
 * 資格要件・市民課経験・常時除外の判定
 * ------------------------------------------------------------ */
/** 市民課経験（手動指定 または 所属履歴・現所属からの自動判定）の有無 */
function effectiveCitizenExp(staff) {
  if (staff.citizenExp) return true;
  if (staff.dept && staff.dept.includes('市民課')) return true;
  if (Array.isArray(staff.deptHistory) && staff.deptHistory.some((d) => d && d.includes('市民課'))) return true;
  return false;
}
/** 資格要件（係長級 または 市民課経験者）を満たすか */
function isQualified(staff) {
  if (staff.level === 'senior') return true;
  return effectiveCitizenExp(staff);
}
function isSecretarySection(staff) {
  return (staff.section && staff.section.includes('秘書係')) || (staff.dept && staff.dept.includes('秘書係'));
}
/** 常時除外（外局等の手動登録所属／秘書係／運転手）に該当するか */
function isStandingExcluded(staff, standingExcludedDepts) {
  if (isSecretarySection(staff)) return true;
  if (staff.sideJob && staff.sideJob.includes('運転手')) return true;
  if (Array.isArray(standingExcludedDepts) && staff.dept && standingExcludedDepts.some((d) => d && staff.dept.includes(d))) {
    return true;
  }
  return false;
}
/** 常時除外の理由（表示用）。該当しなければ null */
function standingExcludedReason(staff, standingExcludedDepts) {
  if (isSecretarySection(staff)) return '秘書係';
  if (staff.sideJob && staff.sideJob.includes('運転手')) return '運転手';
  if (Array.isArray(standingExcludedDepts)) {
    const hit = standingExcludedDepts.find((d) => d && staff.dept && staff.dept.includes(d));
    if (hit) return `常時除外所属（${hit}）`;
  }
  return null;
}

/* ------------------------------------------------------------
 * 割当アルゴリズム
 * ------------------------------------------------------------ */
function passesNewHire(staff, date, newHireMonths) {
  if (!staff.hireDate) return true;
  const hire = parseISO(staff.hireDate);
  const limit = addMonths(hire, newHireMonths);
  return date >= limit;
}
function passesGap(staffId, date, minGapDays, lastDateMap) {
  const last = lastDateMap.get(staffId);
  if (!last) return true;
  return diffDays(last, date) >= minGapDays;
}
function sortCandidates(list, countMap, lastDateMap) {
  return [...list].sort((a, b) => {
    const qa = isQualified(a) ? 0 : 1;
    const qb = isQualified(b) ? 0 : 1;
    if (qa !== qb) return qa - qb;
    const countDiff = (countMap.get(a.id) || 0) - (countMap.get(b.id) || 0);
    if (countDiff !== 0) return countDiff;
    const la = lastDateMap.get(a.id);
    const lb = lastDateMap.get(b.id);
    if (!la && lb) return -1;
    if (la && !lb) return 1;
    if (la && lb) return la - lb;
    return 0;
  });
}
/** ペアキー（係長級id + 主事級id） */
function pairKey(seniorId, juniorId) {
  return seniorId + '|' + juniorId;
}
/** 直近2年度以内（既定）に組んだペアかどうかを判定するための「最終年度」マップを構築 */
function buildPairLastFiscalYear(history) {
  const map = new Map();
  history.forEach((h) => {
    if (h.manuallyEdited) return; // 手動変更（変更届反映）による組合せは判定対象外
    if (!h.seniorId || !h.juniorId) return;
    const fy = fiscalYearOf(parseISO(h.date));
    const key = pairKey(h.seniorId, h.juniorId);
    const cur = map.get(key);
    if (cur === undefined || fy > cur) map.set(key, fy);
  });
  return map;
}
function isPairBanned(seniorId, juniorId, pairLastFY, currentFY, pairLookbackYears) {
  const lastFY = pairLastFY.get(pairKey(seniorId, juniorId));
  if (lastFY === undefined) return false;
  return currentFY - lastFY < pairLookbackYears;
}
/** 制約段階を指定して、条件を満たす最初のペアを探す */
function findPair(seniorPool, juniorPool, opts) {
  for (const s of seniorPool) {
    for (const j of juniorPool) {
      if (opts.avoidSameDept && s.dept && j.dept && s.dept === j.dept) continue;
      if (opts.avoidPairRepeat && isPairBanned(s.id, j.id, opts.pairLastFY, opts.currentFY, opts.pairLookbackYears)) continue;
      if (opts.requireQualification && !isQualified(s) && !isQualified(j)) continue;
      return { senior: s, junior: j };
    }
  }
  return null;
}

function generateAssignments({
  staffList,
  dutyDates, // [{date, weekday, holidayName}]
  monthRules, // [{months:[..], depts:[..], note}]
  eventExclusions, // [{date, endDate, depts:[..], label}] （行事のリードタイムを反映済みの除外開始日で渡す）
  history, // 既存の確定済み履歴
  minGapDays,
  newHireMonths,
  specialLookback,
  pairLookbackYears = 2,
  standingExcludedDepts = [],
}) {
  const countMap = new Map();
  const lastDateMap = new Map();
  const specialUse = new Map(); // key -> Set(staffId)
  const pairLastFY = buildPairLastFiscalYear(history);

  history.forEach((h) => {
    [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => {
      countMap.set(id, (countMap.get(id) || 0) + 1);
      const d = parseISO(h.date);
      const prevLast = lastDateMap.get(id);
      if (!prevLast || d > prevLast) lastDateMap.set(id, d);
    });
    if (h.specialPeriodKey) {
      if (!specialUse.has(h.specialPeriodKey)) specialUse.set(h.specialPeriodKey, new Set());
      [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => specialUse.get(h.specialPeriodKey).add(id));
    }
  });

  const standingExcludedIds = new Set(
    staffList.filter((s) => isStandingExcluded(s, standingExcludedDepts)).map((s) => s.id)
  );
  const activeStaff = staffList.filter((s) => s.active !== false && !standingExcludedIds.has(s.id));
  const results = [];
  const sorted = [...dutyDates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  sorted.forEach((dd) => {
    const date = parseISO(dd.date);
    const month = date.getMonth() + 1;
    const currentFY = fiscalYearOf(date);
    const excludedDepts = new Set();
    monthRules.forEach((r) => {
      if (r.months.includes(month)) r.depts.forEach((dep) => excludedDepts.add(dep));
    });
    eventExclusions.forEach((e) => {
      const start = parseISO(e.date);
      const end = parseISO(e.endDate || e.date);
      if (date >= start && date <= end) e.depts.forEach((dep) => excludedDepts.add(dep));
    });

    const special = detectSpecialPeriod(date);
    let bannedBySpecial = new Set();
    if (special) {
      previousSpecialKeys(special.key, specialLookback).forEach((k) => {
        const set = specialUse.get(k);
        if (set) set.forEach((id) => bannedBySpecial.add(id));
      });
    }

    const eligibleBase = (level) =>
      activeStaff.filter(
        (s) =>
          s.level === level &&
          ![...excludedDepts].some((dep) => s.dept && s.dept.includes(dep)) &&
          !bannedBySpecial.has(s.id) &&
          passesNewHire(s, date, newHireMonths) &&
          passesGap(s.id, date, minGapDays, lastDateMap)
      );

    const seniorPool = sortCandidates(eligibleBase('senior'), countMap, lastDateMap);
    const juniorPool = sortCandidates(eligibleBase('junior'), countMap, lastDateMap);

    const pairOpts = { pairLastFY, currentFY, pairLookbackYears };
    let pair = null;
    let relaxedStage = 0;
    const stages = [
      { avoidSameDept: true, avoidPairRepeat: true, requireQualification: true },
      { avoidSameDept: true, avoidPairRepeat: false, requireQualification: true },
      { avoidSameDept: false, avoidPairRepeat: false, requireQualification: true },
      { avoidSameDept: false, avoidPairRepeat: false, requireQualification: false },
    ];
    for (let i = 0; i < stages.length; i++) {
      pair = findPair(seniorPool, juniorPool, { ...stages[i], ...pairOpts });
      if (pair) {
        relaxedStage = i;
        break;
      }
    }
    if (!pair && seniorPool.length && juniorPool.length) {
      pair = { senior: seniorPool[0], junior: juniorPool[0] };
      relaxedStage = 4;
    }

    const chosenSenior = pair ? pair.senior : null;
    const chosenJunior = pair ? pair.junior : null;

    const reasons = [];
    if (!seniorPool.length) reasons.push('係長級の候補者がいません');
    if (!juniorPool.length) reasons.push('主事級の候補者がいません');
    if (chosenSenior && chosenJunior) {
      if (relaxedStage >= 3) reasons.push('資格要件（係長級・市民課経験者）を満たす職員がいません');
      if (relaxedStage >= 2) reasons.push('同一課の組合せになっています');
      if (relaxedStage >= 1) reasons.push('過去のペアと重複しています');
    }

    const record = {
      date: dd.date,
      weekday: dd.weekday,
      holidayName: dd.holidayName,
      seniorId: chosenSenior ? chosenSenior.id : null,
      juniorId: chosenJunior ? chosenJunior.id : null,
      seniorName: chosenSenior ? chosenSenior.name : '',
      juniorName: chosenJunior ? chosenJunior.name : '',
      status: chosenSenior && chosenJunior && relaxedStage === 0 ? 'ok' : 'warning',
      reason: reasons.join(' / '),
      specialPeriodKey: special ? special.key : null,
      manuallyEdited: false,
      seniorChangedAt: null,
      juniorChangedAt: null,
    };
    results.push(record);

    if (chosenSenior) {
      countMap.set(chosenSenior.id, (countMap.get(chosenSenior.id) || 0) + 1);
      lastDateMap.set(chosenSenior.id, date);
    }
    if (chosenJunior) {
      countMap.set(chosenJunior.id, (countMap.get(chosenJunior.id) || 0) + 1);
      lastDateMap.set(chosenJunior.id, date);
    }
    if (chosenSenior && chosenJunior) {
      pairLastFY.set(pairKey(chosenSenior.id, chosenJunior.id), currentFY);
    }
    if (special && (chosenSenior || chosenJunior)) {
      if (!specialUse.has(special.key)) specialUse.set(special.key, new Set());
      if (chosenSenior) specialUse.get(special.key).add(chosenSenior.id);
      if (chosenJunior) specialUse.get(special.key).add(chosenJunior.id);
    }
  });

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toISO,
    parseISO,
    addDays,
    diffDays,
    addMonths,
    fiscalYearOf,
    holidayMapOfYear,
    isJapaneseHoliday,
    isYearEndClosure,
    listDesignatedDates,
    detectSpecialPeriod,
    previousSpecialKeys,
    effectiveCitizenExp,
    isQualified,
    isStandingExcluded,
    standingExcludedReason,
    buildPairLastFiscalYear,
    isPairBanned,
    pairKey,
    generateAssignments,
    WEEKDAY_LABEL,
    LEVEL_LABEL,
  };
}
