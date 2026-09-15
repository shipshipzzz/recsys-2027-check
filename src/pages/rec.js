import fallback from '../../data/rec.json';
import { createPageCatalog } from '../backend.js';
import { createPersonalManager } from '../personal.js';
import { createCatalogView } from '../shared/catalog-view.js';
import { escapeHTML, createCardRenderer, bindSearch } from '../shared/dom.js';
import { chinaDay, dayDistance, deadlineEpoch, timeState } from '../shared/time.js';

const resource = createPageCatalog('rec', fallback);
let catalog = resource.current;
let { DATA, EXTRA, KIND, LOG, DUE, TIMELINE, PAGE_KIND, ORIGINAL_ITEMS, REC_DEADLINES } = catalog;
let ALL_ITEMS = catalog.ALL_ITEMS;
let RECHECKED = catalog.RECHECKED;
const renderer = createCardRenderer();
const personal = createPersonalManager('rec', catalog, {
  renderer,
  onRefreshCatalog: refreshCatalog,
});
const view = createCatalogView(
  () => catalog,
  () => buildRail(),
);
const { sourceRefs, auditHTML, historyHTML, textMatch, itemLinks, setupCommon } = view;

const grid = document.getElementById('grid'),
  extraGrid = document.getElementById('extra'),
  extraWrap = document.getElementById('extra-wrap'),
  countEl = document.getElementById('count');
const chips = [...document.querySelectorAll('.filters .chip')];
let filter = 'all',
  sortBy = 'due',
  railFilter = 'all';
function deadlineFor(item) {
  if (Object.prototype.hasOwnProperty.call(REC_DEADLINES, item.name))
    return REC_DEADLINES[item.name];
  const date = DUE[item.name];
  return date
    ? {
        date,
        time: null,
        kind: 'advisory',
        scope: '原版日期（待复核）',
        confidence: 'pending',
        refs: ['H01'],
        note: '保留原节点，但不当本轮已核实的公司统一截止',
      }
    : null;
}
function dueMeta(item) {
  return timeState(deadlineFor(item));
}
function rank(item) {
  const m = dueMeta(item);
  if (m.days === null) return 1e6;
  if (m.expired) return 5e5 - m.days;
  return m.days + (m.event.kind === 'special' ? 100000 : 0);
}
function sortList(list) {
  return [...list].sort(
    (a, b) => personal.compare(a, b) || (sortBy === 'due' ? rank(a) - rank(b) : 0),
  );
}
function badge(item) {
  const r = {
    yes: ['明确推荐岗', 's-open'],
    likely: ['算法里可能有推荐', 's-intern'],
    weak: ['推荐含量弱', 's-weak'],
  }[item.rec] || ['方向待核', 's-wait'];
  const st = {
    open: ['秋招已开', 's-open'],
    intern: ['实习/专项', 's-intern'],
    wait: ['未见本届新证据', 's-wait'],
    verify: ['当前需复核', 's-intern'],
  }[item.status];
  const src = {
    see: [
      item.audit?.checked === RECHECKED && item.audit?.level === '官方正文'
        ? '官网正文·本次'
        : '官网亲见·8月',
      's-see',
    ],
    mix: ['部分亲见·原记录', 's-intern'],
    news: ['公开转载', 's-wait'],
    paste: ['官网原文·你贴的', 's-paste'],
  }[item.src] || ['待核', 's-wait'];
  const recent = item.audit?.checked === RECHECKED;
  const stage = st[0] + (!recent && item.status === 'open' ? '·历史' : '');
  return `<span class="badge ${st[1]}">${stage}</span><span class="badge ${r[1]}">${r[0]}</span><span class="badge ${src[1]}">${src[0]}</span>${item.rev === RECHECKED ? `<span class="badge s-rev">${escapeHTML(RECHECKED)} ${recent ? '复核' : '口径'}</span>` : ''}`;
}
function cardHTML(item, i, hidden) {
  const m = dueMeta(item),
    ev = deadlineFor(item),
    date = ev ? ev.date + (ev.time ? ' ' + ev.time : '') : '滚动 / 截止待核';
  return `<article class="card st-${item.status}${personal.muted(item) ? ' is-muted' : ''}${hidden ? ' hidden' : ''}" data-i="${i}" data-name="${escapeHTML(item.name)}" data-entry-id="${item.id}">
        ${personal.controls(item)}
        <div class="top"><div><h3 class="name">${escapeHTML(item.name)}</h3><div class="en">${escapeHTML(item.en)}</div></div><div class="badges">${badge(item)}</div></div>
        <div class="due ${m.cls}"><span class="due-k">${ev?.confidence === 'pending' ? '待核节点' : '截止 / 节点'}</span><span class="due-v">${escapeHTML(date)}</span><span class="due-pill">${m.label}</span></div>
        ${ev ? `<p class="node-scope">${escapeHTML(ev.scope)} · ${escapeHTML(ev.note || '')} ${sourceRefs(ev.refs)}</p>` : ''}
        ${auditHTML(item)}
        <p class="field"><b>何时结束</b>${escapeHTML(item.closes || '未见统一截止')}</p><p class="field"><b>岗位情况</b>${escapeHTML(item.jobs)}</p>
        <details class="more"><summary>展开：放出时间 · 毕业窗 · 城市 · 硬性要求</summary><p class="field"><b>何时放出</b>${escapeHTML(item.opened)}</p><p class="field"><b>毕业时间</b>${escapeHTML(item.window)}</p><p class="field"><b>城市</b>${escapeHTML(item.city)}</p><p class="field"><b>硬性要求</b>${escapeHTML(item.req)}</p></details>
        <div class="links">${itemLinks(item)}</div><p class="note">${escapeHTML(item.note)}</p>${historyHTML(item)}</article>`;
}
function matchFilter(item) {
  if (filter === 'rev') return item.rev === RECHECKED;
  if (filter === 'all' || filter === 'extra') return true;
  if (filter === 'urgent') {
    const m = dueMeta(item);
    return m.days !== null && !m.expired && m.days <= 45 && m.event.kind !== 'special';
  }
  if (filter === 'rec') return item.rec === 'yes';
  if (filter === 'see') return item.src === 'see' || item.audit?.level === '官方正文';
  if (filter === 'wait') return ['wait', 'verify'].includes(item.status);
  return item.status === filter;
}
function render() {
  const q = document.getElementById('q').value.trim();
  const visible = (x) => matchFilter(x) && textMatch(x, q) && personal.matches(x);
  const core = filter === 'extra' ? [] : DATA.filter(visible),
    extra = EXTRA.filter(visible);
  const activeCore = sortList(core.filter((x) => !personal.muted(x))),
    activeExtra = sortList(extra.filter((x) => !personal.muted(x)));
  const processed = sortList(core.concat(extra).filter((x) => personal.muted(x)));
  renderer.render(grid, activeCore, cardHTML, personal.status);
  renderer.render(extraGrid, activeExtra, cardHTML, personal.status);
  grid.style.display = activeCore.length ? '' : 'none';
  extraWrap.style.display = activeExtra.length ? '' : 'none';
  const count = core.length + extra.length;
  if (!count) {
    grid.style.display = '';
    grid.innerHTML = '<p class="empty">没有匹配的公司。请调整关键词、招聘筛选或“我的状态”。</p>';
  }
  personal.renderProcessed(processed, (x, i) => cardHTML(x, 'p' + i, false));
  countEl.textContent = '显示 ' + count + ' / ' + ALL_ITEMS.length;
  chips.forEach((b) =>
    b.setAttribute('aria-pressed', b.dataset.filter === filter ? 'true' : 'false'),
  );
}
function renderLog() {
  document.getElementById('log').innerHTML = LOG.map(
    (day, i) =>
      `<details class="log-day${i === 0 ? ' is-latest' : ''}"><summary class="log-head"><span class="log-date">${escapeHTML(day.date)}</span><strong>${escapeHTML(day.title)}</strong><span class="log-n">${day.items.length} 条</span><p class="log-sum">${escapeHTML(day.summary)}</p></summary><ul class="log-items">${day.items
        .map(([kind, co, text]) => {
          const k = KIND[kind];
          return `<li><span class="tag ${escapeHTML(k[1])}">${escapeHTML(k[0])}</span><span class="log-co">${escapeHTML(co)}</span><span>${escapeHTML(text)}</span></li>`;
        })
        .join('')}</ul></details>`,
  ).join('');
}
function buildRail() {
  const rows = (catalog.TIMELINE_EVENTS || []).map((x) => ({ ...x }));
  rows.push({
    date: chinaDay(),
    kind: 'today',
    text: '今天 · 北京时间',
    refs: [],
    confidence: 'confirmed',
    note: '只更新时间定位；招聘事实来自已保存的核查资料，不会自动核查招聘网站',
  });
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === 'today' ? -1 : b.kind === 'today' ? 1 : 0) ||
      (a.time || '00:00').localeCompare(b.time || '00:00'),
  );
}
function renderRail() {
  const rows = buildRail(),
    today = chinaDay(),
    shown = rows.filter(
      (x) =>
        x.kind === 'today' ||
        railFilter === 'all' ||
        (railFilter === 'future' ? x.date >= today : x.kind === 'deadline'),
    );
  document.getElementById('rail').innerHTML = shown
    .map((x) => {
      const past = x.date < today,
        cls = [];
      if (past) cls.push('is-past');
      if (x.kind === 'today') cls.push('now');
      cls.push(
        x.kind === 'deadline'
          ? x.confidence === 'pending'
            ? 'k-unverified'
            : 'k-close'
          : x.kind === 'exam'
            ? 'k-exam'
            : x.kind === 'quota'
              ? 'k-quota'
              : 'k-open',
      );
      const label = (x.date.startsWith('2027') ? '27 ' : '') + x.date.slice(5).replace('-', '/');
      const kindName = {
        deadline: '网申',
        advisory: '待核',
        special: '专项',
        open: '放出',
        exam: '笔试',
        quota: '次数',
        review: '核查',
        today: '今天',
      }[x.kind];
      const old =
        x.originalText && x.originalText !== x.text
          ? `<details class="rail-original"><summary>原节点完整保留</summary>${escapeHTML(x.originalText)}</details>`
          : '';
      return `<li ${x.kind === 'today' ? 'id="rail-today-marker" tabindex="-1"' : ''} class="${cls.join(' ')}" data-date="${escapeHTML(x.date)}" ${x.originalIndex !== undefined ? `data-legacy-index="${escapeHTML(x.originalIndex)}"` : ''}><span class="dot"></span><span class="date">${label}${x.time ? '<small>' + escapeHTML(x.time) + '</small>' : ''}</span><span class="txt"><span class="rail-kind">${escapeHTML(kindName)}</span> ${escapeHTML(x.text)} ${sourceRefs(x.refs)}${x.note ? `<small class="rail-note">${escapeHTML(x.note)}</small>` : ''}${old}</span></li>`;
    })
    .join('');
  document.getElementById('rail-count').textContent =
    `${shown.length} / ${rows.length} 个节点 · 原40条全部保留`;
  document
    .querySelectorAll('[data-rail-filter]')
    .forEach((x) =>
      x.setAttribute('aria-pressed', x.dataset.railFilter === railFilter ? 'true' : 'false'),
    );
}
function renderStats() {
  document.getElementById('n-due').textContent = ALL_ITEMS.filter((x) => {
    const m = dueMeta(x);
    return m.days !== null && !m.expired && m.days <= 45 && m.event.kind !== 'special';
  }).length;
  document.getElementById('n-open').textContent = DATA.filter((x) => x.status === 'open').length;
  document.getElementById('n-rec').textContent = DATA.filter((x) => x.rec === 'yes').length;
  document.getElementById('n-see').textContent = DATA.filter(
    (x) => x.src === 'see' || x.audit?.level === '官方正文',
  ).length;
  document.getElementById('n-wait').textContent = DATA.filter((x) =>
    ['wait', 'verify'].includes(x.status),
  ).length;
}
chips.forEach((c) =>
  c.addEventListener('click', () => {
    chips.forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    filter = c.dataset.filter;
    render();
  }),
);
const disposeSearch = bindSearch(document.getElementById('q'), render);
document.getElementById('sort').addEventListener('change', (e) => {
  sortBy = e.target.value;
  render();
});
document.querySelectorAll('[data-rail-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    railFilter = b.dataset.railFilter;
    renderRail();
  }),
);
document.getElementById('jump-today').addEventListener('click', () => {
  document.getElementById('rail-today-marker').scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  });
  document.getElementById('rail-today-marker').focus({ preventScroll: true });
});
const themeBtn = document.getElementById('theme-btn');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = t === 'dark' ? '浅色模式' : '深色模式';
  try {
    localStorage.setItem('recsys-theme', t);
  } catch (e) {}
}
let startTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try {
  startTheme = localStorage.getItem('recsys-theme') || startTheme;
} catch (e) {}
applyTheme(startTheme);
themeBtn.addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'),
);
const topBtn = document.getElementById('top-btn');
topBtn.addEventListener('click', () =>
  scrollTo({
    top: 0,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  }),
);
addEventListener('scroll', () => topBtn.classList.toggle('show', scrollY > 700), { passive: true });
document.addEventListener('keydown', (e) => {
  if (
    e.key === '/' &&
    !/input|textarea|select/i.test(document.activeElement.tagName) &&
    !document.activeElement.isContentEditable
  ) {
    e.preventDefault();
    document.getElementById('q').focus();
  }
});
renderLog();
renderRail();
renderStats();
render();
setupCommon();
// Re-evaluate boundaries every minute without collapsing an in-progress card expansion.
let tickKey = chinaDay() + ':' + ALL_ITEMS.map((x) => (dueMeta(x).expired ? '1' : '0')).join('');
const boundaryTimer = setInterval(() => {
  const key = chinaDay() + ':' + ALL_ITEMS.map((x) => (dueMeta(x).expired ? '1' : '0')).join('');
  if (key !== tickKey) {
    tickKey = key;
    renderRail();
    renderStats();
    render();
    document.getElementById('clock-date').textContent = chinaDay();
  }
}, 60000);
if (import.meta.env.DEV)
  window.__QA = {
    kind: PAGE_KIND,
    items: ALL_ITEMS,
    original: ORIGINAL_ITEMS,
    originalTimeline: TIMELINE,
    buildRail,
    deadlineFor,
    timeState,
    chinaDay,
    dayDistance,
    deadlineEpoch,
    render,
    renderRail,
  };

// Catalog rendering and local actions never wait for Supabase or an auth refresh.
void personal
  .start(() => {
    render();
  })
  .catch(() => personal.reportStartupError());
document.getElementById('app-loading')?.remove();
performance.mark('app:interactive');
if (import.meta.env.DEV) window.__APP = { snapshot: personal.snapshot };

async function refreshCatalog() {
  personal.setCatalogStatus({ refreshing: true, failed: false });
  const next = await resource.refresh();
  if (next !== catalog) {
    catalog = next;
    ({ DATA, EXTRA, KIND, LOG, DUE, TIMELINE, PAGE_KIND, ORIGINAL_ITEMS, REC_DEADLINES } = catalog);
    ALL_ITEMS = catalog.ALL_ITEMS;
    RECHECKED = catalog.RECHECKED;
    renderer.prune(ALL_ITEMS.map((item) => item.id));
    personal.setCatalog(catalog);
    view.renderSources();
    renderLog();
    renderRail();
    renderStats();
  }
  personal.setCatalogStatus({ refreshing: false, failed: !!resource.lastError });
}
void refreshCatalog();
const onCatalogOnline = () => void refreshCatalog();
addEventListener('online', onCatalogOnline);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearInterval(boundaryTimer);
    disposeSearch();
    view.dispose();
    personal.dispose();
    renderer.clear();
    removeEventListener('online', onCatalogOnline);
  });
