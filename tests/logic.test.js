/** 割当ロジックの検証（ブラウザ不要）。
 *  app.js を Node から読み込み、ルールが守られているかを直接確かめる。
 */
const path = require('path');
const app = require(path.resolve(__dirname, '..', 'app.js'));
const { Check } = require('./helpers');
const { buildStaff, PERIOD } = require('./fixtures');

const c = new Check('割当ロジック（app.js）');

// ---- 日付まわり ----
c.eq(app.toISO(new Date(2026, 6, 10)), '2026-07-10', 'toISO');
c.eq(app.diffDays(app.parseISO('2026-01-01'), app.parseISO('2026-01-31')), 30, 'diffDays');
c.eq(app.fiscalYearOf(app.parseISO('2026-03-31')), 2025, '年度（3月は前年度）');
c.eq(app.fiscalYearOf(app.parseISO('2026-04-01')), 2026, '年度（4月から新年度）');

// ---- 指定日の抽出（土日・祝日・年末年始） ----
const dates = app.listDesignatedDates('2026-04-01', '2026-04-30');
c.ok(dates.length >= 8, `4月の指定日が少なすぎる（${dates.length}日）`);
c.ok(dates.every((d) => d.weekday === 0 || d.weekday === 6 || d.holidayName),
  '指定日に平日（祝日でない日）が混ざっている');
const yearEnd = app.listDesignatedDates('2026-12-28', '2027-01-04');
['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']
  .forEach((d) => c.ok(yearEnd.some((x) => x.date === d), `年末年始 ${d} が抽出されていない`));

// ---- 係長級どうしの組合せ判定 ----
c.ok(app.isSeniorTitleClash({ level: 'senior', title: '課長補佐' }, { level: 'senior', title: '副主幹' }),
  '課長補佐＋副主幹はクラッシュ扱いのはず');
c.ok(!app.isSeniorTitleClash({ level: 'senior', title: '係長' }, { level: 'senior', title: '課長補佐' }),
  '係長＋課長補佐はクラッシュではない');

// ---- 勤務表の自動作成 ----
const staffList = buildStaff(150);   // 指定日61日×2枠=122 を上回る人数（1人1回に収まる）
const dutyDates = app.listDesignatedDates(PERIOD.startDate, PERIOD.endDate);
const gen = app.generateAssignments({
  staffList, dutyDates, monthRules: [], eventExclusions: [], history: [],
  minGapDays: 120, newHireMonths: 6, specialLookback: 2, pairLookbackYears: 2,
  standingExcludedDepts: [], leaves: [], retireLeadMonths: 1, periodId: PERIOD.id,
});
const results = gen.results || gen;
c.eq(results.length, dutyDates.length, '作成された日数が指定日の数と合わない');

const byId = Object.fromEntries(staffList.map((s) => [s.id, s]));
let noSenior = 0, sameDept = 0, diffGender = 0, dup = 0;
const used = new Map();
results.forEach((r) => {
  if (!r.seniorId || !r.juniorId) return;      // 人数不足の日は別途「エラー」表示される
  const a = byId[r.seniorId], b = byId[r.juniorId];
  if (!a || !b) return;
  if (a.level !== 'senior' && b.level !== 'senior' && !a.citizenExp && !b.citizenExp) noSenior++;
  if (a.dept === b.dept) sameDept++;
  if (a.gender !== b.gender) diffGender++;
  [r.seniorId, r.juniorId].forEach((id) => used.set(id, (used.get(id) || 0) + 1));
});
c.eq(noSenior, 0, '係長級も市民課経験者もいない日がある');
c.eq(sameDept, 0, '同一課どうしの組合せがある');
c.eq(diffGender, 0, '男女が混ざったペアがある');
dup = [...used.values()].filter((n) => n > 1).length;
c.ok(dup === 0, `同一処理期内で2回以上割り当てられた職員が ${dup} 名いる（人数が足りていれば0のはず）`);

// ---- 性別ゾーン：女性→男性の一方向 ----
const genders = results.filter((r) => r.seniorId && byId[r.seniorId])
  .map((r) => byId[r.seniorId].gender);
const firstM = genders.indexOf('M');
if (firstM >= 0) {
  c.ok(!genders.slice(firstM).includes('F'),
    '男性ゾーンに入ったあとに女性が割り当てられている（ゾーンは一方向のはず）');
}

// ---- 最適化パスが結果を壊さない ----
const opt = app.optimizeAssignments({
  results, staffList, history: [], minGapDays: 120, newHireMonths: 6,
  specialLookback: 2, pairLookbackYears: 2, standingExcludedDepts: [],
  leaves: [], retireLeadMonths: 1, periodId: PERIOD.id,
  monthRules: [], eventExclusions: [],
});
c.eq(opt.results.length, results.length, '最適化の前後で日数が変わっている');
let optSameDept = 0, optDiffGender = 0;
opt.results.forEach((r) => {
  const a = byId[r.seniorId], b = byId[r.juniorId];
  if (!a || !b) return;
  if (a.dept === b.dept) optSameDept++;
  if (a.gender !== b.gender) optDiffGender++;
});
c.eq(optSameDept, 0, '最適化後に同一課の組合せができている');
c.eq(optDiffGender, 0, '最適化後に男女混合のペアができている');

// ---- 変更届テキストの読み取り ----
c.eq(app.parseOcrDate('2026年07月11日（土）'), '2026-07-11', '日付の読み取り');
c.eq(app.extractLabelValue('交代相手氏名　佐藤　隆', '交代相手氏名'), '佐藤　隆', '氏名の読み取り');
const m = app.bestNameMatch('佐藤 隆', [{ id: 'a', name: '佐藤　隆' }, { id: 'b', name: '佐々木　真理' }]);
c.eq(m && m.id, 'a', '氏名の候補照合（空白の種類が違っても当てる）');

c.finish();
