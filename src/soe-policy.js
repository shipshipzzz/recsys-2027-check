import { deadlineEpoch, dayDistance } from './shared/time.js';
/** Inclusion is broader than a technical track. Qualification and recruitment cycle are independent. */
export const POLICY_VERSION = 'applied-statistics-v1';
export const SOE_TRACKS = Object.freeze({
  stats: '统计 / 经营分析',
  banking: '银行综合 / 管培',
  risk: '风险 / 审计',
  insurance: '保险 / 精算',
  research: '投研 / 交易',
  operations: '运营 / 综合管理',
  supply: '供应链 / 规划',
  product: '产品 / 市场',
  software: '软件 / 数据工程',
  rec: '推荐算法',
  ai: 'AI / 云',
  finance: '金融科技',
  geo: '地球物理 AI',
  industrial: '工业 / 研究院',
});
export const MAJOR_LEVELS = Object.freeze({
  explicit: '明确列应用统计',
  statistics: '统计类 / 数理统计',
  unrestricted: '指定岗位不限专业',
  related: '相关专业需确认',
  unknown: '专业条件待核',
});
export const CYCLES = Object.freeze({
  current: '2027 当届资料',
  historical: '往届依据 · 待新公告',
  unverified: '届次 / 入口待复核',
});
export const BROAD_TRACKS = Object.freeze([
  'stats',
  'banking',
  'risk',
  'insurance',
  'research',
  'operations',
  'supply',
  'product',
  'software',
]);

/** Bind the judgement to the facts that produced it, not merely a mutable card ID.
 * Node uses a SHA-256 of this string for the publishing gate. The browser compares
 * current facts to the already-validated bundled baseline, without asynchronous hashing.
 */
export function assessmentFacts(item, sources = {}) {
  return JSON.stringify([
    item.id,
    item.name,
    item.track,
    item.req ?? '',
    item.jobs ?? '',
    item.window ?? '',
    item.ownership ?? '',
    item.evidence ?? '',
    item.closes ?? '',
    item.status,
    item.due ?? null,
    item.dueTime ?? null,
    item.dueScope ?? '',
    item.start ?? null,
    item.audit?.checked ?? null,
    item.audit?.summary ?? '',
    item.audit?.scope ?? '',
    (item.audit?.refs || []).map((id) => [
      id,
      sources[id]?.url ?? '',
      sources[id]?.checked ?? null,
      sources[id]?.scope ?? '',
      sources[id]?.title ?? '',
      sources[id]?.level ?? '',
    ]),
  ]);
}
export function createAssessmentLookup(policy, baseline) {
  const baselineById = new Map(
    baseline.DATA.map((item) => [item.id, assessmentFacts(item, baseline.SOURCES)]),
  );
  const cache = new WeakMap();
  return (item, sources) => {
    const facts = assessmentFacts(item, sources);
    const old = cache.get(item);
    if (old?.facts === facts) return old.assessment;
    const row = policy.entries[item.id];
    const matched = !!row && baselineById.get(item.id) === facts;
    const assessment = matched
      ? { ...row, matched: true }
      : {
          major: 'unknown',
          cycle: 'unverified',
          intake: null,
          directions: [item.track],
          evidenceRefs: [],
          matched: false,
          basis: '招聘资料与已审核版本不同，或该条目尚未完成专业评估；请核对最新公告和岗位条件。',
          qualityBasis: '单位和岗位价值需结合最新资料确认。',
        };
    cache.set(item, { facts, assessment });
    return assessment;
  };
}
export function hasMajorEvidence(assessment) {
  return ['explicit', 'statistics', 'unrestricted'].includes(assessment.major);
}
export function opportunityOrder(assessment) {
  const cycle = { current: 0, unverified: 2, historical: 3 }[assessment.cycle] ?? 3;
  const major =
    { explicit: 0, statistics: 1, unrestricted: 1, related: 2, unknown: 3 }[assessment.major] ?? 3;
  return cycle * 10 + major;
}

/** Filters describe evidence, not guaranteed personal eligibility. */
export function matchesAssessment(
  assessment,
  { direction = 'all', major = 'all', cycle = 'all' } = {},
) {
  const directions = assessment.directions;
  return (
    (direction === 'all' ||
      (direction === 'broad'
        ? directions.some((value) => BROAD_TRACKS.includes(value))
        : directions.includes(direction))) &&
    (major === 'all' ||
      (major === 'supported' ? hasMajorEvidence(assessment) : major === assessment.major)) &&
    (cycle === 'all' || cycle === assessment.cycle)
  );
}
export function canActOnNotice(item, assessment, now = new Date()) {
  if (item.status !== 'open' || assessment.cycle !== 'current' || !hasMajorEvidence(assessment))
    return false;
  if (item.start) {
    const distance = dayDistance(item.start, now);
    if (!Number.isFinite(distance) || distance > 0) return false;
  }
  if (item.due) {
    const deadline = deadlineEpoch({ date: item.due, time: item.dueTime });
    if (!Number.isFinite(deadline) || now.getTime() >= deadline) return false;
  }
  return true;
}
