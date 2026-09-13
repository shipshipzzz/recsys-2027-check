import { SOE_TRACKS } from './soe-policy.js';
import { finalizeCatalog } from './catalog-model.js';

const RECORD = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const STATUSES = {
  rec: ['open', 'intern', 'wait', 'verify'],
  soe: ['open', 'soon', 'verify', 'watch', 'past'],
};
const stringList = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const validLinks = (value) =>
  Array.isArray(value) &&
  value.every(
    (link) =>
      Array.isArray(link) && link.length === 2 && link.every((part) => typeof part === 'string'),
  );
const idPattern = /^(rec|soe)-[a-f0-9]{20}$/;
export const CATALOG_CACHE_TTL = 24 * 60 * 60 * 1000;

/** A small runtime boundary guards fields consumed by the rendering code. */
export function validateRuntimeCatalog(value, kind) {
  if (
    !STATUSES[kind] ||
    !RECORD(value) ||
    value.PAGE_KIND !== kind ||
    !Array.isArray(value.DATA) ||
    !value.DATA.length ||
    !Array.isArray(value.ORIGINAL_ITEMS) ||
    !RECORD(value.SOURCES)
  )
    throw new Error('招聘资料结构不完整');
  if (value.EXTRA !== undefined && !Array.isArray(value.EXTRA))
    throw new Error('补充资料结构不完整');
  const ids = new Set();
  for (const item of [...value.DATA, ...(value.EXTRA || [])]) {
    if (
      !RECORD(item) ||
      !idPattern.test(item.id) ||
      !item.id.startsWith(kind + '-') ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !STATUSES[kind].includes(item.status)
    )
      throw new Error('招聘卡片字段或标识无效');
    ids.add(item.id);
    if (
      item.links !== undefined &&
      (!Array.isArray(item.links) ||
        item.links.some(
          (link) =>
            !Array.isArray(link) ||
            link.length !== 2 ||
            link.some((part) => typeof part !== 'string'),
        ))
    )
      throw new Error('招聘链接结构无效');
    if (
      item.audit !== undefined &&
      (!RECORD(item.audit) || (item.audit.refs !== undefined && !stringList(item.audit.refs)))
    )
      throw new Error('核查记录结构无效');
    if (
      kind === 'soe' &&
      (!Number.isFinite(item.fit) ||
        item.fit < 0 ||
        item.fit > 100 ||
        !['S', 'A+', 'A', 'B+', 'B', 'C'].includes(item.tier) ||
        !Object.hasOwn(SOE_TRACKS, item.track))
    )
      throw new Error('匹配分或岗位分类无效');
  }
  if (
    value.ORIGINAL_ITEMS.some(
      (item) => !RECORD(item) || (item.links !== undefined && !validLinks(item.links)),
    )
  )
    throw new Error('历史记录结构无效');
  if (
    kind === 'rec' &&
    Object.values(value.REC_DEADLINES || {}).some(
      (event) =>
        event !== null &&
        (!RECORD(event) ||
          typeof event.date !== 'string' ||
          (event.refs !== undefined && !stringList(event.refs))),
    )
  )
    throw new Error('截止节点结构无效');
  if (
    kind === 'rec' &&
    (value.TIMELINE_EVENTS || []).some(
      (event) => event?.refs !== undefined && !stringList(event.refs),
    )
  )
    throw new Error('时间节点来源无效');
  if (Object.values(value.SOURCES).some((source) => !RECORD(source)))
    throw new Error('来源结构无效');
  if (
    kind === 'rec' &&
    (!Array.isArray(value.LOG) ||
      !RECORD(value.KIND) ||
      !RECORD(value.DUE) ||
      !RECORD(value.REC_DEADLINES) ||
      !Array.isArray(value.TIMELINE_EVENTS))
  )
    throw new Error('时间线结构无效');
  if (
    kind === 'rec' &&
    value.LOG.some(
      (log) =>
        !RECORD(log) ||
        !Array.isArray(log.items) ||
        log.items.some((item) => !Array.isArray(item) || !Array.isArray(value.KIND[item[0]])),
    )
  )
    throw new Error('更新日志结构无效');
  if (
    kind === 'rec' &&
    value.TIMELINE_EVENTS.some((event) => !RECORD(event) || typeof event.date !== 'string')
  )
    throw new Error('时间节点结构无效');
  return value;
}

/** Render synchronously from a bounded cache/snapshot; refresh independently of auth. */
export function createCatalogResource({
  kind,
  fallback,
  fetchCatalog,
  storage,
  namespace = 'default',
  now = Date.now,
  maxAgeMs = CATALOG_CACHE_TTL,
}) {
  validateRuntimeCatalog(fallback, kind);
  const minimumIds = new Set([...fallback.DATA, ...(fallback.EXTRA || [])].map((item) => item.id));
  const validateBaseline = (data) => {
    const ids = new Set([...data.DATA, ...(data.EXTRA || [])].map((item) => item.id));
    if (data.RECHECKED < fallback.RECHECKED || [...minimumIds].some((id) => !ids.has(id)))
      throw new Error(
        '云端或缓存资料版本落后于当前页面，保留完整的本地资料；待发布同步完成后重试。',
      );
    return data;
  };
  const cacheKey = 'recsys:catalog:v2:' + namespace + ':' + kind;
  let current = finalizeCatalog(structuredClone(fallback));
  current.connection = 'fallback';
  try {
    const cached = JSON.parse(storage?.getItem(cacheKey) || 'null');
    if (
      cached?.version === 2 &&
      Number.isFinite(cached.savedAt) &&
      now() >= cached.savedAt &&
      now() - cached.savedAt <= maxAgeMs &&
      cached.catalog.RECHECKED >= fallback.RECHECKED
    ) {
      validateBaseline(validateRuntimeCatalog(cached.catalog, kind));
      current = finalizeCatalog(cached.catalog);
      current.connection = 'cached';
      current.cachedAt = cached.savedAt;
    }
  } catch {
    /* Corrupt, expired or inaccessible cache never blocks the bundled snapshot. */
  }
  let inFlight = null,
    lastError = null;
  return {
    cacheKey,
    get current() {
      return current;
    },
    get lastError() {
      return lastError;
    },
    get refreshing() {
      return inFlight !== null;
    },
    refresh() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const data = validateBaseline(validateRuntimeCatalog(await fetchCatalog(), kind));
          current = finalizeCatalog(data);
          current.connection = 'cloud';
          current.cachedAt = now();
          lastError = null;
          try {
            const {
              ALL_ITEMS: _items,
              connection: _connection,
              cachedAt: _cachedAt,
              ...catalog
            } = current;
            storage?.setItem(cacheKey, JSON.stringify({ version: 2, savedAt: now(), catalog }));
          } catch {
            /* Cache is optional; successfully fetched data remains usable. */
          }
        } catch (error) {
          lastError = error;
        }
        return current;
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
