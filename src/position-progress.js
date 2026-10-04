export const POSITION_KEY = 'recsys:soe-position-progress:v1';
export const POSITION_STATES = Object.freeze({
  pending: '待处理',
  applied: '已投递',
  ignored: '不考虑',
});
export const POSITION_IMPORT_MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10000;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (id) => /^soe-[a-f0-9]{20}-[a-zA-Z0-9_-]{1,100}$/.test(id);
function validateEntries(entries) {
  if (!record(entries) || Object.keys(entries).length > MAX_ENTRIES)
    throw new Error('岗位进度必须是对象，且不超过10000条。');
  for (const [id, state] of Object.entries(entries)) {
    if (!validId(id) || typeof state !== 'string' || !Object.hasOwn(POSITION_STATES, state))
      throw new Error('备份含无效岗位ID或进度值；未导入任何记录。');
  }
  return { ...entries };
}
export function parsePositionProgress(text) {
  if (
    typeof text !== 'string' ||
    new TextEncoder().encode(text).byteLength > POSITION_IMPORT_MAX_BYTES
  )
    throw new Error('岗位进度备份不能超过1 MiB。');
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('文件不是有效的JSON岗位进度备份。');
  }
  if (
    !record(value) ||
    value.version !== 1 ||
    Object.keys(value).some((key) => !['version', 'storage', 'entries'].includes(key))
  )
    throw new Error('仅支持版本1的独立岗位进度备份，不接受账号或招聘资料导出。');
  return validateEntries(value.entries);
}
function readSnapshot(storage) {
  try {
    const raw = storage.getItem(POSITION_KEY);
    return {
      ok: true,
      entries: raw === null || raw === undefined ? {} : parsePositionProgress(raw),
    };
  } catch {
    return { ok: false, entries: {} };
  }
}
export function readPositionProgress(storage) {
  return readSnapshot(storage).entries;
}
export function writePositionProgress(storage, entries) {
  try {
    storage.setItem(POSITION_KEY, exportPositionProgress(entries));
    return true;
  } catch {
    return false;
  }
}
export function exportPositionProgress(entries) {
  const text = JSON.stringify(
    { version: 1, storage: '仅本机保存，不与账号同步', entries: validateEntries(entries) },
    null,
    2,
  );
  if (new TextEncoder().encode(text).byteLength > POSITION_IMPORT_MAX_BYTES)
    throw new Error('岗位进度超过1 MiB，不能保存为本格式。');
  return text;
}
export function summarizePositionImport(current, incoming, knownIds = new Set()) {
  const entries = validateEntries(incoming);
  const result = { total: 0, added: 0, changed: 0, unchanged: 0, unknown: 0 };
  for (const [id, state] of Object.entries(entries)) {
    result.total++;
    if (!Object.hasOwn(current, id)) result.added++;
    else if (current[id] !== state) result.changed++;
    else result.unchanged++;
    if (!knownIds.has(id)) result.unknown++;
  }
  return result;
}
/** Dirty edits win over old disk values until a complete local write succeeds.
 * Read/parse failures must not overwrite an unknown stored snapshot. This remains
 * a local last-write-wins store, not a cross-tab transaction or account sync. */
export function createPositionProgressStore(storage) {
  let entries = readPositionProgress(storage);
  let dirty = {};
  function refresh() {
    const disk = readSnapshot(storage);
    if (!disk.ok) return false;
    const merged = { ...disk.entries, ...dirty };
    try {
      exportPositionProgress(merged);
    } catch {
      // Preserve an exportable snapshot if another tab fills the local quota.
      return false;
    }
    entries = merged;
    return true;
  }
  function save() {
    const readable = refresh();
    entries = { ...entries, ...dirty };
    if (!readable || !writePositionProgress(storage, entries)) return false;
    dirty = {};
    return true;
  }
  function merge(incoming) {
    const checked = validateEntries(incoming);
    refresh();
    // Validate both count and serialized bytes against the latest readable disk
    // before changing dirty edits. Rejected imports are all-or-nothing.
    exportPositionProgress({ ...entries, ...checked });
    dirty = { ...dirty, ...checked };
    return save();
  }
  return {
    snapshot: () => ({ ...entries }),
    get unsaved() {
      return Object.keys(dirty).length > 0;
    },
    refresh,
    retry: save,
    set(id, state) {
      return merge({ [id]: state });
    },
    merge,
  };
}
