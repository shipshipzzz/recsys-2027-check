import { assessmentFacts, canActOnNotice } from './soe-policy.js';
import { timeState, deadlineEpoch } from './shared/time.js';

export const REVIEW_STATES = {
  reviewed_current: '已核当届子集',
  covered_existing: '已有入口覆盖',
  historical_only: '仅历史资料',
  attempted_unresolved: '尝试核查未解决',
  not_reviewed: '未检查',
};
export function createOpportunityLookup(policy, baseline, screening) {
  const facts = new Map(
    baseline.DATA.map((item) => [item.id, assessmentFacts(item, baseline.SOURCES)]),
  );
  return (item, sources) => {
    const row = policy.entries?.[item.id];
    const matched =
      !!row &&
      row.basisHash === screening.entries[item.id]?.basisHash &&
      facts.get(item.id) === assessmentFacts(item, sources);
    return {
      matched,
      stale: !!row && !matched,
      scope: row?.scope || '',
      positions: matched ? row.positions : [],
    };
  };
}
export function positionDeadline(position) {
  return position.due
    ? {
        date: position.due,
        time: position.dueTime,
        kind: 'deadline',
        confidence: position.cycle === 'current' && position.refs?.length ? 'supported' : 'pending',
        scope: position.name + ' · ' + position.deadlineScope,
        refs: position.refs,
        note:
          '日期依据与个人资格独立；' +
          (position.type === 'internship' ? '实习窗口，不代表正式校招。' : '正式校招岗位。'),
      }
    : null;
}
export function noticeDeadline(item, assessment, opportunities, sources, now = new Date()) {
  if (opportunities.matched) {
    const events = opportunities.positions
      .filter((p) => p.cycle !== 'historical' && p.status !== 'past')
      .map(positionDeadline)
      .filter(Boolean)
      .filter((e) => !timeState(e, now).expired);
    return events.sort((a, b) => deadlineEpoch(a) - deadlineEpoch(b))[0] || null;
  }
  if (!item.due) return null;
  const supported =
    !opportunities.stale &&
    assessment.matched &&
    assessment.cycle === 'current' &&
    !!item.dueScope &&
    item.audit?.refs?.some((ref) => sources[ref]?.url);
  return {
    date: item.due,
    time: item.dueTime || null,
    kind: 'deadline',
    confidence: supported ? 'supported' : 'pending',
    scope: item.dueScope || '原节点范围待核',
    refs: item.audit?.refs || [],
    note: supported ? '有当届日期依据；个人资格仍须核对。' : '日期或批次待核，不代表可投。',
  };
}
export function noticeActionable(item, assessment, opportunities, now = new Date()) {
  if (opportunities.stale) return false;
  if (opportunities.matched)
    return opportunities.positions.some((p) => p.type === 'campus' && canActOnNotice(p, p, now));
  return canActOnNotice(item, assessment, now);
}
export function deadlineUrgency(item, assessment, opportunities, sources, now = new Date()) {
  const event = noticeDeadline(item, assessment, opportunities, sources, now);
  const state = timeState(event, now);
  if (assessment.cycle === 'historical' || (!opportunities.matched && item.status === 'past'))
    return null;
  if (state.days === null || state.expired || state.days > 21) return null;
  return event.confidence === 'supported' ? 'supported' : 'pending';
}
export function directoryMatch(directory, itemId, query) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return directory.groups.some(
    (group) =>
      group.entryIds.includes(itemId) &&
      [
        group.name,
        ...group.aliases,
        ...(group.hqEntryIds.includes(itemId) ? ['总行', '总部'] : []),
      ].some((name) => name.toLocaleLowerCase().includes(q)),
  );
}
export function hasHeadquartersClue(directory, id) {
  return directory.groups.some((group) => group.hqEntryIds.includes(id));
}
