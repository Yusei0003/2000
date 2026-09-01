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
 * 年末年始の閉庁日判定（12/29〜1/3。曜日を問わず閉庁）
 * ------------------------------------------------------------ */
function isYearEndClosure(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return (m === 12 && d >= 29) || (m === 1 && d <= 3);
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

/** 育休等の登録期間内で日直の対象外となる職員か（職員番号で照合）。終了日が未設定の場合は期限なしとして扱う。
 *  産休（kind==='maternity'）は、終了後に必ず育休へ入るとみなし、その職員の育休記録
 *  （kind==='childcare'）が別途登録されていない限り、産休の終了日を過ぎても対象外のまま
 *  扱う（育休情報が未登録でも産休終了後は割り当てない）。育休記録が登録されていれば、
 *  その記録自体が産休終了後の対象外期間を判定する。 */
function isOnLeave(staff, date, leaves) {
  if (!Array.isArray(leaves) || !staff.number) return false;
  return leaves.some((lv) => {
    if (!lv || String(lv.staffNumber) !== String(staff.number)) return false;
    if (!lv.startDate) return false;
    if (date < parseISO(lv.startDate)) return false;
    if (!lv.endDate) return true; // 終了日未定＝復帰まで対象外
    if (date <= parseISO(lv.endDate)) return true;
    if (lv.kind === 'maternity') {
      const hasChildcareRecord = leaves.some(
        (o) => o && o.kind === 'childcare' && String(o.staffNumber) === String(staff.number)
      );
      if (!hasChildcareRecord) return true; // 産休終了後、育休の登録が無くても対象外を継続
    }
    return false;
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
/** 退職予定日の retireLeadMonths ヶ月前まで（既定1ヶ月）を対象とする。育休・産休と同様、
 *  人数不足時の最終手段でも緩和しない絶対条件（退職後に当番はあり得ないため）。 */
function passesRetire(staff, date, retireLeadMonths) {
  if (!staff.retireDate) return true;
  const retire = parseISO(staff.retireDate);
  const limit = addMonths(retire, -retireLeadMonths);
  return date <= limit;
}
function passesGap(staffId, date, minGapDays, lastDateMap) {
  const last = lastDateMap.get(staffId);
  if (!last) return true;
  return diffDays(last, date) >= minGapDays;
}
/** ランクが不明な職員（個別登録した職員等）を「下位の職員」として扱うための代用値。
 *  実在のランク（市長10〜主事補800）より確実に大きい値にし、優先的に割り当てて
 *  構わない（＝偉い人として保護しない）扱いにする。 */
/** 「今期未割当の職員に1回目を回すために、既に割当済みの職員へ2回目以降を担ってもらう」
 *  仕組み（tryFreshTier の freshMode='partial'）で、1人が同一処理期内に担当してよい上限回数。
 *  この上限が無いと、係長級が極端に少ない性別で少数の職員だけが際限なく担当し続けることになる
 *  （1つの処理期で十数回など、実務上あり得ない負担になる）。
 *  なお、係長級が尽きた場合はまず市民課経験者を1人目に立てて（第3・第4段階）
 *  「2名とも今期未割当」のペアを作るため、この上限に頼る場面自体が少ない。 */
const PARTIAL_FRESH_MAX_DUTIES = 3;
const UNKNOWN_RANK_FALLBACK = 100000;
/** 年齢が不明な職員（個別登録した職員等）を「若手」として扱うための代用値。
 *  実在する年齢より確実に小さい値にし、優先的に割り当てて構わない扱いにする。 */
const UNKNOWN_AGE_FALLBACK = -1;
/** 担当回数の少なさ→ランクの大きさ（下位の職員から）→残り出番機会の少なさ→年齢の若さ→
 *  前回勤務日の古さ、の順で並べる（未割当を最優先）。
 *  ランクは、同じ担当回数の職員が複数いる場合のタイブレークとして働く。ランクが大きい
 *  （＝下位の）職員を優先的に割り当てることで、階級の高い職員が結果的に余りやすくなる。
 *  残り出番機会は、課除外ルールや行事の除外期間の関係で割当可能な日が少ない職員（＝出番の
 *  窓が狭い職員）を、その窓のうちに優先的に割り当てるためのもの（remainingOpportunityMap
 *  参照）。年齢より前で判定する（年齢は生年月日が同じ職員がほぼいないため、年齢を先に
 *  比較すると年齢差だけでほぼ毎回決着してしまい、残り出番機会が実質的に一切参照されず、
 *  出番の窓が狭い職員が割当機会をすり抜けたまま処理期を終えてしまうことを防ぐため）。 */
function sortByCountAndRecency(list, countMap, lastDateMap, remainingMap) {
  return [...list].sort((a, b) => {
    const countDiff = (countMap.get(a.id) || 0) - (countMap.get(b.id) || 0);
    if (countDiff !== 0) return countDiff;
    const rankA = a.rank != null ? a.rank : UNKNOWN_RANK_FALLBACK;
    const rankB = b.rank != null ? b.rank : UNKNOWN_RANK_FALLBACK;
    const rankDiff = rankB - rankA; // ランクが大きい（下位の）方を優先
    if (rankDiff !== 0) return rankDiff;
    if (remainingMap) {
      const remA = remainingMap.get(a.id);
      const remB = remainingMap.get(b.id);
      if (remA != null && remB != null) {
        const remDiff = remA - remB; // 残り出番機会が少ない方を優先
        if (remDiff !== 0) return remDiff;
      }
    }
    const ageA = a.age != null ? a.age : UNKNOWN_AGE_FALLBACK;
    const ageB = b.age != null ? b.age : UNKNOWN_AGE_FALLBACK;
    const ageDiff = ageA - ageB; // 若い方を優先
    if (ageDiff !== 0) return ageDiff;
    const la = lastDateMap.get(a.id);
    const lb = lastDateMap.get(b.id);
    if (!la && lb) return -1;
    if (la && !lb) return 1;
    if (la && lb) return la - lb;
    return 0;
  });
}
/** 2つの配列を交互に並べる（同順位のタイブレークで一方のレベルだけが
 *  系統的に優先されるのを避けるため。例：[s1,s2],[j1,j2] → [s1,j1,s2,j2]） */
function interleave(a, b) {
  const out = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}
/** 資格要件を満たす職員を優先しつつ、担当回数の少なさ・前回勤務日の古さで並べる。
 *  同一レベルの候補プール（係長級のみ／主事級のみ）向け。異なるレベルを混在させる
 *  相方候補プールでは、係長級が常に資格要件を満たす（isQualified=true）ため使わない
 *  （使うと係長級が主事級より不当に優先されてしまう）。 */
function sortCandidates(list, countMap, lastDateMap, remainingMap) {
  return sortByCountAndRecency(list, countMap, lastDateMap, remainingMap).sort((a, b) => {
    const qa = isQualified(a) ? 0 : 1;
    const qb = isQualified(b) ? 0 : 1;
    return qa - qb;
  });
}
/** ペアキー（2名のid。係長級2名ペアもあるため順序に依存しないキーにする） */
function pairKey(idA, idB) {
  return [idA, idB].sort().join('|');
}
/** 係長級2名を組む場合に避けたい職名の組合せ（課長補佐＋課長補佐／課長補佐＋副主幹／副主幹＋副主幹）。
 *  双方の職名が「課長補佐」「副主幹」のいずれかに該当する場合に true を返す */
const SENIOR_TITLE_CLASH = ['課長補佐', '副主幹'];
function isSeniorTitleClashTitle(title) {
  return SENIOR_TITLE_CLASH.some((t) => title && title.includes(t));
}
function isSeniorTitleClash(a, b) {
  return isSeniorTitleClashTitle(a.title) && isSeniorTitleClashTitle(b.title);
}
/** 係長級2名の組合せの場合、表示上の1人目（senior欄・左）にランクの値が低い方（役職が上の方）、
 *  同ランクなら年齢が上の方が来るよう並べ替える。係長級・主事級が混在するペアは、もともと
 *  必ず係長級が1人目（senior欄）になっており、係長級のランク（400〜600）は主事級のランク
 *  （601〜999）より必ず低いため、並べ替えは不要（対象外）。割当の資格判定（誰が選ばれるか）
 *  には一切影響しない、表示順のみの並べ替え。 */
function orderSeniorJuniorForDisplay(pair) {
  if (!pair || !pair.senior || !pair.junior) return pair;
  if (pair.senior.level !== 'senior' || pair.junior.level !== 'senior') return pair;
  const rankA = pair.senior.rank != null ? pair.senior.rank : Infinity;
  const rankB = pair.junior.rank != null ? pair.junior.rank : Infinity;
  if (rankB < rankA) return { senior: pair.junior, junior: pair.senior };
  if (rankB === rankA) {
    const ageA = pair.senior.age != null ? pair.senior.age : -Infinity;
    const ageB = pair.junior.age != null ? pair.junior.age : -Infinity;
    if (ageB > ageA) return { senior: pair.junior, junior: pair.senior };
  }
  return pair;
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
/** 制約段階を指定して、条件を満たす最初のペアを探す。
 *  seniorPool（必ず係長級）から1名、partnerPool（係長級・主事級を問わない相方候補）から
 *  もう1名を選ぶ。1日2名のうち少なくとも1名が係長級であればよいため、係長級2名の組合せも対象。 */
function findPair(seniorPool, partnerPool, opts) {
  for (const s of seniorPool) {
    for (const p of partnerPool) {
      if (p.id === s.id) continue;
      if (opts.avoidSameDept && s.dept && p.dept && s.dept === p.dept) continue;
      if (opts.avoidPairRepeat && isPairBanned(s.id, p.id, opts.pairLastFY, opts.currentFY, opts.pairLookbackYears)) continue;
      if (opts.avoidTitleClash && p.level === 'senior' && isSeniorTitleClash(s, p)) continue;
      if (opts.requireQualification && !isQualified(s) && !isQualified(p)) continue;
      return { senior: s, junior: p };
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
  retireLeadMonths = 1, // 退職予定日のNヶ月前までを対象とする（既定1ヶ月）
  periodId = null, // 指定すると、同一処理期内は原則1人1回の割当にする
}) {
  const countMap = new Map();
  const lastDateMap = new Map();
  const specialUse = new Map(); // key -> Set(staffId)
  const pairLastFY = buildPairLastFiscalYear(history);
  const periodUsedIds = new Set(); // 同一処理期内で既に割り当て済みの職員（1人1回ルール用）
  const periodCountMap = new Map(); // 同一処理期内の担当回数（2回目以降を担ってもらう上限の判定用）

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
      [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => {
        periodUsedIds.add(id);
        periodCountMap.set(id, (periodCountMap.get(id) || 0) + 1);
      });
    }
  });

  const standingExcludedIds = new Set(
    staffList.filter((s) => isStandingExcluded(s, standingExcludedDepts)).map((s) => s.id)
  );
  const activeStaff = staffList.filter((s) => s.active !== false && !standingExcludedIds.has(s.id));
  const results = [];
  const sorted = [...dutyDates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /* --------------------------------------------------------
   * 日ごとの静的な除外情報（課除外・行事除外）を先に計算しておく。
   * 月別課除外ルール・行事の除外期間は割当結果に依存しない（＝処理の
   * 途中で変わらない）ため、日ごとのループで毎回計算し直す必要がなく、
   * 下の「残り出番機会」の計算にも使い回せる。
   * -------------------------------------------------------- */
  const dayContextByDate = new Map();
  sorted.forEach((dd) => {
    const date = parseISO(dd.date);
    const month = date.getMonth() + 1;
    const excludedDepts = new Set();
    let electionDutyExcludedToday = false;
    monthRules.forEach((r) => {
      if (r.months.includes(month)) r.depts.forEach((dep) => excludedDepts.add(dep));
    });
    eventExclusions.forEach((e) => {
      const start = parseISO(e.date);
      const end = parseISO(e.endDate || e.date);
      if (date >= start && date <= end) {
        (e.depts || []).forEach((dep) => excludedDepts.add(dep));
        if (e.targetElectionDuty) electionDutyExcludedToday = true;
      }
    });
    dayContextByDate.set(dd.date, { date, excludedDepts, electionDutyExcludedToday });
  });

  /* --------------------------------------------------------
   * 残り出番機会（この処理期内で、静的な制約だけを見た割当可能日数）
   * 課除外ルール・行事除外（選挙管理委員会併任の除外を含む）・育休等・
   * 退職予定日・新規採用の除外のみで数える。性別ゾーン・120日間隔・
   * ペア重複・特別期間の重複回避など、割当の進行に応じて変わる動的な
   * 制約は含めない（事前に一度だけ計算できないため）。
   * 課除外や行事に当たりやすく出番の窓が狭い職員を、割当の並び替えで
   * 優先的に使うために利用する（sortByCountAndRecency 参照）。
   * -------------------------------------------------------- */
  const remainingOpportunityMap = new Map();
  activeStaff.forEach((s) => {
    let count = 0;
    dayContextByDate.forEach(({ date, excludedDepts, electionDutyExcludedToday }) => {
      if (
        !isOnLeave(s, date, leaves) &&
        passesRetire(s, date, retireLeadMonths) &&
        passesNewHire(s, date, newHireMonths) &&
        ![...excludedDepts].some((dep) => s.dept && s.dept.includes(dep)) &&
        !(electionDutyExcludedToday && s.electionDuty)
      ) {
        count++;
      }
    });
    remainingOpportunityMap.set(s.id, count);
  });

  /* --------------------------------------------------------
   * 性別ゾーン（女性ゾーン→男性ゾーンの一方向ラッチ）
   * --------------------------------------------------------
   * 「男性の期間に女性が混ざると交代しづらい」ため、日ごとに毎回
   * 女性から探すのではなく、いったん男性側に切り替わったら、その
   * 処理期内は女性ゾーンへ戻さない。
   * ラッチの境界は「女性が（この処理期内で）本当に使い切られたこと」
   * （＝割当可能な女性職員が全員すでに1回以上割り当て済みであること）
   * とする。「その日たまたま割当可能な女性が1人もいなかった」というだけ
   * では固定しない。もし「その日」だけを基準に固定してしまうと、行事
   * 除外・育休等が特定の1日だけ重なった偶然で女性ゾーンが処理期の
   * 序盤で永久に締め切られてしまい、実際にはまだ多く残っている未割当の
   * 女性職員が、処理期の残り全日程から一切除外されて0回のまま終わる
   * （その一方で男性側は同じ職員が2回目・3回目と繰り返し割り当てられる）
   * 事態を招く。
   * isFemaleExhausted()：割当可能な日が1日もない（remainingOpportunityMap
   * が0の）女性職員は最初から対象外として除外したうえで、残りの女性
   * 職員が全員 periodUsedIds（今期割当済み）に入っているかで判定する。
   * femaleUsedThisPeriod は安全弁：女性を一度も使っていない状態では
   * （まだ女性ゾーンが始まってすらいないため）固定しない。
   * ------------------------------------------------------ */
  let genderZone = 'F';
  let femaleUsedThisPeriod = false;
  const femaleCandidateIds = activeStaff
    .filter((s) => s.gender === 'F' && (remainingOpportunityMap.get(s.id) || 0) > 0)
    .map((s) => s.id);
  const isFemaleExhausted = () =>
    femaleCandidateIds.length > 0 && femaleCandidateIds.every((id) => periodUsedIds.has(id));
  if (periodId) {
    const staffGenderById = new Map(staffList.map((s) => [s.id, s.gender]));
    const usedFemaleInHistory = history.some(
      (h) => h.periodId === periodId && [h.seniorId, h.juniorId].some((id) => staffGenderById.get(id) === 'F')
    );
    if (usedFemaleInHistory) femaleUsedThisPeriod = true;
    if (femaleUsedThisPeriod && isFemaleExhausted()) genderZone = 'M';
  }

  sorted.forEach((dd) => {
    const { date, excludedDepts, electionDutyExcludedToday } = dayContextByDate.get(dd.date);
    const currentFY = fiscalYearOf(date);

    const special = detectSpecialPeriod(date);
    let bannedBySpecial = new Set();
    if (special) {
      previousSpecialKeys(special.key, specialLookback).forEach((k) => {
        const set = specialUse.get(k);
        if (set) set.forEach((id) => bannedBySpecial.add(id));
      });
    }

    // gender に null を渡すと性別を問わない。ignoreGap=true で最低間隔日数（120日）の判定を外す。
    // ignoreElectionDuty=true で選挙管理委員会（併任）の除外を外す。
    // いずれも人数不足時の最終手段でのみ使用する（選挙管理委員会の除外は、最低間隔日数を
    // 緩和してもなお候補が1人もいない場合に限り、さらに緩和する最後の手段として使う）。
    const eligibleBase = (level, gender, ignoreGap, ignoreElectionDuty) =>
      activeStaff.filter(
        (s) =>
          s.level === level &&
          (gender == null || s.gender === gender) &&
          !isOnLeave(s, date, leaves) &&
          passesRetire(s, date, retireLeadMonths) &&
          ![...excludedDepts].some((dep) => s.dept && s.dept.includes(dep)) &&
          (ignoreElectionDuty || !(electionDutyExcludedToday && s.electionDuty)) &&
          !bannedBySpecial.has(s.id) &&
          passesNewHire(s, date, newHireMonths) &&
          (ignoreGap || passesGap(s.id, date, minGapDays, lastDateMap))
      );

    const pairOpts = { pairLastFY, currentFY, pairLookbackYears };
    // 1日2名のうち少なくとも1名が係長級であればよい（係長級2名の組合せも可）。
    // avoidTitleClash：係長級2名を組む場合、双方の職名が「課長補佐」「副主幹」のいずれかに
    // 該当する組合せ（課長補佐＋課長補佐／課長補佐＋副主幹／副主幹＋副主幹）を避ける。
    const stages = [
      { avoidSameDept: true, avoidPairRepeat: true, avoidTitleClash: true, requireQualification: true },
      { avoidSameDept: true, avoidPairRepeat: false, avoidTitleClash: true, requireQualification: true },
      { avoidSameDept: true, avoidPairRepeat: false, avoidTitleClash: false, requireQualification: true },
      { avoidSameDept: false, avoidPairRepeat: false, avoidTitleClash: false, requireQualification: true },
      { avoidSameDept: false, avoidPairRepeat: false, avoidTitleClash: false, requireQualification: false },
    ];
    /** 指定した性別のみで候補プールを作り、段階的緩和でペアを探す。
     *  seniorPool（必ず係長級）から1名、combinedPool（係長級・主事級を問わない相方候補）から
     *  もう1名を選ぶ。allowRepeat=false のときは「今期まだ割り当てていない職員」だけを探索対象にする
     *  （同一処理期内1人1回ルール）。allowRepeat=true では今期割当済みの職員も対象に含める。 */
    const tryGender = (gender, allowRepeat) => {
      const seniorPool = sortCandidates(eligibleBase('senior', gender), countMap, lastDateMap, remainingOpportunityMap);
      const juniorPool = sortCandidates(eligibleBase('junior', gender), countMap, lastDateMap, remainingOpportunityMap);
      const combinedPool = sortByCountAndRecency(interleave(seniorPool, juniorPool), countMap, lastDateMap, remainingOpportunityMap);
      const onlyFresh = !!periodId && !allowRepeat;
      const searchSeniorPool = onlyFresh ? seniorPool.filter((s) => !periodUsedIds.has(s.id)) : seniorPool;
      const searchCombinedPool = onlyFresh ? combinedPool.filter((s) => !periodUsedIds.has(s.id)) : combinedPool;

      let pair = null;
      let relaxedStage = 0;
      for (let i = 0; i < stages.length; i++) {
        pair = findPair(searchSeniorPool, searchCombinedPool, { ...stages[i], ...pairOpts });
        if (pair) {
          relaxedStage = i;
          break;
        }
      }
      if (!pair && searchSeniorPool.length) {
        const anchor = searchSeniorPool[0];
        const partner = searchCombinedPool.find((p) => p.id !== anchor.id);
        if (partner) {
          pair = { senior: anchor, junior: partner };
          relaxedStage = stages.length;
        }
      }

      const repeat = !!(
        pair &&
        periodId &&
        (periodUsedIds.has(pair.senior.id) || periodUsedIds.has(pair.junior.id))
      );
      return { seniorPool, juniorPool, combinedPool, pair, relaxedStage, repeat };
    };

    /** 1人目（アンカー）の候補プールを作る。
     *  anchorMode='senior'    ： 係長級のみ（係長級1名＋主事級1名という基本の形）
     *  anchorMode='qualified' ： 資格要件（8.3.14）を満たす職員＝係長級 または 市民課経験者。
     *    出典ルール「毎日の組合せのうち少なくとも1名は係長級または市民課経験者であること」に基づき、
     *    係長級が確保できない日は市民課経験のある主事級が資格要件を満たす形で1人目に入れる。
     *    これがないと、係長級が少ない性別では日を作れなくなり、その性別の主事級が
     *    処理期を通して1回も割り当てられずに終わってしまう。 */
    const buildAnchorPool = (gender, anchorMode, ignoreGap) => {
      const seniorPool = sortCandidates(eligibleBase('senior', gender, ignoreGap, false), countMap, lastDateMap, remainingOpportunityMap);
      if (anchorMode === 'senior') return seniorPool;
      const qualifiedJuniors = eligibleBase('junior', gender, ignoreGap, false).filter((s) => isQualified(s));
      const qualifiedJuniorPool = sortCandidates(qualifiedJuniors, countMap, lastDateMap, remainingOpportunityMap);
      return sortByCountAndRecency(interleave(seniorPool, qualifiedJuniorPool), countMap, lastDateMap, remainingOpportunityMap);
    };
    /** 相方（2人目）の候補プール（係長級・主事級を問わない） */
    const buildPartnerPool = (gender, ignoreGap) => {
      const seniorPool = sortCandidates(eligibleBase('senior', gender, ignoreGap, false), countMap, lastDateMap, remainingOpportunityMap);
      const juniorPool = sortCandidates(eligibleBase('junior', gender, ignoreGap, false), countMap, lastDateMap, remainingOpportunityMap);
      return sortByCountAndRecency(interleave(seniorPool, juniorPool), countMap, lastDateMap, remainingOpportunityMap);
    };
    /** 今期まだ割り当てていない職員を含むペアを、指定した条件で探す。
     *  anchorMode : 'senior'（係長級のみ）／'qualified'（係長級または市民課経験者）
     *  freshMode  : 'both'（2名とも今期未割当）／'partial'（片方だけ今期未割当＝もう片方は2回目以降）
     *  ignoreGap  : 最低間隔日数だけを緩和するか
     *  同性ペア・所属除外・育休等の絶対条件はどの組合せでも一切緩和しない。 */
    const tryFreshTier = (gender, { anchorMode, freshMode, ignoreGap }) => {
      if (!periodId) return { pair: null, relaxedStage: 0 };
      const anchorPool = buildAnchorPool(gender, anchorMode, ignoreGap);
      const partnerPool = buildPartnerPool(gender, ignoreGap);
      const isFresh = (s) => !periodUsedIds.has(s.id);
      const freshAnchors = anchorPool.filter(isFresh);
      const freshPartners = partnerPool.filter(isFresh);
      let pair = null;
      let relaxedStage = 0;
      if (freshMode === 'both') {
        for (let i = 0; i < stages.length; i++) {
          pair = findPair(freshAnchors, freshPartners, { ...stages[i], ...pairOpts });
          if (pair) { relaxedStage = i; break; }
        }
        return { pair, relaxedStage };
      }
      // 片方だけ今期未割当。2回目以降を担ってもらう側は、同一処理期内の担当回数が
      // 上限に達していない職員に限る（少数の職員だけが際限なく担当し続けるのを防ぐ）
      if (!freshAnchors.length && !freshPartners.length) return { pair: null, relaxedStage: 0 };
      const canTakeAnother = (s) => (periodCountMap.get(s.id) || 0) < PARTIAL_FRESH_MAX_DUTIES;
      const reusableAnchors = anchorPool.filter(canTakeAnother);
      const reusablePartners = partnerPool.filter(canTakeAnother);
      for (let i = 0; i < stages.length; i++) {
        pair = findPair(freshAnchors, reusablePartners, { ...stages[i], ...pairOpts });
        if (!pair) pair = findPair(reusableAnchors, freshPartners, { ...stages[i], ...pairOpts });
        if (pair) { relaxedStage = i; break; }
      }
      return { pair, relaxedStage };
    };

    const pairIncludesUsed = (pair) =>
      !!(pair && periodId && ((pair.senior && periodUsedIds.has(pair.senior.id)) || (pair.junior && periodUsedIds.has(pair.junior.id))));

    /** 今期未割当の職員を1名でも含むペアを、望ましい順に探す（第1〜第8段階）。
     *  「2名とも今期未割当」を「誰かの2回目」より常に優先し、
     *  「係長級を1人目に置く基本の形」を「市民課経験者が資格要件を満たす形」より優先する。
     *  いずれの段階でも、同性ペア・所属除外・育休等の絶対条件は一切緩和しない。 */
    const FRESH_TIERS = [
      { anchorMode: 'senior', freshMode: 'both', ignoreGap: false }, // ①係長級＋2名とも未割当
      { anchorMode: 'senior', freshMode: 'both', ignoreGap: true }, // ②＋最低間隔日数のみ緩和
      { anchorMode: 'qualified', freshMode: 'both', ignoreGap: false }, // ③市民課経験者が資格を満たす形で2名とも未割当
      { anchorMode: 'qualified', freshMode: 'both', ignoreGap: true }, // ④＋最低間隔日数のみ緩和
      { anchorMode: 'senior', freshMode: 'partial', ignoreGap: false }, // ⑤係長級＋片方だけ未割当（もう片方は2回目以降）
      { anchorMode: 'senior', freshMode: 'partial', ignoreGap: true }, // ⑥＋最低間隔日数のみ緩和
      { anchorMode: 'qualified', freshMode: 'partial', ignoreGap: false }, // ⑦市民課経験者＋片方だけ未割当
      { anchorMode: 'qualified', freshMode: 'partial', ignoreGap: true }, // ⑧＋最低間隔日数のみ緩和
    ];
    const tryGenderFreshTiers = (gender, includeStrictFresh) => {
      for (let i = 0; i < FRESH_TIERS.length; i++) {
        const tier = FRESH_TIERS[i];
        // 第1段階（係長級・2名とも未割当・間隔厳守）は tryGender と同じ探索のため、
        // 既に失敗済みと分かっている場合（includeStrictFresh=false）は飛ばす
        if (i === 0 && !includeStrictFresh) continue;
        const r = tryFreshTier(gender, tier);
        if (!r.pair) continue;
        return {
          ...r,
          repeat: pairIncludesUsed(r.pair),
          forcedFreshGapUsed: tier.ignoreGap,
          partialFreshUsed: tier.freshMode === 'partial',
        };
      }
      return { pair: null, relaxedStage: 0, repeat: false, forcedFreshGapUsed: false, partialFreshUsed: false };
    };

    /** 指定した性別に固定して、可能な限りその性別だけでその日を埋める。
     *  まず「今期未割当の職員を1名でも含むペア」を第1〜第4段階で探し（tryGenderFreshTiers）、
     *  それでも見つからなければ「2名とも今期2回目」を試し、最後に係長級の有無・最低間隔日数も
     *  緩和した最終手段で1名（無理なら相方なしの単独）まで探す（他方の性別には一切広げない）。 */
    const searchGenderFull = (gender, includeFresh) => {
      let r = tryGenderFreshTiers(gender, includeFresh);
      let forcedFreshGapUsed = !!r.forcedFreshGapUsed;
      if (!r.pair) {
        const r2 = tryGender(gender, true);
        if (r2.pair) r = r2;
      }
      let { pair, relaxedStage, repeat } = r;
      let forcedFallbackUsed = false;
      let forcedIgnoredGap = false;
      let forcedElectionDutyUsed = false;
      // 最低間隔日数（ignoreGap）・選挙管理委員会（併任）の除外（ignoreElectionDuty）の緩和は、
      // 「緩和が少ない順」に4通り試す。1名のみ（相方なし）の割当は、より緩和すれば2名の
      // ペアが組める可能性があるため即採用せず、4通りすべてで2名のペアが組めなかった場合の
      // 最終フォールバックとして最後にまとめて判定する（そうしないと、緩和の浅い段階でたまたま
      // 1名しか見つからなかった場合に、それより緩和すれば見つかったはずの2名ペアを
      // 試す前にあきらめてしまう）。
      const combos = [
        { ignoreGap: false, ignoreElectionDuty: false },
        { ignoreGap: true, ignoreElectionDuty: false },
        { ignoreGap: false, ignoreElectionDuty: true },
        { ignoreGap: true, ignoreElectionDuty: true },
      ];
      let soloCandidate = null;
      let soloIgnoreGap = false;
      let soloIgnoreElectionDuty = false;
      for (const { ignoreGap, ignoreElectionDuty } of combos) {
        if (pair) break;
        const zSeniorPool = sortCandidates(eligibleBase('senior', gender, ignoreGap, ignoreElectionDuty), countMap, lastDateMap, remainingOpportunityMap);
        const zJuniorPool = sortCandidates(eligibleBase('junior', gender, ignoreGap, ignoreElectionDuty), countMap, lastDateMap, remainingOpportunityMap);
        const zCombinedPool = sortByCountAndRecency(interleave(zSeniorPool, zJuniorPool), countMap, lastDateMap, remainingOpportunityMap);
        if (zSeniorPool.length) {
          const anchor = zSeniorPool[0];
          const partner = zCombinedPool.find((p) => p.id !== anchor.id) || null;
          if (partner) {
            pair = { senior: anchor, junior: partner };
            forcedFallbackUsed = true;
            if (ignoreGap) forcedIgnoredGap = true;
            if (ignoreElectionDuty) forcedElectionDutyUsed = true;
          } else if (!soloCandidate) {
            soloCandidate = anchor;
            soloIgnoreGap = ignoreGap;
            soloIgnoreElectionDuty = ignoreElectionDuty;
          }
        } else if (zCombinedPool.length >= 2) {
          const anchor = zCombinedPool[0];
          const partner = zCombinedPool.find((p) => p.id !== anchor.id);
          pair = { senior: anchor, junior: partner }; // 係長級が1人もいない（最終手段）
          forcedFallbackUsed = true;
          if (ignoreGap) forcedIgnoredGap = true;
          if (ignoreElectionDuty) forcedElectionDutyUsed = true;
        } else if (zCombinedPool.length === 1 && !soloCandidate) {
          soloCandidate = zCombinedPool[0];
          soloIgnoreGap = ignoreGap;
          soloIgnoreElectionDuty = ignoreElectionDuty;
        }
      }
      if (!pair && soloCandidate) {
        pair = soloCandidate.level === 'senior' ? { senior: soloCandidate, junior: null } : { senior: null, junior: soloCandidate };
        forcedFallbackUsed = true;
        if (soloIgnoreGap) forcedIgnoredGap = true;
        if (soloIgnoreElectionDuty) forcedElectionDutyUsed = true;
      }
      // 最終手段で選んだペアは tryGender の repeat 判定を経ていないため、ここで改めて判定する
      // （最終手段で選んだ相手が今期割当済みでも「2回目の割当」の表示が欠落しないようにする）。
      if (forcedFallbackUsed) {
        repeat = !!(
          periodId &&
          pair &&
          ((pair.senior && periodUsedIds.has(pair.senior.id)) || (pair.junior && periodUsedIds.has(pair.junior.id)))
        );
      }
      return { pair, relaxedStage, repeat, forcedFallbackUsed, forcedIgnoredGap, forcedElectionDutyUsed, forcedFreshGapUsed };
    };

    // 性別ゾーン方式：女性ゾーンでは「今期未割当の女性を1名でも含むペア」をまず試す
    // （第1〜第4段階。tryGenderFreshTiers を参照）。2名とも今期2回目のペアはここでは作らない
    // ＝女性が少数でも“2回目同士”で際限なく粘ってしまい、男性が一度も使われなくなるのを防ぐ。
    // それが失敗した場合に限り、男性を（今期未割当→今期2回目→最終手段まで）フルに探す。
    // 男性が1名も見つけられなかった場合（男性が0名の職場等）は、ゾーンを切り替えても
    // 意味がないため、女性側の2回目・最終手段に留まる（一度も男性ゾーンに入らない）。
    // 女性が本当に使い切られた（isFemaleExhausted）場合に限り、この処理期の残りは女性を
    // 一切探索しない（femaleUsedThisPeriod ガード付きで genderZone をラッチする）。まだ
    // 使い切られていない場合は、今日だけ男性を借りて（zoneToday='M'）、明日以降も女性を
    // 優先的に探し続ける（genderZoneは'F'のまま）。ペアは常に同性。
    let zoneToday = genderZone;
    let outcome;
    if (zoneToday === 'F') {
      const freshF = tryGenderFreshTiers('F', true);
      if (freshF.pair) {
        outcome = { ...freshF, forcedFallbackUsed: false, forcedIgnoredGap: false, forcedElectionDutyUsed: false };
      } else {
        const maleFull = searchGenderFull('M', true);
        if (maleFull.pair) {
          zoneToday = 'M';
          outcome = maleFull;
        } else {
          outcome = searchGenderFull('F', false); // 女性の未割当は失敗済みなので2回目から
        }
      }
    } else {
      outcome = searchGenderFull('M', true);
    }

    const { pair, relaxedStage, repeat, forcedFallbackUsed, forcedIgnoredGap, forcedElectionDutyUsed, forcedFreshGapUsed } = outcome;
    const usedGenderToday = pair ? (pair.senior ? pair.senior.gender : pair.junior.gender) : null;
    if (usedGenderToday === 'F') femaleUsedThisPeriod = true;
    if (zoneToday === 'M' && femaleUsedThisPeriod && isFemaleExhausted()) genderZone = 'M';

    const orderedPair = orderSeniorJuniorForDisplay(pair);
    const chosenSenior = orderedPair ? orderedPair.senior : null;
    const chosenJunior = orderedPair ? orderedPair.junior : null;
    const assignedCount = (chosenSenior ? 1 : 0) + (chosenJunior ? 1 : 0);

    // 係長級を含むか・資格要件（係長級または市民課経験者）を満たすかは、
    // 探索の経路ではなく最終的な組合せから判定する（市民課経験者が資格を満たす形で
    // 係長級を含まないペアになる場合があるため）
    const pairMembers = [chosenSenior, chosenJunior].filter(Boolean);
    const pairHasSenior = pairMembers.some((p) => p.level === 'senior');
    const pairIsQualified = pairMembers.some((p) => isQualified(p));
    const noSeniorReason = assignedCount === 2 && !pairHasSenior
      ? pairIsQualified
        ? '係長級を含まない組合せです（市民課経験者が資格要件を満たしています）'
        : '係長級が含まれていません（人数不足のため）'
      : null;

    const reasons = [];
    if (assignedCount === 0) {
      reasons.push('対象者がいません（休暇・除外等により、この日に割当可能な職員が1人もいません）');
    } else if (assignedCount === 1) {
      reasons.push('人数不足のため1名のみの割当です（相方となる対象者がいません）');
      if (forcedElectionDutyUsed) reasons.push('選挙管理委員会事務局（併任）の職員を人数不足のため特例的に割り当てました');
    } else if (forcedFallbackUsed) {
      if (repeat) reasons.push('同一処理期内で2回目の割当です');
      if (noSeniorReason) reasons.push(noSeniorReason);
      if (forcedIgnoredGap) reasons.push(`前回勤務日から${minGapDays}日未満の職員を含みます（人数不足のため）`);
      if (forcedElectionDutyUsed) reasons.push('選挙管理委員会事務局（併任）の職員を人数不足のため特例的に割り当てました');
      if (!repeat && !noSeniorReason && !forcedIgnoredGap && !forcedElectionDutyUsed) {
        reasons.push('人数不足のため、通常のルールを緩和して割り当てました');
      }
    } else if (forcedFreshGapUsed) {
      if (repeat) reasons.push('同一処理期内で2回目の割当です');
      reasons.push(`前回勤務日から${minGapDays}日未満ですが、今期まだ一度も割り当てていない職員を優先したため割り当てました`);
      if (noSeniorReason) reasons.push(noSeniorReason);
      if (!pairIsQualified) reasons.push('資格要件（係長級・市民課経験者）を満たす職員がいません');
      if (relaxedStage >= 3) reasons.push('同一課の組合せになっています');
      if (relaxedStage >= 2) reasons.push('課長補佐・副主幹の組合せになっています');
      if (relaxedStage >= 1) reasons.push('過去のペアと重複しています');
    } else {
      if (repeat) reasons.push('同一処理期内で2回目の割当です');
      if (noSeniorReason) reasons.push(noSeniorReason);
      if (!pairIsQualified) reasons.push('資格要件（係長級・市民課経験者）を満たす職員がいません');
      if (relaxedStage >= 3) reasons.push('同一課の組合せになっています');
      if (relaxedStage >= 2) reasons.push('課長補佐・副主幹の組合せになっています');
      if (relaxedStage >= 1) reasons.push('過去のペアと重複しています');
    }

    const status = assignedCount < 2 ? 'error' : reasons.length ? 'warning' : 'ok';

    const record = {
      date: dd.date,
      weekday: dd.weekday,
      holidayName: dd.holidayName,
      seniorId: chosenSenior ? chosenSenior.id : null,
      juniorId: chosenJunior ? chosenJunior.id : null,
      seniorName: chosenSenior ? chosenSenior.name : '',
      juniorName: chosenJunior ? chosenJunior.name : '',
      status,
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
      periodCountMap.set(chosenSenior.id, (periodCountMap.get(chosenSenior.id) || 0) + 1);
    }
    if (chosenJunior) {
      countMap.set(chosenJunior.id, (countMap.get(chosenJunior.id) || 0) + 1);
      lastDateMap.set(chosenJunior.id, date);
      periodUsedIds.add(chosenJunior.id);
      periodCountMap.set(chosenJunior.id, (periodCountMap.get(chosenJunior.id) || 0) + 1);
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
 * 割当後の最適化（フィードバック・修復パス）
 * ------------------------------------------------------------
 * generateAssignments は日付順に1回だけ通す貪欲法のため、後の日ほど枠が
 * 埋まった状態で判定される。その結果、「その職員が入れたはずの数少ない日」が
 * 先に別の職員で埋まってしまうと、あとから挽回する手段がなかった。
 * このパスでは作成し終わった勤務表全体を見渡し、絶対条件を一切崩さない
 * 入替えだけを試して、全体が良くなる場合に限って採用する。
 *
 * 【絶対条件（このパスでも決して崩さない）】
 *   ・同性ペア（その日に割り当てられている性別以外の職員は入れない）
 *   ・その日の性別ゾーン（女性の日／男性の日の別を変えない）
 *   ・育休・産休・病気休暇等の除外期間（産休終了後の育休みなしを含む）
 *   ・常時除外（派遣・7割措置・秘書係・運転手・常時除外所属）
 *   ・月別の課除外ルール・行事の除外期間
 *   ・選挙管理委員会事務局（併任）の除外期間
 *   ・新規採用職員の除外・退職予定日の除外
 *   ・年末年始・GWの重複回避（過去の同期間の担当者）
 *   ・同じ日の2枠に同じ職員を入れない
 * 【改善対象（コストとして評価し、下がる入替えだけを採用する）】
 *   ・今期0回の職員（最重視）
 *   ・空き枠（1名のみ・0名の日）／係長級が含まれない日
 *   ・担当回数の偏り（3回目・4回目…ほど重く評価）
 *   ・最低間隔日数違反
 *   ・過去のペアと重複／同一課／課長補佐・副主幹の組合せ／資格要件
 *
 * 探索の順序はすべて固定で、同じ入力からは必ず同じ結果になる（決定的）。
 * ------------------------------------------------------------ */
const OPT_WEIGHTS = {
  unassigned: 1000, // 今期0回の職員1人あたり
  emptySlot: 500, // 埋まっていない枠1つあたり
  unqualified: 400, // 資格要件（係長級・市民課経験者）を満たさない日（新たに作ることは禁止）
  noSenior: 120, // 係長級が1人も含まれない日（市民課経験者が資格を満たしていれば可。基本の形ではないため減点）
  overAssign: 60, // (担当回数-1)^2 に掛ける
  gapViolation: 80, // 最低間隔日数を下回る間隔1つあたり
  pairRepeat: 30, // 過去のペアと重複／同じ組合せの重複
  sameDept: 25, // 同一課の組合せ
  titleClash: 20, // 課長補佐・副主幹の組合せ
};
const OPT_MAX_ROUNDS = 30;

function optPeriodCount(id, ctx, state) {
  return (state.datesByPerson.get(id) || []).length + (ctx.periodHistoryCount.get(id) || 0);
}
/** 今回の作成分が絡む「最低間隔日数を下回る間隔」の数。履歴だけで完結する間隔は動かせないため数えない */
function optGapViolations(id, ctx, state) {
  if (!ctx.minGapDays) return 0;
  const draft = state.datesByPerson.get(id) || [];
  if (!draft.length) return 0;
  const draftSet = new Set(draft);
  const all = [...new Set([...(ctx.historyDatesByPerson.get(id) || []), ...draft])].sort();
  let n = 0;
  for (let i = 1; i < all.length; i++) {
    if (!draftSet.has(all[i]) && !draftSet.has(all[i - 1])) continue;
    if (diffDays(parseISO(all[i - 1]), parseISO(all[i])) < ctx.minGapDays) n++;
  }
  return n;
}
/** その日の割当が、最低間隔日数を下回る他の勤務日を持つか */
function optHasGapViolationAt(id, date, ctx, state) {
  if (!ctx.minGapDays) return false;
  const target = parseISO(date);
  const all = [...new Set([...(ctx.historyDatesByPerson.get(id) || []), ...(state.datesByPerson.get(id) || [])])];
  return all.some((d) => d !== date && Math.abs(diffDays(parseISO(d), target)) < ctx.minGapDays);
}
function optPersonCost(id, ctx, state) {
  if (!ctx.targetIds.has(id)) return 0;
  const total = optPeriodCount(id, ctx, state);
  if (total === 0) return OPT_WEIGHTS.unassigned;
  return Math.pow(total - 1, 2) * OPT_WEIGHTS.overAssign + optGapViolations(id, ctx, state) * OPT_WEIGHTS.gapViolation;
}
function optDayCost(rec, ctx, state) {
  const s = rec.seniorId ? ctx.staffById.get(rec.seniorId) : null;
  const j = rec.juniorId ? ctx.staffById.get(rec.juniorId) : null;
  const filled = (rec.seniorId ? 1 : 0) + (rec.juniorId ? 1 : 0);
  let cost = (2 - filled) * OPT_WEIGHTS.emptySlot;
  if (filled < 2 || !s || !j) return cost; // 名簿に無い職員（履歴専用等）を含む日は品質評価しない
  if (s.level !== 'senior' && j.level !== 'senior') cost += OPT_WEIGHTS.noSenior;
  if (!isQualified(s) && !isQualified(j)) cost += OPT_WEIGHTS.unqualified;
  if (s.dept && j.dept && s.dept === j.dept) cost += OPT_WEIGHTS.sameDept;
  if (s.level === 'senior' && j.level === 'senior' && isSeniorTitleClash(s, j)) cost += OPT_WEIGHTS.titleClash;
  const info = ctx.dayInfo.get(rec.date);
  if (info && isPairBanned(s.id, j.id, ctx.pairLastFY, info.currentFY, ctx.pairLookbackYears)) cost += OPT_WEIGHTS.pairRepeat;
  return cost;
}
/** 同じ組合せが今回の作成分の中で複数日に出ていないか（重複1組ごとに加点） */
function optPairDuplicated(state, idA, idB) {
  return (state.pairCounts.get(pairKey(idA, idB)) || 0) > 1;
}
function optAddPair(state, rec) {
  if (!rec.seniorId || !rec.juniorId) return;
  const k = pairKey(rec.seniorId, rec.juniorId);
  const c = (state.pairCounts.get(k) || 0) + 1;
  state.pairCounts.set(k, c);
  if (c > 1) state.dupPenalty += OPT_WEIGHTS.pairRepeat;
}
function optRemovePair(state, rec) {
  if (!rec.seniorId || !rec.juniorId) return;
  const k = pairKey(rec.seniorId, rec.juniorId);
  const c = state.pairCounts.get(k) || 0;
  if (c <= 0) return;
  state.pairCounts.set(k, c - 1);
  if (c > 1) state.dupPenalty -= OPT_WEIGHTS.pairRepeat;
}
function optSetSlot(state, ctx, date, level, personId) {
  const rec = state.recordByDate.get(date);
  const prevId = level === 'senior' ? rec.seniorId : rec.juniorId;
  if (prevId === (personId || null)) return;
  optRemovePair(state, rec);
  if (prevId) {
    const arr = state.datesByPerson.get(prevId);
    if (arr) {
      const i = arr.indexOf(date);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  const person = personId ? ctx.staffById.get(personId) : null;
  if (level === 'senior') {
    rec.seniorId = personId || null;
    rec.seniorName = person ? person.name : '';
  } else {
    rec.juniorId = personId || null;
    rec.juniorName = person ? person.name : '';
  }
  if (personId) {
    if (!state.datesByPerson.has(personId)) state.datesByPerson.set(personId, []);
    const arr = state.datesByPerson.get(personId);
    arr.push(date);
    arr.sort();
  }
  optAddPair(state, rec);
}
/** 変更をまとめて適用し、元に戻すための関数を返す */
function optApply(state, ctx, changes) {
  const prev = changes.map((c) => {
    const rec = state.recordByDate.get(c.date);
    return { date: c.date, level: c.level, id: c.level === 'senior' ? rec.seniorId : rec.juniorId };
  });
  changes.forEach((c) => optSetSlot(state, ctx, c.date, c.level, c.to));
  return () => {
    for (let i = prev.length - 1; i >= 0; i--) optSetSlot(state, ctx, prev[i].date, prev[i].level, prev[i].id);
  };
}
/** その日が資格要件（8.3.14）を満たすか＝2名のうち少なくとも1名が係長級または市民課経験者 */
function optIsQualifiedDay(rec, ctx) {
  return [rec.seniorId, rec.juniorId]
    .filter(Boolean)
    .some((id) => {
      const s = ctx.staffById.get(id);
      return s ? isQualified(s) : false;
    });
}
/** 変更を試し、全体のコストが下がる場合だけ確定する（下がらなければ元に戻す）。
 *  「資格要件（係長級または市民課経験者）を満たさない日」を新たに作ってしまう入替えは、
 *  コストの多寡にかかわらず採用しない（既に満たしていない日を改善する入替えは可）。 */
function optTryMove(state, ctx, changes) {
  const dates = [...new Set(changes.map((c) => c.date))];
  const people = new Set();
  changes.forEach((c) => {
    const rec = state.recordByDate.get(c.date);
    const cur = c.level === 'senior' ? rec.seniorId : rec.juniorId;
    if (cur) people.add(cur);
    if (c.to) people.add(c.to);
  });
  const qualifiedBefore = new Map();
  let before = state.dupPenalty;
  dates.forEach((d) => {
    const rec = state.recordByDate.get(d);
    qualifiedBefore.set(d, optIsQualifiedDay(rec, ctx));
    before += optDayCost(rec, ctx, state);
  });
  people.forEach((id) => { before += optPersonCost(id, ctx, state); });
  const undo = optApply(state, ctx, changes);
  const brokeQualification = dates.some((d) => qualifiedBefore.get(d) && !optIsQualifiedDay(state.recordByDate.get(d), ctx));
  if (brokeQualification) {
    undo();
    return false;
  }
  let after = state.dupPenalty;
  dates.forEach((d) => { after += optDayCost(state.recordByDate.get(d), ctx, state); });
  people.forEach((id) => { after += optPersonCost(id, ctx, state); });
  if (after < before) return true;
  undo();
  return false;
}
/** その職員をその日のその枠に入れてよいか（絶対条件のみを判定する。最低間隔日数は
 *  「今期未割当を優先する場合に緩和してよい」ため、ここでは判定せずコストで評価する） */
function optCanPlace(staffMember, rec, level, ctx) {
  if (!staffMember || !ctx.targetIds.has(staffMember.id)) return false;
  const other = level === 'senior' ? rec.juniorId : rec.seniorId;
  if (other === staffMember.id) return false;
  const zone = ctx.zoneGenderByDate.get(rec.date);
  if (!zone || staffMember.gender !== zone) return false;
  const info = ctx.dayInfo.get(rec.date);
  if (!info) return false;
  if (isOnLeave(staffMember, info.date, ctx.leaves)) return false;
  if (!passesRetire(staffMember, info.date, ctx.retireLeadMonths)) return false;
  if (!passesNewHire(staffMember, info.date, ctx.newHireMonths)) return false;
  if ([...info.excludedDepts].some((dep) => staffMember.dept && staffMember.dept.includes(dep))) return false;
  if (info.electionDutyExcludedToday && staffMember.electionDuty) return false;
  if (info.bannedBySpecial.has(staffMember.id)) return false;
  return true;
}
function buildOptimizeContext(params) {
  const {
    results = [], staffList = [], monthRules = [], eventExclusions = [], history = [],
    minGapDays = 0, newHireMonths = 0, specialLookback = 2, pairLookbackYears = 2,
    standingExcludedDepts = [], leaves = [], retireLeadMonths = 1, periodId = null,
  } = params;
  const staffById = new Map(staffList.map((s) => [s.id, s]));
  const targetStaff = staffList.filter(
    (s) => s.active !== false && !!s.gender && !isStandingExcluded(s, standingExcludedDepts)
  );
  const targetIds = new Set(targetStaff.map((s) => s.id));

  const specialUseFromHistory = new Map();
  history.forEach((h) => {
    if (!h.specialPeriodKey) return;
    if (!specialUseFromHistory.has(h.specialPeriodKey)) specialUseFromHistory.set(h.specialPeriodKey, new Set());
    [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => specialUseFromHistory.get(h.specialPeriodKey).add(id));
  });

  const dayInfo = new Map();
  const zoneGenderByDate = new Map();
  results.forEach((r) => {
    const date = parseISO(r.date);
    const month = date.getMonth() + 1;
    const excludedDepts = new Set();
    let electionDutyExcludedToday = false;
    monthRules.forEach((rule) => {
      if (rule.months.includes(month)) rule.depts.forEach((d) => excludedDepts.add(d));
    });
    eventExclusions.forEach((e) => {
      const start = parseISO(e.date);
      const end = parseISO(e.endDate || e.date);
      if (date >= start && date <= end) {
        (e.depts || []).forEach((d) => excludedDepts.add(d));
        if (e.targetElectionDuty) electionDutyExcludedToday = true;
      }
    });
    const special = detectSpecialPeriod(date);
    const bannedBySpecial = new Set();
    if (special) {
      previousSpecialKeys(special.key, specialLookback).forEach((k) => {
        const set = specialUseFromHistory.get(k);
        if (set) set.forEach((id) => bannedBySpecial.add(id));
      });
    }
    dayInfo.set(r.date, { date, excludedDepts, electionDutyExcludedToday, bannedBySpecial, currentFY: fiscalYearOf(date) });
    // その日の性別ゾーン（作成時に割り当てられた性別）。この後の入替えでも変更しない
    const zone = [r.seniorId, r.juniorId]
      .filter(Boolean)
      .map((id) => (staffById.get(id) || {}).gender)
      .find(Boolean);
    zoneGenderByDate.set(r.date, zone || null);
  });

  const historyDatesByPerson = new Map();
  const periodHistoryCount = new Map();
  history.forEach((h) => {
    [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => {
      if (!historyDatesByPerson.has(id)) historyDatesByPerson.set(id, []);
      historyDatesByPerson.get(id).push(h.date);
      if (periodId && h.periodId === periodId) periodHistoryCount.set(id, (periodHistoryCount.get(id) || 0) + 1);
    });
  });
  historyDatesByPerson.forEach((arr) => arr.sort());

  return {
    staffById, targetStaff, targetIds, dayInfo, zoneGenderByDate, historyDatesByPerson, periodHistoryCount,
    pairLastFY: buildPairLastFiscalYear(history),
    minGapDays, newHireMonths, pairLookbackYears, leaves, retireLeadMonths, periodId,
  };
}
function buildOptimizeState(results) {
  const records = results.map((r) => ({ ...r }));
  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const datesByPerson = new Map();
  const pairCounts = new Map();
  records.forEach((r) => {
    [r.seniorId, r.juniorId].filter(Boolean).forEach((id) => {
      if (!datesByPerson.has(id)) datesByPerson.set(id, []);
      datesByPerson.get(id).push(r.date);
    });
    if (r.seniorId && r.juniorId) {
      const k = pairKey(r.seniorId, r.juniorId);
      pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
    }
  });
  datesByPerson.forEach((arr) => arr.sort());
  let dupPenalty = 0;
  pairCounts.forEach((c) => { if (c > 1) dupPenalty += (c - 1) * OPT_WEIGHTS.pairRepeat; });
  return { records, recordByDate, datesByPerson, pairCounts, dupPenalty };
}
/** 第1段階：今期0回の職員を、空き枠または担当回数の多い職員の枠に入れる */
function optPhaseInsertUnassigned(state, ctx, log) {
  let improved = false;
  const unassigned = ctx.targetStaff.filter((s) => optPeriodCount(s.id, ctx, state) === 0);
  for (const person of unassigned) {
    let placed = false;
    for (const rec of state.records) {
      if (placed) break;
      if (!rec.seniorId && !rec.juniorId) continue; // 2枠とも空の日は性別ゾーンが定まらないため対象外
      if (rec.seniorId === person.id || rec.juniorId === person.id) continue;
      for (const level of ['senior', 'junior']) {
        if (!optCanPlace(person, rec, level, ctx)) continue;
        const fromId = level === 'senior' ? rec.seniorId : rec.juniorId;
        if (optTryMove(state, ctx, [{ date: rec.date, level, to: person.id }])) {
          log.push({ type: fromId ? 'replace' : 'fill', date: rec.date, level, fromId: fromId || null, toId: person.id });
          improved = true;
          placed = true;
          break;
        }
      }
    }
  }
  return improved;
}
/** 第2段階：担当回数が多い職員の枠を、担当回数の少ない職員に譲る */
function optPhaseRebalance(state, ctx, log) {
  let improved = false;
  const withCount = ctx.targetStaff.map((s) => ({ s, n: optPeriodCount(s.id, ctx, state) }));
  const heavy = withCount.filter((x) => x.n >= 2).sort((a, b) => b.n - a.n || (a.s.id < b.s.id ? -1 : 1));
  const light = withCount.filter((x) => x.n <= 1).sort((a, b) => a.n - b.n || (a.s.id < b.s.id ? -1 : 1));
  if (!light.length) return false;
  for (const h of heavy) {
    const dates = [...(state.datesByPerson.get(h.s.id) || [])];
    for (const date of dates) {
      const rec = state.recordByDate.get(date);
      if (!rec) continue;
      const level = rec.seniorId === h.s.id ? 'senior' : rec.juniorId === h.s.id ? 'junior' : null;
      if (!level) continue;
      for (const l of light) {
        if (l.s.id === h.s.id) continue;
        if (!optCanPlace(l.s, rec, level, ctx)) continue;
        if (optTryMove(state, ctx, [{ date, level, to: l.s.id }])) {
          log.push({ type: 'replace', date, level, fromId: h.s.id, toId: l.s.id });
          improved = true;
          break;
        }
      }
    }
  }
  return improved;
}
/** 第3段階：要確認が付いている日について、同じ性別ゾーンの別の日と担当を交換して質を上げる */
function optPhaseSwapQuality(state, ctx, log) {
  let improved = false;
  const flagged = state.records.filter((r) => r.seniorId && r.juniorId && optDayCost(r, ctx, state) > 0);
  for (const rec of flagged) {
    for (const level of ['senior', 'junior']) {
      const myId = level === 'senior' ? rec.seniorId : rec.juniorId;
      const me = myId ? ctx.staffById.get(myId) : null;
      if (!me) continue;
      let done = false;
      for (const other of state.records) {
        if (done) break;
        if (other.date === rec.date) continue;
        if (ctx.zoneGenderByDate.get(other.date) !== ctx.zoneGenderByDate.get(rec.date)) continue;
        for (const otherLevel of ['senior', 'junior']) {
          const otherId = otherLevel === 'senior' ? other.seniorId : other.juniorId;
          if (!otherId || otherId === myId) continue;
          const them = ctx.staffById.get(otherId);
          if (!them) continue;
          if (!optCanPlace(them, rec, level, ctx)) continue;
          if (!optCanPlace(me, other, otherLevel, ctx)) continue;
          if (
            optTryMove(state, ctx, [
              { date: rec.date, level, to: otherId },
              { date: other.date, level: otherLevel, to: myId },
            ])
          ) {
            log.push({ type: 'swap', date: rec.date, level, fromId: myId, toId: otherId, date2: other.date, level2: otherLevel });
            improved = true;
            done = true;
            break;
          }
        }
      }
    }
  }
  return improved;
}
/** 入替え後の日について、最終的な組合せから「状態」と「理由」を作り直す */
function optRecomputeReason(rec, ctx, state) {
  if (!rec) return;
  const s = rec.seniorId ? ctx.staffById.get(rec.seniorId) : null;
  const j = rec.juniorId ? ctx.staffById.get(rec.juniorId) : null;
  const filled = (rec.seniorId ? 1 : 0) + (rec.juniorId ? 1 : 0);
  const reasons = [];
  if (filled === 0) {
    reasons.push('対象者がいません（休暇・除外等により、この日に割当可能な職員が1人もいません）');
  } else if (filled === 1) {
    reasons.push('人数不足のため1名のみの割当です（相方となる対象者がいません）');
  } else if (s && j) {
    const info = ctx.dayInfo.get(rec.date);
    const members = [s, j];
    if (members.some((p) => optPeriodCount(p.id, ctx, state) >= 2)) reasons.push('同一処理期内で2回目の割当です');
    const gapMembers = members.filter((p) => optHasGapViolationAt(p.id, rec.date, ctx, state));
    if (gapMembers.length) {
      reasons.push(
        gapMembers.every((p) => optPeriodCount(p.id, ctx, state) === 1)
          ? `前回勤務日から${ctx.minGapDays}日未満ですが、今期まだ一度も割り当てていない職員を優先したため割り当てました`
          : `前回勤務日から${ctx.minGapDays}日未満の職員を含みます（人数不足のため）`
      );
    }
    if (s.level !== 'senior' && j.level !== 'senior') {
      reasons.push(
        isQualified(s) || isQualified(j)
          ? '係長級を含まない組合せです（市民課経験者が資格要件を満たしています）'
          : '係長級が含まれていません（人数不足のため）'
      );
    }
    if (!isQualified(s) && !isQualified(j)) reasons.push('資格要件（係長級・市民課経験者）を満たす職員がいません');
    if (s.dept && j.dept && s.dept === j.dept) reasons.push('同一課の組合せになっています');
    if (s.level === 'senior' && j.level === 'senior' && isSeniorTitleClash(s, j)) reasons.push('課長補佐・副主幹の組合せになっています');
    if (
      (info && isPairBanned(s.id, j.id, ctx.pairLastFY, info.currentFY, ctx.pairLookbackYears)) ||
      optPairDuplicated(state, s.id, j.id)
    ) {
      reasons.push('過去のペアと重複しています');
    }
    if (info && info.electionDutyExcludedToday && members.some((p) => p.electionDuty)) {
      reasons.push('選挙管理委員会事務局（併任）の職員を人数不足のため特例的に割り当てました');
    }
  }
  rec.reason = reasons.join(' / ');
  rec.status = filled < 2 ? 'error' : reasons.length ? 'warning' : 'ok';
}
function optSnapshotStats(state, ctx) {
  const stats = {
    unassigned: 0, threeOrMore: 0, emptySlots: 0, gapViolations: 0,
    noSenior: 0, unqualified: 0, sameDept: 0, titleClash: 0, pairRepeat: 0, errorDays: 0,
  };
  ctx.targetStaff.forEach((s) => {
    const n = optPeriodCount(s.id, ctx, state);
    if (n === 0) stats.unassigned++;
    if (n >= 3) stats.threeOrMore++;
    stats.gapViolations += optGapViolations(s.id, ctx, state);
  });
  state.records.forEach((r) => {
    const filled = (r.seniorId ? 1 : 0) + (r.juniorId ? 1 : 0);
    stats.emptySlots += 2 - filled;
    if (filled < 2) stats.errorDays++;
    const s = r.seniorId ? ctx.staffById.get(r.seniorId) : null;
    const j = r.juniorId ? ctx.staffById.get(r.juniorId) : null;
    if (!s || !j) return;
    if (s.level !== 'senior' && j.level !== 'senior') stats.noSenior++;
    if (!isQualified(s) && !isQualified(j)) stats.unqualified++;
    if (s.dept && j.dept && s.dept === j.dept) stats.sameDept++;
    if (s.level === 'senior' && j.level === 'senior' && isSeniorTitleClash(s, j)) stats.titleClash++;
    const info = ctx.dayInfo.get(r.date);
    if ((info && isPairBanned(s.id, j.id, ctx.pairLastFY, info.currentFY, ctx.pairLookbackYears)) || optPairDuplicated(state, s.id, j.id)) {
      stats.pairRepeat++;
    }
  });
  return stats;
}
/**
 * 作成済みの勤務表（generateAssignments の結果）を、絶対条件を崩さない入替えだけで改善する。
 * 戻り値の results は新しい配列（元の配列は変更しない）。summary に改善内容を返す。
 */
function optimizeAssignments(params) {
  const source = params.results || [];
  const ctx = buildOptimizeContext(params);
  const state = buildOptimizeState(source);
  if (!source.length) {
    return { results: state.records, summary: { rounds: 0, moves: [], before: optSnapshotStats(state, ctx), after: optSnapshotStats(state, ctx), addedStaff: [], stillUnassigned: [] } };
  }
  const before = optSnapshotStats(state, ctx);
  const wasUnassigned = new Set(ctx.targetStaff.filter((s) => optPeriodCount(s.id, ctx, state) === 0).map((s) => s.id));

  const log = [];
  let rounds = 0;
  let improved = true;
  while (improved && rounds < OPT_MAX_ROUNDS) {
    improved = false;
    rounds++;
    if (optPhaseInsertUnassigned(state, ctx, log)) improved = true;
    if (optPhaseRebalance(state, ctx, log)) improved = true;
    if (optPhaseSwapQuality(state, ctx, log)) improved = true;
  }

  // 入替えのあった日と、担当が動いた職員が関わるすべての日について、理由と状態を作り直す
  const touchedDates = new Set();
  const touchedPeople = new Set();
  log.forEach((m) => {
    touchedDates.add(m.date);
    if (m.date2) touchedDates.add(m.date2);
    if (m.fromId) touchedPeople.add(m.fromId);
    if (m.toId) touchedPeople.add(m.toId);
  });
  state.records.forEach((r) => {
    if ((r.seniorId && touchedPeople.has(r.seniorId)) || (r.juniorId && touchedPeople.has(r.juniorId))) touchedDates.add(r.date);
  });
  touchedDates.forEach((d) => optRecomputeReason(state.recordByDate.get(d), ctx, state));

  const after = optSnapshotStats(state, ctx);
  const nameOf = (id) => (ctx.staffById.get(id) || {}).name || '';
  return {
    results: state.records,
    summary: {
      rounds,
      before,
      after,
      moves: log.map((m) => ({
        type: m.type,
        date: m.date,
        level: m.level,
        fromName: m.fromId ? nameOf(m.fromId) : '',
        toName: m.toId ? nameOf(m.toId) : '',
        date2: m.date2 || null,
      })),
      addedStaff: [...wasUnassigned]
        .filter((id) => optPeriodCount(id, ctx, state) > 0)
        .map((id) => nameOf(id)),
      stillUnassigned: ctx.targetStaff.filter((s) => optPeriodCount(s.id, ctx, state) === 0).map((s) => s.name),
    },
  };
}

/* ------------------------------------------------------------
 * 未割当職員の理由説明
 * ------------------------------------------------------------ */
/**
 * 今回の作成分（dutyDates／results）で staffMember が一度も割り当てられなかった理由を説明する文字列を返す。
 * 完全なシミュレーションではなく、各対象日について「本人の属性で明らかに対象外だったか」を積み上げて説明する。
 */
function explainUnassignedStaff(staffMember, { dutyDates, results, staffList, monthRules, eventExclusions, history, minGapDays, newHireMonths, leaves, specialLookback, retireLeadMonths = 1 }) {
  if (!staffMember.gender) {
    return '性別が未設定のため割当対象になりません（職員名簿でご確認ください）。';
  }

  const lastDateMap = new Map();
  const specialUse = new Map(); // key -> Set(staffId)
  (history || []).forEach((h) => {
    [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => {
      const d = parseISO(h.date);
      const prevLast = lastDateMap.get(id);
      if (!prevLast || d > prevLast) lastDateMap.set(id, d);
    });
    if (h.specialPeriodKey) {
      if (!specialUse.has(h.specialPeriodKey)) specialUse.set(h.specialPeriodKey, new Set());
      [h.seniorId, h.juniorId].filter(Boolean).forEach((id) => specialUse.get(h.specialPeriodKey).add(id));
    }
  });

  let genderSkipped = 0;
  let blockedLeave = 0;
  let blockedRetire = 0;
  let blockedSpecial = 0;
  let blockedNewHire = 0;
  let blockedGap = 0;
  let blockedElectionDuty = 0;
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
    if (!passesRetire(staffMember, date, retireLeadMonths)) {
      blockedRetire++;
      return;
    }

    const special = detectSpecialPeriod(date);
    if (special) {
      const banned = previousSpecialKeys(special.key, specialLookback || 2).some((k) => {
        const set = specialUse.get(k);
        return set && set.has(staffMember.id);
      });
      if (banned) {
        blockedSpecial++;
        return;
      }
    }

    const month = date.getMonth() + 1;
    const excludedDepts = new Set();
    let electionDutyExcludedToday = false;
    (monthRules || []).forEach((r) => {
      if (r.months.includes(month)) r.depts.forEach((dep) => excludedDepts.add(dep));
    });
    (eventExclusions || []).forEach((e) => {
      const start = parseISO(e.date);
      const end = parseISO(e.endDate || e.date);
      if (date >= start && date <= end) {
        (e.depts || []).forEach((dep) => excludedDepts.add(dep));
        if (e.targetElectionDuty) electionDutyExcludedToday = true;
      }
    });
    const deptHit = [...excludedDepts].find((dep) => staffMember.dept && staffMember.dept.includes(dep));
    if (deptHit) {
      deptLabels.add(deptHit);
      return;
    }
    if (electionDutyExcludedToday && staffMember.electionDuty) {
      blockedElectionDuty++;
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

  const zoneLabel = staffMember.gender === 'M' ? '女性ゾーン' : '男性ゾーン';
  const consideredDays = dutyDates.length - genderSkipped;
  if (consideredDays === 0) {
    return `対象期間はすべて${zoneLabel}のまま終了したため、対象になりませんでした（性別ゾーン方式：女性ゾーンから男性ゾーンへ一方向に切り替わり、戻りません）。`;
  }

  const parts = [];
  if (blockedLeave > 0) parts.push(`育休・産休等の除外期間中（${blockedLeave}日）`);
  if (blockedRetire > 0) parts.push(`退職予定日の${retireLeadMonths}ヶ月前を過ぎているため対象外（${blockedRetire}日）`);
  if (blockedSpecial > 0) parts.push(`年末年始・GWの重複回避により対象外（前回・前々回の同期間の担当者のため・${blockedSpecial}日）`);
  if (deptLabels.size > 0) parts.push(`所属の除外ルールに該当（${[...deptLabels].join('・')}）`);
  if (blockedElectionDuty > 0) parts.push(`選挙管理委員会事務局（併任）のため選挙関連の除外期間中（${blockedElectionDuty}日）`);
  if (blockedNewHire > 0) parts.push(`採用から${newHireMonths}ヶ月未満のため対象外（${blockedNewHire}日）`);
  if (blockedGap > 0) parts.push(`前回勤務日から${minGapDays}日未満のため対象外（${blockedGap}日）`);
  if (eligibleButNotChosen > 0) parts.push(`候補ではあったが、今期の割当枠が他の職員で埋まったため選ばれなかった（1人1回が基本のルールのため・${eligibleButNotChosen}日）`);
  if (genderSkipped > 0) {
    parts.push(`${zoneLabel}でなかった日のため対象外だった日（${genderSkipped}日）`);
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
    isSeniorTitleClash,
    generateAssignments,
    optimizeAssignments,
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
