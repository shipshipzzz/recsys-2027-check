// Explicit, queryable columns for current recruitment facts. JSON is reserved for
// historical snapshots and ordered log details, not the live card record.
export const FIELD_MAP = {
  status: ['status', 'text not null'],
  rec: ['recommendation', 'text'],
  src: ['source_type', 'text'],
  opened: ['opened', 'text'],
  closes: ['closes', 'text'],
  window: ['graduation_window', 'text'],
  city: ['city', 'text'],
  jobs: ['jobs', 'text'],
  req: ['requirements', 'text'],
  note: ['note', 'text'],
  rev: ['reviewed_on', 'date'],
  fit: ['fit', 'integer check (fit between 0 and 100)'],
  tier: ['tier', 'text'],
  track: ['track', 'text'],
  ownership: ['ownership', 'text'],
  xian: ['includes_xian', 'boolean'],
  due: ['due_on', 'date'],
  dueAlt: ['due_alternative', 'text'],
  dueTime: ['due_time', 'text'],
  dueScope: ['due_scope', 'text'],
  start: ['starts_on', 'date'],
  action: ['next_action', 'text'],
  why: ['fit_reason', 'text'],
  risk: ['risk', 'text'],
  resume: ['resume_advice', 'text'],
  evidence: ['evidence', 'text'],
  priority: ['priority', 'integer'],
};
export const VALID_STATES = Object.freeze(['active', 'applied', 'uninterested']);
export function normalizeState(value) {
  return VALID_STATES.includes(value) ? value : 'active';
}
export function isMuted(value) {
  return normalizeState(value) !== 'active';
}
export function comparePersonal(a, b, states) {
  return Number(isMuted(states[a.id]?.status)) - Number(isMuted(states[b.id]?.status));
}
export function finalizeCatalog(data) {
  data.EXTRA ||= [];
  data.ALL_ITEMS = data.DATA.concat(data.EXTRA);
  return data;
}
export function hydrateCatalog(kind, rows, sources, archive, logs, timeline) {
  const data = {
    PAGE_KIND: kind,
    RECHECKED: archive.checked_on,
    DATA: [],
    EXTRA: [],
    ORIGINAL_ITEMS: archive.original_items,
    SOURCES: {},
    DUE: archive.legacy_due,
    TIMELINE: archive.legacy_timeline,
    KIND: archive.kind_labels,
    LOG: [],
    REC_DEADLINES: {},
    TIMELINE_EVENTS: [],
  };
  for (const s of sources) {
    data.SOURCES[s.id] = {
      id: s.id,
      title: s.title,
      url: s.url,
      level: s.level,
      scope: s.scope,
      access: s.access,
      checked: s.checked_on,
    };
    if (s.published !== null && s.published !== undefined)
      data.SOURCES[s.id].published = s.published;
  }
  for (const row of [...rows].sort((a, b) => a.sort_order - b.sort_order)) {
    const company = row.companies;
    if (!company) throw new Error('公司关联资料不完整');
    const item = { id: row.id, name: company.name, en: company.english_name };
    for (const [field, [column]] of Object.entries(FIELD_MAP))
      if (row[column] !== null && row[column] !== undefined) item[field] = row[column];
    item.links = [...(row.entry_links || [])]
      .sort((a, b) => a.position - b.position)
      .map((x) => [x.label, x.url]);
    const audit = Array.isArray(row.entry_audits) ? row.entry_audits[0] : row.entry_audits;
    if (audit)
      item.audit = {
        checked: audit.checked_on,
        summary: audit.summary,
        scope: audit.scope,
        level: audit.level,
        refs: [...(row.job_sources || [])]
          .sort((a, b) => a.position - b.position)
          .map((x) => x.source_id),
      };
    const deadline = Array.isArray(row.entry_deadlines)
      ? row.entry_deadlines[0]
      : row.entry_deadlines;
    if (row.has_deadline_override)
      data.REC_DEADLINES[item.name] = deadline
        ? {
            date: deadline.event_on,
            time: deadline.event_time,
            kind: deadline.event_kind,
            scope: deadline.scope,
            confidence: deadline.confidence,
            refs: deadline.source_ids,
            note: deadline.note,
          }
        : null;
    (row.section === 'extra' ? data.EXTRA : data.DATA).push(item);
  }
  data.LOG = [...logs]
    .sort((a, b) => a.position - b.position)
    .map((x) => ({ date: x.event_on, title: x.title, summary: x.summary, items: x.items }));
  data.TIMELINE_EVENTS = [...timeline]
    .sort((a, b) => a.position - b.position)
    .map((x) => {
      const event = {
        date: x.event_on,
        kind: x.event_kind,
        text: x.text,
        refs: x.source_ids,
        confidence: x.confidence,
        note: x.note,
      };
      if (x.event_time) event.time = x.event_time;
      if (x.original_text !== null) event.originalText = x.original_text;
      if (x.original_index !== null) event.originalIndex = x.original_index;
      return event;
    });
  if (data.DATA.length === 0) throw new Error('云端卡片为空，使用本地资料');
  return finalizeCatalog(data);
}
