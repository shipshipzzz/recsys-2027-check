export const TZ = 'Asia/Shanghai';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function chinaDay(value = new Date()) {
  const p = dayFormatter.formatToParts(value);
  return ['year', 'month', 'day'].map((k) => p.find((x) => x.type === k).value).join('-');
}
export function dayDistance(iso, now = new Date()) {
  return iso
    ? Math.round(
        (Date.parse(iso + 'T00:00:00+08:00') - Date.parse(chinaDay(now) + 'T00:00:00+08:00')) /
          86400000,
      )
    : null;
}
export function deadlineEpoch(ev) {
  if (!ev || !ev.date) return null;
  // A missing clock time is not asserted as an official 23:59 cutoff.
  // End-of-day below is only used to turn the calendar-day badge after that date ends.
  if (!ev.time || ev.time === '24:00') return Date.parse(ev.date + 'T00:00:00+08:00') + 86400000;
  return Date.parse(ev.date + 'T' + (ev.time.length === 5 ? ev.time + ':00' : ev.time) + '+08:00');
}
export function timeState(ev, now = new Date()) {
  if (!ev || !ev.date || !Number.isFinite(deadlineEpoch(ev)))
    return { days: null, expired: false, label: '未见统一截止', cls: 'u-none' };
  const days = dayDistance(ev.date, now),
    end = deadlineEpoch(ev),
    expired = now.getTime() >= end;
  const pending = !['confirmed', 'supported'].includes(ev.confidence),
    special = ['special', 'advisory'].includes(ev.kind);
  let label = expired
    ? pending || special
      ? '原节点已过'
      : '该窗口已过'
    : days === 0
      ? pending
        ? '今天节点·待核'
        : ev.time
          ? '今天 ' + ev.time
          : '今天节点·时刻未注明'
      : `${days} 天后${pending ? '·待核' : ''}`;
  if (!expired && days > 0 && !pending && !special) label = `还剩 ${days} 天`;
  const cls = expired
    ? 'u-past'
    : pending || special
      ? 'u-none'
      : days <= 14
        ? 'u-hot'
        : days <= 45
          ? 'u-soon'
          : 'u-far';
  return { days, expired, label, cls, iso: ev.date, event: ev };
}
