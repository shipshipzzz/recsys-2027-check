import { opportunityOrder, BROAD_TRACKS } from './soe-policy.js';
import { deadlineEpoch, dayDistance } from './shared/time.js';
/** 地域偏好只加分，不替代专业、批次与岗位质量审查。 */
export const LOCATION_POLICY_VERSION = 'preferred-cities-v1';
export const PRIORITY_CITIES = Object.freeze(['杭州', '成都', '重庆', '西安']);
export const ZHEJIANG_CITIES = Object.freeze([
  '杭州',
  '宁波',
  '温州',
  '嘉兴',
  '湖州',
  '绍兴',
  '金华',
  '衢州',
  '舟山',
  '台州',
  '丽水',
]);
export const LOCATION_LEVELS = Object.freeze({
  position: '对应岗位工作地',
  campaign: '本届招聘范围',
  historical: '历史地点待复核',
  headquarters: '仅总部/业务覆盖，不加分',
});
export const LOCATION_WEIGHTS = Object.freeze({
  position: { priority: 8, zhejiang: 6 },
  campaign: { priority: 4, zhejiang: 3 },
});
export function locationFacts(item, sources = {}) {
  return JSON.stringify([
    item.id,
    item.name,
    item.city,
    item.jobs,
    item.req ?? '',
    item.window ?? '',
    item.status,
    item.due ?? null,
    item.dueTime ?? null,
    item.audit?.checked ?? null,
    item.audit?.summary ?? '',
    item.audit?.scope ?? '',
    (item.audit?.refs || []).map((id) => [
      id,
      sources[id]?.url ?? '',
      sources[id]?.checked ?? null,
      sources[id]?.scope ?? '',
    ]),
  ]);
}
export function createLocationLookup(policy, baseline) {
  const originals = new Map(
    baseline.DATA.map((item) => [item.id, locationFacts(item, baseline.SOURCES)]),
  );
  const cache = new WeakMap();
  return (item, sources) => {
    const previous = cache.get(item);
    if (previous?.sources === sources) return previous.value;
    const row = policy.entries[item.id];
    const value =
      row && originals.get(item.id) === locationFacts(item, sources)
        ? { ...row, matched: true }
        : { matched: false, locations: [], current: false };
    cache.set(item, { sources, value });
    return value;
  };
}
export function locationsForDirection(assessment, direction = 'all') {
  return (assessment.locations || []).filter(
    (place) =>
      direction === 'all' ||
      (direction === 'broad'
        ? place.directions.some((value) => BROAD_TRACKS.includes(value))
        : place.directions.includes(direction)),
  );
}
export function locationBonus(assessment, direction = 'all') {
  if (!assessment?.matched || !assessment.current) return 0;
  return Math.max(
    0,
    ...locationsForDirection(assessment, direction).map((place) => {
      const weight = LOCATION_WEIGHTS[place.level];
      return weight
        ? PRIORITY_CITIES.includes(place.city)
          ? weight.priority
          : place.province === '浙江'
            ? weight.zhejiang
            : 0
        : 0;
    }),
  );
}
export function matchesLocation(assessment, choice, direction = 'all') {
  if (choice === 'all') return true;
  if (!assessment?.matched || !assessment.current) return false;
  if (choice === 'preferred') return locationBonus(assessment, direction) > 0;
  return locationsForDirection(assessment, direction).some(
    (place) =>
      ['position', 'campaign'].includes(place.level) &&
      (choice === '浙江' ? place.province === '浙江' : place.city === choice),
  );
}

/** Never let geography promote an expired window or override a qualification evidence tier. */
export function preferenceStage(item, assessment, now = new Date()) {
  if (item.status === 'past') return 4;
  if (item.due) {
    const end = deadlineEpoch({ date: item.due, time: item.dueTime });
    if (Number.isFinite(end) && now.getTime() >= end) return 4;
  }
  if (assessment.cycle === 'historical') return 3;
  if (assessment.cycle !== 'current') return 2;
  if (item.status === 'soon' || (item.start && dayDistance(item.start, now) > 0)) return 1;
  return 0;
}
export function comparePreferredOpportunities(
  a,
  b,
  assessmentA,
  assessmentB,
  geographyA,
  geographyB,
  now = new Date(),
  direction = 'all',
) {
  return (
    preferenceStage(a, assessmentA, now) - preferenceStage(b, assessmentB, now) ||
    opportunityOrder(assessmentA) - opportunityOrder(assessmentB) ||
    b.fit + locationBonus(geographyB, direction) - (a.fit + locationBonus(geographyA, direction)) ||
    (a.priority ?? 0) - (b.priority ?? 0) ||
    a.id.localeCompare(b.id)
  );
}
