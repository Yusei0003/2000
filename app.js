'use strict';

/* ============================================================
 * 日直勤務表 自動作成アプリ
 * ルール出典：日直勤務表の作成及び変更についてのマニュアル／追加仕様確認書
 * ============================================================ */

const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];
const LEVEL_LABEL = { senior: '係長級', junior: '主事級' };
const GENDER_LABEL = { M: '男性', F: '女性' };

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
/** 常時除外（外局等の手動登録所属／秘書係／運転手／外部への派遣者／7割措置）に該当するか */
function isStandingExcluded(staff, standingExcludedDepts) {
  if (staff.dispatched) return true;
  if (staff.seventyPercent) return true;
  if (isSecretarySection(staff)) return true;
  if (staff.sideJob && staff.sideJob.includes('運転手')) return true;
  if (Array.isArray(standingExcludedDepts) && staff.dept && standingExcludedDepts.some((d) => d && staff.dept.includes(d))) {
    return true;
  }
  return false;
}
/** 常時除外の理由（表示用）。該当しなければ null */
function standingExcludedReason(staff, standingExcludedDepts) {
  if (staff.dispatched) return '外部への派遣者';
  if (staff.seventyPercent) return '7割措置';
  if (isSecretarySection(staff)) return '秘書係';
  if (staff.sideJob && staff.sideJob.includes('運転手')) return '運転手';
  if (Array.isArray(standingExcludedDepts)) {
    const hit = standingExcludedDepts.find((d) => d && staff.dept && staff.dept.includes(d));
    if (hit) return `常時除外所属（${hit}）`;
  }
  return null;
}

/** 育休等の登録期間内で日直の対象外となる職員か（職員番号で照合）。終了日が未設定の場合は期限なしとして扱う */
function isOnLeave(staff, date, leaves) {
  if (!Array.isArray(leaves) || !staff.number) return false;
  return leaves.some((lv) => {
    if (!lv || String(lv.staffNumber) !== String(staff.number)) return false;
    if (!lv.startDate) return false;
    if (date < parseISO(lv.startDate)) return false;
    if (!lv.endDate) return true; // 終了日未定＝復帰まで対象外
    return date <= parseISO(lv.endDate);
  });
}

/* ------------------------------------------------------------
 * 処理期（年度の前期＝4〜9月／後期＝10〜翌3月）
 * ------------------------------------------------------------ */
/** その日が属する処理期の半期区分を返す（H1=前期 4〜9月／H2=後期 10〜翌3月） */
function fiscalHalfOf(d) {
  const month = d.getMonth() + 1;
  return month >= 4 && month <= 9 ? 'H1' : 'H2';
}
/** 処理期ID（例：2026-H1） */
function periodIdOf(fiscalYear, half) {
  return `${fiscalYear}-${half}`;
}
/** 処理期の対象期間（前期＝4/1〜9/30、後期＝10/1〜翌3/31） */
function periodRange(fiscalYear, half) {
  return half === 'H1'
    ? { startDate: `${fiscalYear}-04-01`, endDate: `${fiscalYear}-09-30` }
    : { startDate: `${fiscalYear}-10-01`, endDate: `${fiscalYear + 1}-03-31` };
}
/** 処理期の表示名（例：2026年度 前期） */
function periodLabelOf(fiscalYear, half) {
  return `${fiscalYear}年度 ${half === 'H1' ? '前期' : '後期'}`;
}
/** ひとつ前の処理期（前期の前は前年度の後期） */
function previousPeriodOf(fiscalYear, half) {
  return half === 'H2'
    ? { fiscalYear, half: 'H1' }
    : { fiscalYear: fiscalYear - 1, half: 'H2' };
}
/** その日が属する処理期 */
function periodOfDate(d) {
  return { fiscalYear: fiscalYearOf(d), half: fiscalHalfOf(d) };
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
  leaves = [], // [{staffNumber, startDate, endDate}] 育休等による除外期間
  periodId = null, // 指定すると、同一処理期内は原則1人1回の割当にする
}) {
  const countMap = new Map();
  const lastDateMap = new Map();
  const specialUse = new Map(); // key -> Set(staffId)
  const pairLastFY = buildPairLastFiscalYear(history);
  const periodUsedIds = new Set(); // 同一処理期内で既に割り当て済みの職員（1人1回ルール用）

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
    if (periodId && h.periodId === periodId) {
      [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => periodUsedIds.add(id));
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

    const eligibleBase = (level, gender) =>
      activeStaff.filter(
        (s) =>
          s.level === level &&
          s.gender === gender &&
          !isOnLeave(s, date, leaves) &&
          ![...excludedDepts].some((dep) => s.dept && s.dept.includes(dep)) &&
          !bannedBySpecial.has(s.id) &&
          passesNewHire(s, date, newHireMonths) &&
          passesGap(s.id, date, minGapDays, lastDateMap)
      );

    const pairOpts = { pairLastFY, currentFY, pairLookbackYears };
    const stages = [
      { avoidSameDept: true, avoidPairRepeat: true, requireQualification: true },
      { avoidSameDept: true, avoidPairRepeat: false, requireQualification: true },
      { avoidSameDept: false, avoidPairRepeat: false, requireQualification: true },
      { avoidSameDept: false, avoidPairRepeat: false, requireQualification: false },
    ];
    /** 指定した性別のみで候補プールを作り、段階的緩和でペアを探す。
     *  同一処理期内はまず「今期まだ割り当てていない職員」だけでペアを探し（1人1回ルール）、
     *  そのレベル・性別の候補が今期割当済みの職員しかいない（枯渇した）場合に限り、今期2回目の割当を許可する。 */
    const tryGender = (gender) => {
      const seniorPool = sortCandidates(eligibleBase('senior', gender), countMap, lastDateMap);
      const juniorPool = sortCandidates(eligibleBase('junior', gender), countMap, lastDateMap);
      const freshSeniorPool = periodId ? seniorPool.filter((s) => !periodUsedIds.has(s.id)) : seniorPool;
      const freshJuniorPool = periodId ? juniorPool.filter((s) => !periodUsedIds.has(s.id)) : juniorPool;

      let pair = null;
      let relaxedStage = 0;
      for (let i = 0; i < stages.length; i++) {
        pair = findPair(freshSeniorPool, freshJuniorPool, { ...stages[i], ...pairOpts });
        if (pair) {
          relaxedStage = i;
          break;
        }
      }
      if (!pair && freshSeniorPool.length && freshJuniorPool.length) {
        pair = { senior: freshSeniorPool[0], junior: freshJuniorPool[0] };
        relaxedStage = 4;
      }

      let repeat = false;
      if (!pair && periodId) {
        // 今期未割当の候補が枯渇しているため、今期2回目の割当を許可する
        for (let i = 0; i < stages.length; i++) {
          pair = findPair(seniorPool, juniorPool, { ...stages[i], ...pairOpts });
          if (pair) {
            relaxedStage = i;
            repeat = true;
            break;
          }
        }
        if (!pair && seniorPool.length && juniorPool.length) {
          pair = { senior: seniorPool[0], junior: juniorPool[0] };
          relaxedStage = 4;
          repeat = true;
        }
      }
      return { seniorPool, juniorPool, pair, relaxedStage, repeat };
    };

    // 枯渇ベース：まず女性のみで探し、女性の候補（係長級・主事級のいずれか）が枯渇していて
    // ペアが組めない場合に限り男性のみで探す。ペアは常に同性。
    let genderUsed = 'F';
    let result = tryGender('F');
    let resultM = null;
    if (!result.pair) {
      resultM = tryGender('M');
      if (resultM.pair) {
        result = resultM;
        genderUsed = 'M';
      }
    }
    const { pair, relaxedStage, repeat } = result;

    const chosenSenior = pair ? pair.senior : null;
    const chosenJunior = pair ? pair.junior : null;

    const reasons = [];
    if (!pair) {
      if (!result.seniorPool.length) reasons.push('女性の係長級候補が枯渇しています');
      if (!result.juniorPool.length) reasons.push('女性の主事級候補が枯渇しています');
      const m = resultM || tryGender('M');
      if (!m.seniorPool.length) reasons.push('男性の係長級候補もいません');
      if (!m.juniorPool.length) reasons.push('男性の主事級候補もいません');
    } else {
      if (repeat) reasons.push('同一処理期内で2回目の割当です');
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
      status: chosenSenior && chosenJunior && relaxedStage === 0 && !repeat ? 'ok' : 'warning',
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
      periodUsedIds.add(chosenSenior.id);
    }
    if (chosenJunior) {
      countMap.set(chosenJunior.id, (countMap.get(chosenJunior.id) || 0) + 1);
      lastDateMap.set(chosenJunior.id, date);
      periodUsedIds.add(chosenJunior.id);
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

/* ------------------------------------------------------------
 * 未割当職員の理由説明
 * ------------------------------------------------------------ */
/**
 * 今回の作成分（dutyDates／results）で staffMember が一度も割り当てられなかった理由を説明する文字列を返す。
 * 完全なシミュレーションではなく、各対象日について「本人の属性で明らかに対象外だったか」を積み上げて説明する。
 */
function explainUnassignedStaff(staffMember, { dutyDates, results, staffList, monthRules, eventExclusions, history, minGapDays, newHireMonths, leaves }) {
  if (!staffMember.gender) {
    return '性別が未設定のため割当対象になりません（職員名簿でご確認ください）。';
  }

  const lastDateMap = new Map();
  (history || []).forEach((h) => {
    [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => {
      const d = parseISO(h.date);
      const prevLast = lastDateMap.get(id);
      if (!prevLast || d > prevLast) lastDateMap.set(id, d);
    });
  });

  let genderSkipped = 0;
  let blockedLeave = 0;
  let blockedNewHire = 0;
  let blockedGap = 0;
  let eligibleButNotChosen = 0;
  const deptLabels = new Set();

  dutyDates.forEach((dd) => {
    const date = parseISO(dd.date);
    const rec = (results || []).find((r) => r.date === dd.date);
    if (rec && rec.seniorId) {
      const seniorStaff = (staffList || []).find((x) => x.id === rec.seniorId);
      if (seniorStaff && seniorStaff.gender && seniorStaff.gender !== staffMember.gender) {
        genderSkipped++;
        return;
      }
    }

    if (isOnLeave(staffMember, date, leaves)) {
      blockedLeave++;
      return;
    }

    const month = date.getMonth() + 1;
    const excludedDepts = new Set();
    (monthRules || []).forEach((r) => {
      if (r.months.includes(month)) r.depts.forEach((dep) => excludedDepts.add(dep));
    });
    (eventExclusions || []).forEach((e) => {
      const start = parseISO(e.date);
      const end = parseISO(e.endDate || e.date);
      if (date >= start && date <= end) e.depts.forEach((dep) => excludedDepts.add(dep));
    });
    const deptHit = [...excludedDepts].find((dep) => staffMember.dept && staffMember.dept.includes(dep));
    if (deptHit) {
      deptLabels.add(deptHit);
      return;
    }

    if (!passesNewHire(staffMember, date, newHireMonths)) {
      blockedNewHire++;
      return;
    }
    if (!passesGap(staffMember.id, date, minGapDays, lastDateMap)) {
      blockedGap++;
      return;
    }
    eligibleButNotChosen++;
  });

  const consideredDays = dutyDates.length - genderSkipped;
  if (consideredDays === 0) {
    const other = staffMember.gender === 'M' ? '女性' : '男性';
    return `対象日はすべて${other}でペアが組めたため、対象になりませんでした（枯渇ベースのルールにより${other}が優先されました）。`;
  }

  const parts = [];
  if (blockedLeave > 0) parts.push(`育休・産休等の除外期間中（${blockedLeave}日）`);
  if (deptLabels.size > 0) parts.push(`所属の除外ルールに該当（${[...deptLabels].join('・')}）`);
  if (blockedNewHire > 0) parts.push(`採用から${newHireMonths}ヶ月未満のため対象外（${blockedNewHire}日）`);
  if (blockedGap > 0) parts.push(`前回勤務日から${minGapDays}日未満のため対象外（${blockedGap}日）`);
  if (eligibleButNotChosen > 0) parts.push(`候補ではあったが、今期の割当枠が他の職員で埋まったため選ばれなかった（1人1回が基本のルールのため・${eligibleButNotChosen}日）`);
  if (genderSkipped > 0) {
    const other = staffMember.gender === 'M' ? '女性' : '男性';
    parts.push(`${other}でペアが組めたため対象外だった日（${genderSkipped}日）`);
  }

  return parts.length ? parts.join('、') + '。' : '理由を特定できませんでした。';
}

/* ------------------------------------------------------------
 * 変更届スクリーンショットのOCR結果解析
 * ------------------------------------------------------------ */
/** OCRテキストから、指定したラベルの右側（同じ行）または次の行の値を取り出す。見つからなければnull */
function extractLabelValue(text, label) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(label);
    if (idx === -1) continue;
    const rest = lines[i].slice(idx + label.length).trim();
    if (rest) return rest;
    if (lines[i + 1]) return lines[i + 1].trim();
  }
  return null;
}
/** 「2026年08月17日（月）14:12」のような文字列から datetime-local 用の値（YYYY-MM-DDTHH:mm）を取り出す */
function parseOcrDateTime(text) {
  if (!text) return null;
  // 時刻のコロンはOCRで読み落とされやすい（例：「14:12」→「1412」）ため、コロンなしにも対応する
  const m = String(text).match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^\d]*?(\d{1,2}):?(\d{2})\b/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${mm}`;
}
/** 「2026年07月05日（日）」のような文字列から日付（YYYY-MM-DD）を取り出す（時刻なし） */
function parseOcrDate(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** レーベンシュタイン距離（編集距離） */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
/** OCRで読み取った氏名の文字列（全角/半角スペース混じり）を、候補職員リストとあいまい一致させる。
 *  一致度が低い場合は null（誤読対策のため、無理にマッチさせない） */
function bestNameMatch(rawName, candidates) {
  if (!rawName) return null;
  const normalize = (s) => String(s || '').replace(/[\s　]+/g, '');
  const target = normalize(rawName);
  if (!target) return null;
  let best = null;
  let bestDist = Infinity;
  candidates.forEach((c) => {
    const name = normalize(c.name);
    if (!name) return;
    const dist = levenshtein(target, name);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  });
  if (!best) return null;
  const threshold = Math.max(1, Math.floor(normalize(best.name).length * 0.34));
  return bestDist <= threshold ? best : null;
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
    isOnLeave,
    fiscalHalfOf,
    periodIdOf,
    periodRange,
    periodLabelOf,
    previousPeriodOf,
    periodOfDate,
    buildPairLastFiscalYear,
    isPairBanned,
    pairKey,
    generateAssignments,
    explainUnassignedStaff,
    WEEKDAY_LABEL,
    GENDER_LABEL,
    LEVEL_LABEL,
    extractLabelValue,
    parseOcrDateTime,
    parseOcrDate,
    levenshtein,
    bestNameMatch,
  };
}
