import fallback from '../../data/soe.json';
import { createPageCatalog } from '../backend.js';
import { createPersonalManager } from '../personal.js';
import { createCatalogView } from '../shared/catalog-view.js';
import { escapeHTML, createCardRenderer, bindSearch } from '../shared/dom.js';
import { chinaDay, dayDistance, deadlineEpoch, timeState } from '../shared/time.js';

const resource = createPageCatalog('soe', fallback);
let catalog = resource.current;
let { DATA, PAGE_KIND, ORIGINAL_ITEMS } = catalog;
let ALL_ITEMS = catalog.ALL_ITEMS;
let RECHECKED = catalog.RECHECKED;
const renderer = createCardRenderer();
const personal = createPersonalManager('soe', catalog, {
  renderer,
  onRefreshCatalog: refreshCatalog,
});
const view = createCatalogView(() => catalog);
const { sourceRefs, auditHTML, historyHTML, textMatch, itemLinks, setupCommon } = view;

const STATUS = {
  open: ['当前可行动', 'b-open'],
  soon: ['已公告·待开放', 'b-soon'],
  verify: ['当前需二次核验', 'b-verify'],
  watch: ['高匹配观察池', 'b-watch'],
  past: ['本窗口已过', 'b-past'],
};
const TRACK = {
  rec: '内容推荐',
  ai: 'AI / 云',
  finance: '金融科技',
  geo: '地球物理 AI',
  industrial: '工业 / 研究院',
};
let filter = 'all',
  sortBy = 'priority';
function daysTo(iso) {
  return dayDistance(iso);
}
function deadlineFor(item) {
  if (!item.due) return null;
  const fresh = item.audit?.checked === RECHECKED;
  return {
    date: item.due,
    time: item.dueTime || null,
    kind: 'deadline',
    confidence: fresh ? 'supported' : 'pending',
    scope: item.dueScope || '原版日期（待复核）',
    refs: item.audit?.refs || ['H02'],
    note: fresh ? '按明确批次计时；个人资格仍须核对' : '原历史日期；不冒充本轮硬截止',
  };
}
function currentActionable(item) {
  const m = timeState(deadlineFor(item));
  return item.status === 'open' && item.audit?.checked === RECHECKED && !m.expired;
}
function urgency(item) {
  const ev = deadlineFor(item);
  if (ev) {
    const m = timeState(ev);
    return {
      ...m,
      cls: m.expired ? 'past' : ev.confidence === 'pending' ? 'watch' : m.days <= 21 ? 'hot' : '',
      text: ev.date + (ev.time ? ' ' + ev.time : ''),
      scope: ev.scope,
    };
  }
  if (item.start && daysTo(item.start) >= 0)
    return {
      cls: 'soon',
      label: daysTo(item.start) === 0 ? '今天开放' : `${daysTo(item.start)}天后开放`,
      text: item.start,
      scope: '开放节点',
    };
  if (item.status === 'watch')
    return { cls: 'watch', label: '本轮未核到新入口', text: '观察 / 待更新' };
  if (item.status === 'past')
    return { cls: 'past', label: '原窗口已过', text: '等待补录 / 新批次' };
  if (item.status === 'verify' || item.audit?.checked !== RECHECKED)
    return { cls: 'watch', label: '先复核具体职位', text: '滚动 / 待核' };
  return { cls: '', label: '本届已公告·先核资格', text: '未见统一截止' };
}
function rank(item) {
  const e = deadlineFor(item),
    m = timeState(e);
  if (m.days !== null && !m.expired) return m.days + (e.confidence === 'pending' ? 80 : 0);
  if (currentActionable(item)) return 40;
  if (item.status === 'verify') return 90;
  if (item.status === 'watch') return 200 - item.fit / 10;
  return 260;
}
function card(item) {
  const u = urgency(item),
    fresh = item.audit?.checked === RECHECKED,
    st = STATUS[item.status];
  const label = !fresh && item.status === 'open' ? '原版已开·本轮待核' : st[0];
  const alt = item.dueAlt ? ` · ${escapeHTML(item.dueAlt)}` : '';
  return `<article class="card st-${item.status}${personal.muted(item) ? ' is-muted' : ''}" data-name="${escapeHTML(item.name)}" data-entry-id="${item.id}">
        ${personal.controls(item)}
        <div class="card-head"><div><div class="rankline"><span class="tier t-${item.tier}">${item.tier} 级</span><span class="badge ${st[1]}">${label}</span><span class="badge b-track">${TRACK[item.track]}</span></div><h3 class="name">${escapeHTML(item.name)}</h3><div class="en">${escapeHTML(item.en)}</div></div><div class="score">${item.fit}<small>MATCH / 100</small></div></div>
        <div class="fitbar"><i style="width:${item.fit}%"></i></div>
        <div class="action-strip ${u.cls}"><span class="k">DATE</span><strong>${escapeHTML(u.text)}${alt}</strong><span class="pill">${escapeHTML(u.label)}</span></div>
        ${u.scope ? `<p class="node-scope">${escapeHTML(u.scope)} ${sourceRefs(item.audit?.refs || ['H02'])}</p>` : ''}
        <div class="facts"><span class="fact">${escapeHTML(item.ownership)}</span><span class="fact">${escapeHTML(item.city)}</span>${item.xian ? '<span class="fact">含西安/西北</span>' : ''}</div>
        ${auditHTML(item)}
        <p class="field"><b>现在动作</b>${escapeHTML(item.action)}</p><p class="field"><b>优先岗位</b>${escapeHTML(item.jobs)}</p><p class="field"><b>为什么适合你</b>${escapeHTML(item.why)}</p><p class="field risk"><b>风险 / 缺口</b>${escapeHTML(item.risk)}</p>
        <details class="more"><summary>展开：简历版本与证据</summary><p class="field"><b>简历版本</b>${escapeHTML(item.resume)}</p><p class="field"><b>证据状态</b>${escapeHTML(item.evidence)}</p></details>
        <div class="links">${itemLinks(item)}</div><p class="note">${escapeHTML(item.note)}</p>${historyHTML(item)}</article>`;
}
function isUrgent(item) {
  const m = timeState(deadlineFor(item));
  const d = item.start ? dayDistance(item.start) : null;
  return (
    (d !== null && d >= 0 && d <= 21) ||
    (m.days !== null &&
      !m.expired &&
      m.days <= 21 &&
      ['confirmed', 'supported'].includes(m.event.confidence))
  );
}
function match(item, q) {
  let ok = true;
  if (filter === 'now') ok = currentActionable(item);
  else if (filter === 'urgent') ok = isUrgent(item);
  else if (filter === 's') ok = item.tier === 'S';
  else if (['rec', 'ai', 'finance', 'geo', 'industrial'].includes(filter))
    ok = item.track === filter;
  else if (filter === 'xian') ok = !!item.xian;
  else if (filter === 'watch')
    ok = ['verify', 'watch', 'past'].includes(item.status) || item.audit?.checked !== RECHECKED;
  else if (filter === 'rev') ok = item.rev === RECHECKED;
  return ok && textMatch(item, q);
}
function sorted(list) {
  return [...list].sort(
    (a, b) =>
      personal.compare(a, b) ||
      (sortBy === 'fit'
        ? b.fit - a.fit
        : sortBy === 'due'
          ? rank(a) - rank(b)
          : a.priority - b.priority || rank(a) - rank(b) || b.fit - a.fit),
  );
}
function render() {
  const q = document.getElementById('q').value.trim(),
    list = sorted(DATA.filter((x) => match(x, q) && personal.matches(x)));
  const active = list.filter((x) => !personal.muted(x)),
    processed = list.filter((x) => personal.muted(x)),
    grid = document.getElementById('grid');
  renderer.render(grid, active, card, personal.status);
  grid.style.display = active.length ? '' : 'none';
  if (!list.length) {
    grid.style.display = '';
    grid.innerHTML = '<p class="empty">没有匹配项。请调整关键词、招聘筛选或“我的状态”。</p>';
  }
  personal.renderProcessed(processed, card);
  document.getElementById('count').textContent = '显示 ' + list.length + ' / ' + DATA.length;
  document
    .querySelectorAll('.filters .chip')
    .forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === filter ? 'true' : 'false'));
}
function renderActions() {
  const urgent = sorted(DATA.filter((x) => isUrgent(x) && !personal.muted(x))),
    other = sorted(DATA.filter((x) => currentActionable(x) && !isUrgent(x) && !personal.muted(x))),
    items = urgent.concat(other).slice(0, 8);
  document.getElementById('action-grid').innerHTML =
    items
      .map((x) => {
        const u = urgency(x);
        return `<div class="action ${u.cls === 'hot' ? 'urgent' : ''}"><span class="date">${escapeHTML(u.text)}</span><b>${escapeHTML(x.name)}</b><p>${escapeHTML(x.action)}</p>${sourceRefs(x.audit?.refs || [])}</div>`;
      })
      .join('') ||
    '<p class="sub">当前没有已核实的近期时间节点；卡片与观察池全部保留，请按具体职位复核。</p>';
  document.getElementById('n-urgent').textContent = urgent.length;
}
function renderStats() {
  document.getElementById('n-now').textContent = DATA.filter(currentActionable).length;
  document.getElementById('n-s').textContent = DATA.filter((x) => x.tier === 'S').length;
  document.getElementById('n-rg').textContent = DATA.filter((x) =>
    ['rec', 'geo'].includes(x.track),
  ).length;
  document.getElementById('n-xian').textContent = DATA.filter((x) => x.xian).length;
  document.getElementById('n-watch').textContent = DATA.filter(
    (x) => ['verify', 'watch', 'past'].includes(x.status) || x.audit?.checked !== RECHECKED,
  ).length;
}
document.querySelectorAll('.filters .chip').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filters .chip').forEach((x) => x.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    render();
  }),
);
const disposeSearch = bindSearch(document.getElementById('q'), render);
document.getElementById('sort').addEventListener('change', (e) => {
  sortBy = e.target.value;
  render();
});
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
document.getElementById('print-btn').addEventListener('click', () => window.print());
const themeBtn = document.getElementById('theme-btn');
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = t === 'dark' ? '浅色模式' : '深色模式';
  try {
    localStorage.setItem('soe-personal-theme', t);
  } catch (e) {}
}
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try {
  theme = localStorage.getItem('soe-personal-theme') || theme;
} catch (e) {}
setTheme(theme);
themeBtn.addEventListener('click', () =>
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'),
);
const topBtn = document.getElementById('top-btn');
topBtn.addEventListener('click', () =>
  scrollTo({
    top: 0,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  }),
);
addEventListener('scroll', () => topBtn.classList.toggle('show', scrollY > 700), { passive: true });
renderStats();
renderActions();
render();
setupCommon();
let tickKey =
  chinaDay() + ':' + DATA.map((x) => (timeState(deadlineFor(x)).expired ? '1' : '0')).join('');
const boundaryTimer = setInterval(() => {
  const key =
    chinaDay() + ':' + DATA.map((x) => (timeState(deadlineFor(x)).expired ? '1' : '0')).join('');
  if (key !== tickKey) {
    tickKey = key;
    renderStats();
    renderActions();
    render();
    document.getElementById('clock-date').textContent = chinaDay();
  }
}, 60000);
if (import.meta.env.DEV)
  window.__QA = {
    kind: PAGE_KIND,
    items: DATA,
    original: ORIGINAL_ITEMS,
    deadlineFor,
    timeState,
    chinaDay,
    dayDistance,
    deadlineEpoch,
    currentActionable,
    isUrgent,
    render,
  };

// Catalog rendering and local actions never wait for Supabase or an auth refresh.
void personal
  .start(() => {
    render();
    renderActions();
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
    ({ DATA, PAGE_KIND, ORIGINAL_ITEMS } = catalog);
    ALL_ITEMS = catalog.ALL_ITEMS;
    RECHECKED = catalog.RECHECKED;
    renderer.prune(ALL_ITEMS.map((item) => item.id));
    personal.setCatalog(catalog);
    view.renderSources();
    renderActions();
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
