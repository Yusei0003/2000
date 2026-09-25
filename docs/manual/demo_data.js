/** マニュアル用のデモデータ（架空の職員名簿・処理期・行事・休暇）。
 *  実在の職員とは一切関係のないダミーデータです。 */

const SEI = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤',
  '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '斎藤', '清水', '森',
  '山崎', '池田', '橋本', '阿部', '石川', '前田', '藤田', '後藤', '岡田', '村上',
  '長谷川', '近藤', '石井', '坂本', '遠藤', '藤井', '青木', '福田', '三浦', '西村',
  '藤原', '太田', '松田', '原田', '岡本', '中島', '小川', '中野', '今井', '大野'];
const MEI_M = ['健一', '大輔', '翔太', '拓也', '直樹', '和也', '雄太', '智之', '達也', '亮介',
  '誠治', '陽介', '康平', '優斗', '航平', '祐樹', '隆之', '将大', '公平', '悠斗',
  '克彦', '秀樹', '正人', '英明', '俊介', '慎吾', '裕也', '大地', '涼太', '和樹'];
const MEI_F = ['美咲', '陽子', '恵理', '彩香', '真由美', '由紀', '沙織', '愛子', '奈津美', '千尋',
  '香織', '智子', '結衣', '麻衣', '亜美', '瑞穂', '果歩', '里奈', '菜摘', '涼子',
  '典子', '桃子', '絵里', '有希', '早紀', '瞳', '綾乃', '美穂', '直美', '琴音'];
const DEPTS = ['総務課', '企画政策課', '財政課', '税務課', '市民課', '福祉課', '子育て支援課',
  '健康推進課', '環境課', '農林水産課', '商工観光課', '建設課', '都市計画課',
  '上下水道課', '会計課', '議会事務局', '教育総務課', '生涯学習課'];
const SENIOR_TITLES = ['係長', '係長', '係長', '係長', '課長補佐', '副主幹'];
const JUNIOR_TITLES = ['主事', '主事', '主事', '主任', '主任', '技師'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 架空の職員名簿を作る。 */
function buildStaff(count) {
  const rnd = mulberry32(20260401);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const used = new Set();
  const list = [];
  for (let i = 0; i < count; i++) {
    const isSenior = i % 5 !== 4;      // 5人に4人を係長級（1人目が必ず係長級のため多めに）
    const gender = i % 5 < 2 ? 'F' : 'M'; // 女性を4割ほど
    let name;
    let guard = 0;
    do {
      name = `${pick(SEI)}　${gender === 'F' ? pick(MEI_F) : pick(MEI_M)}`;
      guard++;
    } while (used.has(name) && guard < 400);
    used.add(name);
    const dept = DEPTS[i % DEPTS.length];
    const title = isSenior ? pick(SENIOR_TITLES) : pick(JUNIOR_TITLES);
    const rank = isSenior ? (title === '課長補佐' ? 400 : title === '副主幹' ? 420 : 500) : 700;
    const number = String(1200 + i * 3);
    list.push({
      id: `st-${number}`,
      number,
      name,
      level: isSenior ? 'senior' : 'junior',
      rank,
      title,
      dept,
      deptCode: String(101 + (i % DEPTS.length)),
      gender,
      section: '',
      sideJob: '',
      category: '正職員',
      status: '一般職',
      age: isSenior ? 38 + Math.floor(rnd() * 20) : 24 + Math.floor(rnd() * 14),
      citizenExp: dept === '市民課' || rnd() < 0.12,
      dispatched: false,
      seventyPercent: false,
      electionDuty: rnd() < 0.08,
      deptHistory: [dept],
      hireDate: null,
      retireDate: null,
      active: true,
    });
  }
  return list;
}

const PERIOD_CURRENT = {
  id: '2026-H1',
  fiscalYear: 2026,
  half: 'H1',
  startDate: '2026-04-01',
  endDate: '2026-09-30',
  label: '2026年度前期',
  standingExcludedDepts: ['議会事務局'],
  sickLeaveExcludedNumbers: [],
  specialExclusions: [],
  createdAt: '2026-03-02T09:00:00.000Z',
};
const PERIOD_PREV = {
  id: '2025-H2',
  fiscalYear: 2025,
  half: 'H2',
  startDate: '2025-10-01',
  endDate: '2026-03-31',
  label: '2025年度後期',
  standingExcludedDepts: ['議会事務局'],
  sickLeaveExcludedNumbers: [],
  specialExclusions: [],
  createdAt: '2025-09-01T09:00:00.000Z',
};

const STAFF = buildStaff(150);

/** 前の処理期（2025年度後期）の確定済み履歴。120日ルール・ペア重複回避が
 *  過去の履歴を踏まえて働くことを画面上で示すために入れておく。 */
function buildPrevHistory() {
  const dates = ['2025-10-04', '2025-10-05', '2025-10-11', '2025-10-12', '2025-11-01',
    '2025-11-02', '2025-11-22', '2025-11-23', '2025-12-06', '2025-12-07'];
  return dates.map((date, i) => {
    const s = STAFF[110 + i * 2];
    const j = STAFF[111 + i * 2];
    return {
      date,
      weekday: new Date(date + 'T00:00:00').getDay(),
      holidayName: null,
      seniorId: s.id, juniorId: j.id,
      seniorName: s.name, juniorName: j.name,
      seniorChangedAt: '', juniorChangedAt: '',
      status: 'ok', reason: '',
      periodId: PERIOD_PREV.id, periodLabel: PERIOD_PREV.label,
      manuallyEdited: false,
    };
  });
}

const FISCAL_EVENTS = [
  { id: 'ev-1', fiscalYear: 2026, name: '市民産業まつり', date: '2026-05-17', endDate: '', leadDays: 30, excludeFrom: '', afterDays: 10, depts: ['商工観光課', '農林水産課'], targetElectionDuty: false },
  { id: 'ev-2', fiscalYear: 2026, name: '市長選挙（告示）', date: '2026-07-05', endDate: '', leadDays: 30, excludeFrom: '', afterDays: 10, depts: ['総務課'], targetElectionDuty: true },
  { id: 'ev-3', fiscalYear: 2026, name: '夏まつり花火大会', date: '2026-08-01', endDate: '', leadDays: 30, excludeFrom: '', afterDays: 10, depts: ['商工観光課'], targetElectionDuty: false },
];

const LEAVES = [
  { id: 'lv-1', staffNumber: STAFF[7].number, startDate: '2026-04-01', endDate: '2027-03-31', category: '育児休業', importedName: STAFF[7].name, kind: 'childcare' },
  { id: 'lv-2', staffNumber: STAFF[13].number, startDate: '2026-05-10', endDate: '2026-09-05', category: '産前産後休暇', importedName: STAFF[13].name, kind: 'maternity' },
  { id: 'lv-3', staffNumber: STAFF[22].number, startDate: '2026-06-01', endDate: '', category: '病気休暇', importedName: STAFF[22].name, kind: null },
];

/** ブラウザに渡すための、関数を含まないプレーンなデータ一式。 */
function seed() {
  return {
    periods: [PERIOD_PREV, PERIOD_CURRENT],
    currentPeriodId: PERIOD_CURRENT.id,
    periodStaff: { [PERIOD_CURRENT.id]: STAFF, [PERIOD_PREV.id]: STAFF },
    leaves: LEAVES,
    events: FISCAL_EVENTS,
    history: buildPrevHistory(),
  };
}

module.exports = { STAFF, PERIOD_CURRENT, PERIOD_PREV, FISCAL_EVENTS, LEAVES, buildPrevHistory, seed };
