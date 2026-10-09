import { SOURCE_PREFIXES, HISTORY_SOURCES } from '../catalog-kinds.js';

/** Include every cited source, while keeping unrelated cloud-page sources out. */
export function sourceIdsForPage(catalog) {
  const refs = new Set();
  const include = (ids = []) => ids.forEach((id) => refs.add(id));
  const items = catalog.ALL_ITEMS || [...(catalog.DATA || []), ...(catalog.EXTRA || [])];
  for (const item of items) include(item.audit?.refs);
  for (const event of Object.values(catalog.REC_DEADLINES || {})) include(event?.refs);
  for (const event of catalog.TIMELINE_EVENTS || []) include(event.refs);
  const prefix = SOURCE_PREFIXES[catalog.PAGE_KIND];
  const historical = HISTORY_SOURCES[catalog.PAGE_KIND];
  return Object.keys(catalog.SOURCES || {}).filter(
    (id) => (prefix && id.startsWith(prefix)) || (historical && id === historical) || refs.has(id),
  );
}
