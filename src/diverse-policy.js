import { timeState } from './shared/time.js';
export const DIVERSE_CATEGORIES = Object.freeze({
  foreign: '外企',
  research: '科研机构',
  education: '高校与学校',
  finance: '金融与量化',
  industry: '工业与科技',
  services: '咨询与专业服务',
  other: '特色行业',
});
export const DIVERSE_TRACKS = Object.freeze({
  ai: 'AI / 算法',
  data: '统计 / 数据分析',
  quant: '量化 / 风险',
  operations: '经营 / 运营',
  supply: '供应链 / 运筹',
  software: '软件 / 数字化',
  research: '科研',
  education: '教学 / 教辅',
  consulting: '咨询 / 市场研究',
});
export const DIVERSE_MAJORS = Object.freeze({
  explicit: '明确应用统计',
  statistics: '统计等相关专业',
  unrestricted: '具体岗位不限专业',
  related: '专业认可待确认',
  unknown: '专业条件未读全',
});
export const DIVERSE_CYCLES = Object.freeze({
  current: '2027 当届依据',
  unverified: '届次 / 到岗待核',
  historical: '往届依据',
});
export const DIVERSE_LEADERSHIP = Object.freeze({
  not_stated: '已读条件未要求学生干部',
  preferred: '学生干部经历优先',
  required: '学生干部经历为硬条件',
  unknown: '学生干部条件未核',
});
export const DIVERSE_EMPLOYMENT = Object.freeze({
  fulltime: '全职招聘',
  project: '科研 / 项目聘用',
  internship: '实习 / 留用另核',
  unknown: '用工方式待核',
});
export const DIVERSE_STATUS = Object.freeze({
  open: '公告 / 职位开放 · 资格另核',
  verify: '具体资格 / 窗口待核',
  watch: '待核线索',
  intern: '实习 · 非全职录用',
  soon: '待开放',
  past: '本窗口已过',
});
export const POSITION_ID = /^div-[a-f0-9]{20}-[a-z0-9-]{1,40}$/;

/** Complete public card + cited evidence, not the page's publication date. */
export function diverseFacts(item, sources) {
  const stable = (value) =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter((k) => !['connection'].includes(k))
              .map((k) => [k, stable(value[k])]),
          )
        : value;
  const refs = item.audit?.refs || [];
  return JSON.stringify(
    stable({ item, sources: Object.fromEntries(refs.map((id) => [id, sources[id] || null])) }),
  );
}
export function createDiverseLookup(policy, baseline) {
  const facts = new Map(
    [...baseline.DATA, ...(baseline.EXTRA || [])].map((item) => [
      item.id,
      diverseFacts(item, baseline.SOURCES),
    ]),
  );
  return (item, sources) => {
    const row = policy.entries[item.id];
    if (row && facts.get(item.id) === diverseFacts(item, sources)) return { ...row, matched: true };
    return {
      category: row?.category || 'other',
      matched: false,
      positions: [],
      basis: '招聘资料与已审核快照不一致。原岗位资格、地区和干部要求不再自动沿用，请重新核查。',
    };
  };
}
export function majorSupported(major) {
  return ['explicit', 'statistics', 'unrestricted'].includes(major);
}
export function positionWindow(position, now = new Date()) {
  const timing = timeState(
    position.deadline ? { ...position.deadline, confidence: 'supported', kind: 'deadline' } : null,
    now,
  );
  const closed = position.status === 'past';
  return {
    ...timing,
    expired: timing.expired || closed,
    label: closed ? '本窗口已过' : timing.label,
    status: timing.expired || closed ? 'past' : position.status,
  };
}
/** Query words are ANDed within the same role, with only employer identity shared. */
export function queryMatches(query, parts) {
  const text = parts
    .filter((part) => part != null)
    .join(' ')
    .toLowerCase();
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}
/** All filters, including search, must match ONE position. */
export function positionMatches(position, filters = {}, now = new Date(), employer = {}) {
  const f = {
    direction: 'all',
    city: 'all',
    major: 'all',
    cycle: 'all',
    employment: 'all',
    leadership: 'hide_required',
    status: 'all',
    query: '',
    ...filters,
  };
  const window = positionWindow(position, now);
  return (
    queryMatches(f.query, [
      employer.name,
      employer.en,
      position.title,
      position.requirements,
      position.restrictions,
      ...position.cities,
      ...position.directions.map((value) => DIVERSE_TRACKS[value]),
    ]) &&
    (f.direction === 'all' || position.directions.includes(f.direction)) &&
    (f.city === 'all' || position.cities.includes(f.city)) &&
    (f.major === 'all' ||
      (f.major === 'supported' ? majorSupported(position.major) : f.major === position.major)) &&
    (f.cycle === 'all' || f.cycle === position.cycle) &&
    (f.employment === 'all' || f.employment === position.employment) &&
    (f.leadership === 'all' ||
      (f.leadership === 'hide_required'
        ? position.leadership !== 'required'
        : position.leadership === f.leadership)) &&
    (f.status === 'all' ||
      (f.status === 'urgent'
        ? !['past', 'watch'].includes(window.status) &&
          window.days !== null &&
          !window.expired &&
          window.days <= 14 &&
          position.cycle === 'current'
        : f.status === window.status))
  );
}
export function matchingPositions(assessment, filters = {}, now, employer = {}) {
  if (
    !assessment.matched ||
    (filters.category && filters.category !== 'all' && assessment.category !== filters.category)
  )
    return [];
  return assessment.positions.filter((position) =>
    positionMatches(position, filters, now, employer),
  );
}
export function diverseOrder(assessment, now = new Date()) {
  if (!assessment.matched) return 90;
  const scores = assessment.positions.map((p) =>
    p.leadership === 'required'
      ? 95
      : positionWindow(p, now).status === 'past'
        ? 80
        : p.status === 'watch'
          ? 70
          : p.cycle !== 'current'
            ? 60
            : majorSupported(p.major)
              ? 0
              : 20,
  );
  return Math.min(100, ...scores);
}
