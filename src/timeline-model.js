import { safeHref } from './shared/dom.js';

export const TIMELINE_TYPES = Object.freeze({
  assessment: '测评',
  written_test: '笔试',
  interview: '面试',
  other: '其他',
});
export const TIMELINE_STATUSES = Object.freeze({
  pending: '待完成',
  completed: '已完成',
  cancelled: '已取消',
});
export const isUUID = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('时间必须包含有效时区');
  return new Date(value).toISOString();
}

/** datetime-local means Beijing wall time here, never the device timezone. */
export function toBeijingInput(value) {
  if (!value) return '';
  return new Date(Date.parse(timestamp(value)) + OFFSET).toISOString().slice(0, 16);
}
export function fromBeijingInput(value) {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$|^21\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('请填写 2000—2199 年的有效日期和时间');
  const result = timestamp(value + ':00+08:00');
  if (toBeijingInput(result) !== value) throw new Error('日期或时间不存在');
  return result;
}

function text(value, label, max, required = false) {
  if (typeof value !== 'string') throw new Error(label + '格式不正确');
  const result = value.trim();
  if ((required && !result) || result.length > max || result.includes('\0'))
    throw new Error(label + (required ? '不能为空，且' : '') + '不能超过 ' + max + ' 个字符');
  return result;
}

/** Return only the editable public schema of one private event, not cache/auth metadata. */
export function normalizeTimelineEvent(value) {
  if (!value || !isUUID(value.id)) throw new Error('日程标识无效');
  if (!Object.hasOwn(TIMELINE_TYPES, value.event_type)) throw new Error('日程类型无效');
  if (!Object.hasOwn(TIMELINE_STATUSES, value.status)) throw new Error('日程状态无效');
  if (value.entry_id != null && !/^(rec|soe)-[a-f0-9]{20}$/.test(value.entry_id))
    throw new Error('关联卡片无效');
  if (typeof value.is_deleted !== 'boolean') throw new Error('删除标记无效');
  const starts_at = timestamp(value.starts_at);
  const ends_at = value.ends_at == null ? null : timestamp(value.ends_at);
  const start = toBeijingInput(starts_at);
  if (start < '2000-01-01T00:00' || start >= '2200-01-01T00:00')
    throw new Error('日程日期超出支持范围');
  if (
    ends_at &&
    (Date.parse(ends_at) <= Date.parse(starts_at) || toBeijingInput(ends_at) >= '2200-01-01T00:00')
  )
    throw new Error('结束 / 截止时间必须晚于开始时间');
  const url = text(value.url ?? '', '会议 / 测评链接', 2048);
  if (url && safeHref(url) === '#')
    throw new Error('链接仅支持不含账号密码的完整 HTTP / HTTPS 地址');
  return {
    id: value.id,
    entry_id: value.entry_id ?? null,
    title: text(value.title, '日程名称', 160, true),
    company_name: text(value.company_name ?? '', '公司 / 单位', 160),
    event_type: value.event_type,
    starts_at,
    ends_at,
    status: value.status,
    location: text(value.location ?? '', '地点 / 平台', 300),
    url: url ? text(safeHref(url), '会议 / 测评链接', 2048) : '',
    notes: text(value.notes ?? '', '备注', 2000),
    is_deleted: value.is_deleted,
  };
}

export function timelinePhase(event, now = Date.now()) {
  if (event.status !== 'pending') return event.status;
  if (now >= Date.parse(event.ends_at || event.starts_at)) return 'overdue';
  if (now >= Date.parse(event.starts_at)) return 'ongoing';
  return 'upcoming';
}
export function matchesTimeline(
  event,
  { type = 'all', status = 'all', period = 'all', query = '' } = {},
  now = Date.now(),
) {
  if (
    event.is_deleted ||
    (type !== 'all' && event.event_type !== type) ||
    (status !== 'all' && event.status !== status)
  )
    return false;
  const q = query.trim().toLocaleLowerCase();
  if (
    q &&
    ![event.title, event.company_name, event.location, event.notes].some((v) =>
      v.toLocaleLowerCase().includes(q),
    )
  )
    return false;
  const start = Date.parse(event.starts_at),
    end = Date.parse(event.ends_at || event.starts_at);
  const dayStart = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  if (period === 'today') return start < dayStart + DAY && end >= dayStart;
  if (period === 'week') return start < dayStart + 7 * DAY && end >= now;
  if (period === 'overdue') return timelinePhase(event, now) === 'overdue';
  return true;
}
export function sortTimeline(events) {
  return [...events].sort(
    (a, b) =>
      Number(a.status !== 'pending') - Number(b.status !== 'pending') ||
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      a.id.localeCompare(b.id),
  );
}
export function timelineCounts(events, now = Date.now()) {
  const visible = events.filter((e) => !e.is_deleted);
  return {
    pending: visible.filter((e) => e.status === 'pending').length,
    today: visible.filter((e) => matchesTimeline(e, { status: 'pending', period: 'today' }, now))
      .length,
    overdue: visible.filter((e) => timelinePhase(e, now) === 'overdue').length,
    completed: visible.filter((e) => e.status === 'completed').length,
  };
}
