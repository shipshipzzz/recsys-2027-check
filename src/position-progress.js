export const POSITION_KEY = 'recsys:soe-position-progress:v1';
export const POSITION_STATES = { pending: '待处理', applied: '已投递', ignored: '不考虑' };
const validId = (id) => /^soe-[a-f0-9]{20}-[a-zA-Z0-9_-]+$/.test(id);
export function readPositionProgress(storage) {
  try {
    const value = JSON.parse(storage.getItem(POSITION_KEY) || '{}');
    if (value.version !== 1 || !value.entries || typeof value.entries !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value.entries).filter(
        ([id, state]) => validId(id) && Object.hasOwn(POSITION_STATES, state),
      ),
    );
  } catch {
    return {};
  }
}
export function writePositionProgress(storage, entries) {
  try {
    if (
      Object.entries(entries).some(
        ([id, state]) => !validId(id) || !Object.hasOwn(POSITION_STATES, state),
      )
    )
      return false;
    storage.setItem(POSITION_KEY, exportPositionProgress(entries));
    return true;
  } catch {
    return false;
  }
}
export function exportPositionProgress(entries) {
  return JSON.stringify({ version: 1, storage: '仅本机保存，不与账号同步', entries }, null, 2);
}
