'use strict';

/* ============================================================
 * 日直勤務表 自動作成アプリ
 * ルール出典：日直勤務表の作成及び変更についてのマニュアル
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
 * 指定日（土日・祝日）自動抽出
 * ------------------------------------------------------------ */
function listDesignatedDates(startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const dow = d.getDay();
    const holidayName = isJapaneseHoliday(d);
    if (dow === 0 || dow === 6 || holidayName) {
      out.push({ date: toISO(d), weekday: dow, holidayName: holidayName || null });
    }
  }
  return out;
}

/* ------------------------------------------------------------
 * 特別期間（年末年始・ゴールデンウィーク）判定
 * ------------------------------------------------------------ */
function detectSpecialPeriod(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) {
    const key = m === 1 ? date.getFullYear() : date.getFullYear() + 1; // 1/1を基準年とする
    return { type: 'newyear', key: `newyear-${key}` };
  }
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
function sortCandidates(list, level, countMap, lastDateMap) {
  return [...list].sort((a, b) => {
    if (level === 'junior') {
      const ca = a.citizenExp ? 0 : 1;
      const cb = b.citizenExp ? 0 : 1;
      if (ca !== cb) return ca - cb;
    }
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

function generateAssignments({
  staffList,
  dutyDates, // [{date, weekday, holidayName}]
  monthRules, // [{months:[..], depts:[..], note}]
  eventExclusions, // [{date, endDate, depts:[..], label}]
  history, // existing confirmed assignments (array)
  minGapDays,
  newHireMonths,
  specialLookback,
}) {
  const countMap = new Map();
  const lastDateMap = new Map();
  const specialUse = new Map(); // key -> Set(staffId)

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

  const activeStaff = staffList.filter((s) => s.active !== false);
  const results = [];
  const sorted = [...dutyDates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  sorted.forEach((dd) => {
    const date = parseISO(dd.date);
    const month = date.getMonth() + 1;
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
          !excludedDepts.has(s.dept) &&
          !bannedBySpecial.has(s.id) &&
          passesNewHire(s, date, newHireMonths) &&
          passesGap(s.id, date, minGapDays, lastDateMap)
      );

    let seniorPool = sortCandidates(eligibleBase('senior'), 'senior', countMap, lastDateMap);
    let juniorPool = sortCandidates(eligibleBase('junior'), 'junior', countMap, lastDateMap);

    let chosenSenior = null;
    let chosenJunior = null;
    let relaxedSameDept = false;

    outer: for (const s of seniorPool.length ? seniorPool : []) {
      for (const j of juniorPool) {
        if (s.dept !== j.dept) {
          chosenSenior = s;
          chosenJunior = j;
          break outer;
        }
      }
    }
    // 同一課しか候補がない場合は緩和して割当（要確認フラグを立てる）
    if (!chosenSenior && seniorPool.length && juniorPool.length) {
      chosenSenior = seniorPool[0];
      chosenJunior = juniorPool[0];
      relaxedSameDept = true;
    }

    const reasons = [];
    if (!seniorPool.length) reasons.push('係長級の候補者がいません');
    if (!juniorPool.length) reasons.push('主事級の候補者がいません');
    if (relaxedSameDept) reasons.push('同一課の組合せになっています（要確認）');

    const record = {
      date: dd.date,
      weekday: dd.weekday,
      holidayName: dd.holidayName,
      seniorId: chosenSenior ? chosenSenior.id : null,
      juniorId: chosenJunior ? chosenJunior.id : null,
      seniorName: chosenSenior ? chosenSenior.name : '',
      juniorName: chosenJunior ? chosenJunior.name : '',
      status: chosenSenior && chosenJunior && !relaxedSameDept ? 'ok' : 'warning',
      reason: reasons.join(' / '),
      specialPeriodKey: special ? special.key : null,
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
    holidayMapOfYear,
    isJapaneseHoliday,
    listDesignatedDates,
    detectSpecialPeriod,
    previousSpecialKeys,
    generateAssignments,
    WEEKDAY_LABEL,
    LEVEL_LABEL,
  };
}
