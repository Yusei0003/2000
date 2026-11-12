/** テストで使う架空の職員名簿・処理期・履歴。実在の職員とは関係ありません。 */

const PERIOD = {
  id: '2026-H1', fiscalYear: 2026, half: 'H1',
  startDate: '2026-04-01', endDate: '2026-09-30', label: '2026年度前期',
  standingExcludedDepts: [], sickLeaveExcludedNumbers: [], specialExclusions: [],
  createdAt: '2026-03-02T09:00:00.000Z',
};
const PERIOD_PREV = {
  id: '2025-H2', fiscalYear: 2025, half: 'H2',
  startDate: '2025-10-01', endDate: '2026-03-31', label: '2025年度後期',
  standingExcludedDepts: [], sickLeaveExcludedNumbers: [], specialExclusions: [],
  createdAt: '2025-09-01T09:00:00.000Z',
};

function staff(number, name, level, gender, dept, title, extra = {}) {
  return {
    id: 'st-' + number, number, name, level,
    rank: level === 'senior' ? (title === '課長補佐' ? 400 : title === '副主幹' ? 420 : 500) : 700,
    title, dept, deptCode: '101', gender, section: '', sideJob: '',
    category: '正職員', status: '一般職', age: level === 'senior' ? 45 : 30,
    citizenExp: dept === '市民課', dispatched: false, seventyPercent: false,
    electionDuty: false, deptHistory: [dept], hireDate: null, retireDate: null, active: true,
    ...extra,
  };
}

/** 交代の反映をひととおり試せる、小さめの名簿。 */
const SMALL = [
  staff('S1', '髙橋　良明', 'senior', 'M', '総務課', '係長'),
  staff('S2', '岡村　貴悦', 'senior', 'M', '企画課', '係長'),
  staff('S3', '内藤　健吾', 'senior', 'M', '財政課', '課長補佐'),
  staff('S4', '柴田　直人', 'senior', 'M', '建設課', '副主幹'),
  staff('J1', '和田　悠歴', 'junior', 'M', '福祉課', '主事'),
  staff('J2', '佐藤　隆', 'junior', 'M', '商工観光課', '主事'),
  staff('J3', '大島　拓真', 'junior', 'M', '税務課', '主事'),
  staff('J4', '成田　和彦', 'junior', 'M', '市民課', '主事'),
];

function rec(date, weekday, seniorId, juniorId, list, over = {}) {
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  return {
    date, weekday, holidayName: null,
    seniorId, juniorId,
    seniorName: byId[seniorId].name, juniorName: byId[juniorId].name,
    seniorChangedAt: '', juniorChangedAt: '',
    status: 'ok', reason: '',
    periodId: PERIOD.id, periodLabel: PERIOD.label, manuallyEdited: false,
    ...over,
  };
}

/** 7/10（土）と 7/11（日）の2日だけの確定済み履歴。 */
function twoDayHistory(list = SMALL) {
  return [
    rec('2026-07-10', 5, 'st-S1', 'st-J1', list),
    rec('2026-07-11', 6, 'st-S2', 'st-J2', list),
  ];
}

/** 勤務表を自動作成できるだけの人数を持つ名簿を作る。 */
function buildStaff(count) {
  const depts = ['総務課', '企画課', '財政課', '税務課', '市民課', '福祉課', '環境課',
    '建設課', '会計課', '教育課', '商工観光課', '農林課'];
  const list = [];
  for (let i = 0; i < count; i++) {
    const isSenior = i % 5 !== 4;
    const gender = i % 5 < 2 ? 'F' : 'M';
    list.push(staff(
      String(1000 + i),
      `${gender === 'F' ? '花' : '太'}${String(i).padStart(3, '0')}　職員`,
      isSenior ? 'senior' : 'junior',
      gender,
      depts[i % depts.length],
      isSenior ? '係長' : '主事'
    ));
  }
  return list;
}

/** 変更届の貼り付けテキストを組み立てる。 */
function changeText({ partner, applicant, appliedAt = '2026年06月20日（土）16:52', changeDate }) {
  return [
    `交代相手氏名　${partner}`,
    `申請者　${applicant}`,
    `申請日　${appliedAt}`,
    `変更する日付　${changeDate}`,
  ].join('\n');
}

module.exports = { PERIOD, PERIOD_PREV, SMALL, staff, rec, twoDayHistory, buildStaff, changeText };
