import catalogURL from '../../data/div.json?url';
import screeningURL from '../../data/div-screening.json?url';
import { loadJSON } from '../shared/json-loader.js';
import { createPageCatalog } from '../backend.js';
import { createPersonalManager } from '../personal.js';
import { createCatalogView } from '../shared/catalog-view.js';
import { escapeHTML as esc, createCardRenderer, bindSearch } from '../shared/dom.js';
import { chinaDay, deadlineEpoch } from '../shared/time.js';
import { PAGE_FILES, THEME_KEYS } from '../catalog-kinds.js';
import {
  DIVERSE_CATEGORIES,
  DIVERSE_TRACKS,
  DIVERSE_MAJORS,
  DIVERSE_CYCLES,
  DIVERSE_LEADERSHIP,
  DIVERSE_EMPLOYMENT,
  DIVERSE_STATUS,
  createDiverseLookup,
  matchingPositions,
  positionWindow,
  diverseOrder,
  queryMatches,
} from '../diverse-policy.js';

const [fallback, screening] = await Promise.all([loadJSON(catalogURL), loadJSON(screeningURL)]);
const lookup = createDiverseLookup(screening, fallback);
const resource = createPageCatalog('div', fallback);
let catalog = resource.current;
const renderer = createCardRenderer();
const personal = createPersonalManager('div', catalog, {
  renderer,
  onRefreshCatalog: refreshCatalog,
});
const assessmentFor = (item) => lookup(item, catalog.SOURCES);
const view = createCatalogView(
  () => catalog,
  () => null,
  () => ({
    screening: {
      ...screening,
      entries: Object.fromEntries(catalog.ALL_ITEMS.map((item) => [item.id, assessmentFor(item)])),
    },
  }),
);
const lifetime = new AbortController();
const listen = (node, event, fn) => node.addEventListener(event, fn, { signal: lifetime.signal });
const ids = [
  'category',
  'direction',
  'city',
  'cycle',
  'major',
  'employment',
  'leadership',
  'status',
];
const controls = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const grid = document.getElementById('grid');
function options(node, labels, first = '全部', retainMissing = false) {
  const old = node.value;
  const oldLabel = node.selectedOptions[0]?.textContent;
  node.replaceChildren(
    ...Object.entries({ all: first, ...labels }).map(([value, label]) => new Option(label, value)),
  );
  if (retainMissing && old && ![...node.options].some((option) => option.value === old))
    node.append(new Option(oldLabel || old + '（证据待核）', old));
  if ([...node.options].some((option) => option.value === old)) node.value = old;
}
function buildFilters() {
  options(controls.category, DIVERSE_CATEGORIES, '全部单位');
  options(controls.direction, DIVERSE_TRACKS, '全部方向');
  options(controls.cycle, DIVERSE_CYCLES, '全部届次');
  options(controls.major, { supported: '有专业依据（仍需资审）', ...DIVERSE_MAJORS });
  options(controls.employment, DIVERSE_EMPLOYMENT);
  options(controls.leadership, { hide_required: '隐藏硬性干部要求', ...DIVERSE_LEADERSHIP });
  options(controls.status, { urgent: '14 天内有据截止', ...DIVERSE_STATUS });
  const cities = [
    ...new Set(
      catalog.ALL_ITEMS.flatMap((item) => assessmentFor(item).positions.flatMap((p) => p.cities)),
    ),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  options(
    controls.city,
    Object.fromEntries(cities.map((city) => [city, city])),
    '全国 / 不限地区',
    true,
  );
}
buildFilters();
controls.leadership.value = 'hide_required';
document.getElementById('advanced-filters').open = matchMedia('(min-width: 1000px)').matches;
const initialQuery = new URLSearchParams(location.search).get('q');
if (initialQuery) document.getElementById('q').value = initialQuery.slice(0, 500);
const filters = () => ({
  ...Object.fromEntries(ids.map((id) => [id, controls[id].value])),
  query: document.getElementById('q').value,
});
function selectedRoles(item, f = filters()) {
  return matchingPositions(assessmentFor(item), f, undefined, item);
}
function tag(text, cls = '') {
  return `<span class="div-tag ${cls}">${esc(text)}</span>`;
}
function positionHTML(p, matchedIds) {
  const timing = positionWindow(p);
  const date = p.deadline
    ? p.deadline.date + (p.deadline.time ? ' ' + p.deadline.time : '（时刻未注明）')
    : '未见明确截止';
  const match = matchedIds.has(p.id);
  return `<section class="div-position${match ? '' : ' is-other'}" data-position-id="${esc(p.id)}"><h4>${esc(p.title)}</h4>
    <div class="div-badges">${tag(p.recordType === 'direction' ? '方向线索 · 非完整 JD' : '具体岗位记录')}${tag(DIVERSE_CYCLES[p.cycle], p.cycle === 'current' ? 'is-current' : 'is-warning')}${tag(DIVERSE_MAJORS[p.major])}${tag(DIVERSE_EMPLOYMENT[p.employment])}</div>
    ${match ? '' : '<p>本岗位不符合当前全部筛选条件，仅供查看同入口其他机会。</p>'}
    <p><b>工作地</b>${esc(p.cities.join(' / ') || '具体岗位地点待核，不用总部代替')}</p>
    <p><b>岗位要求</b>${esc(p.requirements)}</p>
    <p><b>学生干部</b>${esc(DIVERSE_LEADERSHIP[p.leadership])}。${esc(p.leadershipBasis)}</p>
    <p><b>资格与取舍</b>${esc(p.restrictions)}</p>
    <p><b>招聘窗口</b>${esc(DIVERSE_STATUS[timing.status])}；${esc(date)}${p.deadline ? ' · ' + esc(p.deadline.scope) : ''}</p>
    <p><b>证据</b>${view.sourceRefs(p.refs)}</p><div class="div-role-id">${esc(p.id)}</div></section>`;
}
function nearestDeadline(positions) {
  const withDate = positions.filter((p) => p.deadline);
  const future = withDate.filter((p) => !positionWindow(p).expired);
  return [...(future.length ? future : withDate)].sort(
    (a, b) => deadlineEpoch(a.deadline) - deadlineEpoch(b.deadline),
  )[0];
}
function cardHTML(item) {
  const a = assessmentFor(item),
    f = filters(),
    matches = matchingPositions(a, f, undefined, item);
  const matchedIds = new Set(matches.map((p) => p.id));
  // Hidden hard requirements remain hidden in details too, until the user explicitly shows them.
  const positions = a.positions.filter(
    (p) => f.leadership !== 'hide_required' || p.leadership !== 'required',
  );
  const nearest = nearestDeadline(matches),
    timing = nearest ? positionWindow(nearest) : null;
  const dateLabel = nearest
    ? `${nearest.deadline.date}${nearest.deadline.time ? ' ' + nearest.deadline.time : '（时刻未注明）'} · ${timing.label}`
    : '未见统一截止，以各岗位说明为准';
  const current = matches.some((p) => p.cycle === 'current');
  const cohortLabel = current
    ? DIVERSE_CYCLES.current
    : matches.length && matches.every((p) => p.cycle === 'historical')
      ? DIVERSE_CYCLES.historical
      : DIVERSE_CYCLES.unverified;
  const cities = [...new Set(matches.flatMap((p) => p.cities))];
  return `<article class="card${personal.muted(item) ? ' is-muted' : ''}" data-entry-id="${esc(item.id)}" data-name="${esc(item.name)}" id="card-${esc(item.id)}">
    ${personal.controls(item)}
    <div class="div-card-head"><div><h3 class="name">${esc(item.name)}</h3><div class="en">${esc(item.en)}</div></div>${tag(DIVERSE_CATEGORIES[a.category])}</div>
    <div class="div-badges">${tag(cohortLabel, current ? 'is-current' : 'is-warning')}${tag(a.matched ? '资格另核' : '评估已失效，需重新核查', a.matched ? '' : 'is-warning')}</div>
    <p class="div-card-summary">${esc(a.matched ? matches.map((p) => p.title).join(' / ') : item.jobs)}</p>
    <p class="div-card-city">${esc(cities.join(' / ') || (a.matched ? item.city : '地区证据已失效，待重新核查'))}</p>
    <p class="div-matched">${a.matched ? `当前筛选命中 ${matches.length} / ${a.positions.length} 条岗位记录` : esc(a.basis)}</p>
    <div class="div-date${timing?.expired ? ' is-past' : timing && timing.status !== 'watch' && timing.days !== null && timing.days <= 14 ? ' is-urgent' : ''}">${esc(dateLabel)}</div>
    <p class="div-card-summary"><b>下一步：</b>${esc(item.action)}</p>
    <div class="links">${view.itemLinks(item, 'own')}</div>
    <details class="card-details"><summary>查看具体岗位、资格要求与证据</summary>
      ${positions.map((p) => positionHTML(p, matchedIds)).join('')}
      <p class="div-card-summary"><b>用人主体：</b>${esc(item.ownership || '以具体劳动合同主体为准')}</p>
      <p class="div-card-summary"><b>履历交集：</b>${esc(item.why || '以岗位职责与个人真实经历核对')}</p>
      <p class="div-card-summary"><b>风险 / 准备：</b>${esc(item.risk)}</p>
      ${view.auditHTML(item)}${view.evidenceLinks(item)}</details></article>`;
}
function sortList(items) {
  const mode = document.getElementById('sort').value;
  return [...items].sort((a, b) => {
    if (mode === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    const aa = assessmentFor(a),
      bb = assessmentFor(b);
    if (mode === 'due') {
      const key = (item) => {
        const p = nearestDeadline(selectedRoles(item));
        return !p || positionWindow(p).expired || p.status === 'watch'
          ? Infinity
          : deadlineEpoch(p.deadline);
      };
      const delta = key(a) - key(b);
      if (Number.isFinite(delta) && delta) return delta;
      if (key(a) !== key(b)) return key(a) < key(b) ? -1 : 1;
    }
    return (
      diverseOrder({ ...aa, positions: selectedRoles(a) }) -
        diverseOrder({ ...bb, positions: selectedRoles(b) }) ||
      (a.priority ?? 99) - (b.priority ?? 99) ||
      a.name.localeCompare(b.name, 'zh-CN')
    );
  });
}
function staleVisible(a, f) {
  return (
    !a.matched &&
    (f.category === 'all' || f.category === a.category) &&
    ['direction', 'city', 'cycle', 'major', 'employment', 'status'].every(
      (key) => f[key] === 'all',
    ) &&
    ['all', 'hide_required'].includes(f.leadership)
  );
}
function render() {
  const f = filters();
  const visible = catalog.ALL_ITEMS.filter((item) => {
    const a = assessmentFor(item);
    const matches = matchingPositions(a, f, undefined, item);
    return (
      (matches.length > 0 ||
        (staleVisible(a, f) &&
          queryMatches(f.query, [
            item.name,
            item.en,
            item.jobs,
            item.req,
            item.city,
            item.note,
          ]))) &&
      personal.matches(item)
    );
  });
  const signature = JSON.stringify(f) + ':' + document.getElementById('sort').value;
  renderer.render(
    grid,
    sortList(visible.filter((item) => !personal.muted(item))),
    cardHTML,
    (item) => personal.status(item) + ':' + signature,
  );
  personal.renderProcessed(
    sortList(visible.filter((item) => personal.muted(item))),
    cardHTML,
    () => signature,
  );
  document.getElementById('empty').hidden = visible.length !== 0;
  document.getElementById('count').textContent =
    `显示 ${visible.length} / ${catalog.ALL_ITEMS.length} 个入口 · 命中 ${visible.reduce((sum, item) => sum + selectedRoles(item, f).length, 0)} 条岗位记录`;
}
function renderStats() {
  const assessments = catalog.ALL_ITEMS.map(assessmentFor);
  document.getElementById('n-div').textContent = catalog.ALL_ITEMS.length;
  document.getElementById('n-current').textContent = assessments.filter((a) =>
    a.positions.some((p) => p.cycle === 'current'),
  ).length;
  document.getElementById('n-positions').textContent = assessments.reduce(
    (sum, a) => sum + a.positions.length,
    0,
  );
  document.getElementById('n-urgent').textContent = assessments.filter(
    (a) => matchingPositions(a, { status: 'urgent', leadership: 'hide_required' }).length,
  ).length;
  document.getElementById('div-reviewed').textContent = catalog.RECHECKED;
  document.getElementById('clock-date').textContent = chinaDay();
}
function renderSupplement() {
  document.getElementById('existing-list').innerHTML = screening.existingEntries
    .map((row) => {
      const kind = row.entryId.split('-')[0],
        href = PAGE_FILES[kind] + '?q=' + encodeURIComponent(row.name);
      return `<div class="div-crosslink"><a href="${esc(href)}">${esc(row.name)} → 原专栏</a><p>${esc(row.reason)}</p></div>`;
    })
    .join('');
  document.getElementById('excluded-list').innerHTML = screening.excluded
    .map((row) => `<p><b>${esc(row.name)}</b>：${esc(row.reason)}</p>`)
    .join('');
}
for (const control of Object.values(controls)) listen(control, 'change', render);
listen(document.getElementById('sort'), 'change', render);
const disposeSearch = bindSearch(document.getElementById('q'), render);
listen(document.getElementById('reset-filters'), 'click', () => {
  for (const control of Object.values(controls)) control.value = 'all';
  controls.leadership.value = 'hide_required';
  document.getElementById('q').value = '';
  document.getElementById('sort').value = 'priority';
  personal.resetFilter();
  render();
});
const themeButton = document.getElementById('theme-btn');
function themeLabel() {
  themeButton.textContent =
    document.documentElement.dataset.theme === 'dark' ? '浅色模式' : '深色模式';
}
themeLabel();
listen(themeButton, 'click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  themeLabel();
  try {
    localStorage.setItem(THEME_KEYS.div, theme);
  } catch {
    /* Optional appearance preference. */
  }
});
renderStats();
renderSupplement();
render();
view.setupCommon();
void personal.start(render).catch(() => personal.reportStartupError());
document.getElementById('app-loading')?.remove();
performance.mark('app:interactive');
async function refreshCatalog() {
  personal.setCatalogStatus({ refreshing: true, failed: false });
  const next = await resource.refresh();
  if (next !== catalog) {
    catalog = next;
    renderer.prune(catalog.ALL_ITEMS.map((item) => item.id));
    buildFilters();
    personal.setCatalog(catalog);
    view.renderSources();
    renderStats();
    render();
  }
  personal.setCatalogStatus({ refreshing: false, failed: !!resource.lastError });
}
void refreshCatalog();
listen(window, 'online', () => void refreshCatalog());
const timer = setInterval(() => {
  renderStats();
  render();
}, 60000);
if (import.meta.env.DEV) window.__APP = { snapshot: personal.snapshot };
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearInterval(timer);
    lifetime.abort();
    disposeSearch();
    view.dispose();
    personal.dispose();
    renderer.clear();
  });
