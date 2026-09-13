import { escapeHTML, safeHref } from './dom.js';
import { TZ, chinaDay } from './time.js';

export function createCatalogView(getCatalog, buildRail = () => null) {
  const lifetime = new AbortController();
  const searchCache = new WeakMap();
  let historySource, historyIndex;
  function sourceRefs(ids = []) {
    return ids
      .map(
        (id) =>
          `<a class="source-ref" href="#src-${escapeHTML(id)}" title="查看证据范围">[${escapeHTML(id)}]</a>`,
      )
      .join(' ');
  }
  function auditHTML(item) {
    const { RECHECKED, PAGE_KIND } = getCatalog();
    const a = item.audit || {},
      fresh = a.checked === RECHECKED;
    return `<div class="audit-note${fresh ? ' is-current' : ''}"><strong>${fresh ? '9/13 复核' : '历史记录 / 口径说明'}</strong> ${escapeHTML(a.summary || '原8月快照完整保留；本轮未重新核对该公司职位池与规则。')} ${sourceRefs(a.refs || [PAGE_KIND === 'rec' ? 'H01' : 'H02'])}<small>${escapeHTML(fresh ? a.scope || '本届信息已核；岗位在线与个人资格另核' : '未注明本轮核实的岗位数量、条件与规则仍属历史信息，不代表今天在线。')}</small></div>`;
  }
  function originalCard(item) {
    const { ORIGINAL_ITEMS } = getCatalog();
    if (historySource !== ORIGINAL_ITEMS) {
      historySource = ORIGINAL_ITEMS;
      historyIndex = new Map(ORIGINAL_ITEMS.map((x) => [x.name, x]));
    }
    return historyIndex.get(item.name) || null;
  }
  function historyHTML(item) {
    const old = originalCard(item);
    if (!old) return '';
    const labels = {
      status: '原状态',
      src: '原来源',
      rec: '原推荐标签',
      opened: '何时放出',
      closes: '何时结束',
      window: '毕业窗口',
      city: '城市',
      jobs: '岗位情况',
      req: '硬性要求',
      note: '原备注',
      due: '原日期',
      dueAlt: '原补充日期',
      action: '原现在动作',
      why: '为什么适合',
      risk: '风险 / 缺口',
      resume: '简历版本',
      evidence: '原证据状态',
      fit: '原匹配分',
      tier: '原等级',
      ownership: '单位类型',
    };
    const fields = Object.keys(labels)
      .filter((k) => old[k] !== undefined && old[k] !== null)
      .map((k) => `<p class="field"><b>${labels[k]}</b>${escapeHTML(old[k])}</p>`)
      .join('');
    const links = (old.links || [])
      .map(
        ([t, h]) =>
          `<a href="${escapeHTML(safeHref(h))}" target="_blank" rel="noopener noreferrer">${escapeHTML(t)}</a>`,
      )
      .join('');
    return `<details class="more history-record"><summary>原始记录完整保留 · 8月快照（非当前结论）</summary>${fields}${links ? '<div class="links">' + links + '</div>' : ''}</details>`;
  }
  function currentSearchText(item) {
    // History is available for reading but must not cause false matches in city/status filters.
    if (searchCache.has(item)) return searchCache.get(item);
    const keys = [
      'name',
      'en',
      'opened',
      'closes',
      'window',
      'city',
      'jobs',
      'req',
      'note',
      'action',
      'why',
      'risk',
      'resume',
      'evidence',
      'ownership',
    ];
    const text = keys
      .map((k) => item[k] || '')
      .join(' ')
      .toLowerCase();
    searchCache.set(item, text);
    return text;
  }
  function textMatch(item, q) {
    return q
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((t) => currentSearchText(item).includes(t));
  }
  function itemLinks(item) {
    const { SOURCES } = getCatalog();
    const links = [...(item.links || [])];
    for (const id of item.audit?.refs || []) {
      const s = SOURCES[id];
      if (s?.url && !links.some((x) => x[1] === s.url)) links.push([id + ' · ' + s.title, s.url]);
    }
    return links
      .map(
        ([t, h]) =>
          `<a href="${escapeHTML(safeHref(h))}" target="_blank" rel="noopener noreferrer">${escapeHTML(t)}</a>`,
      )
      .join('');
  }
  function renderSources() {
    const { PAGE_KIND, SOURCES, ALL_ITEMS, RECHECKED } = getCatalog();
    const ids =
      PAGE_KIND === 'rec'
        ? Object.keys(SOURCES).filter((x) => x.startsWith('R') || x === 'H01')
        : Object.keys(SOURCES).filter((x) => x.startsWith('S') || x === 'H02');
    document.getElementById('source-list').innerHTML = ids
      .map((id) => {
        const s = SOURCES[id];
        return `<article class="source-entry" id="src-${escapeHTML(id)}"><b>${escapeHTML(id)} · ${escapeHTML(s.title)}</b><span>${escapeHTML(s.level)} · ${escapeHTML(s.access)} · 复核 ${escapeHTML(s.checked)}</span><p>${escapeHTML(s.scope)}</p>${s.url ? `<a href="${escapeHTML(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">打开原来源 ↗</a>` : '<span>原内容见各卡片的“原始记录”；原文件亦随更新包附上。</span>'}</article>`;
      })
      .join('');
    const count = ALL_ITEMS.filter((x) => x.audit?.checked === RECHECKED).length;
    document.getElementById('audit-count').textContent =
      `共 ${ALL_ITEMS.length} 条记录；${count} 条取得本轮网页/索引证据，其余保留原信息或仅校正口径。`;
  }
  function revealHash() {
    let id;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    for (let n = target.parentElement; n; n = n.parentElement)
      if (n.tagName === 'DETAILS') n.open = true;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'auto' }));
  }
  function saveJSON() {
    const { RECHECKED, PAGE_KIND, ALL_ITEMS, ORIGINAL_ITEMS, SOURCES } = getCatalog();
    const blob = new Blob(
      [
        JSON.stringify(
          {
            checked: RECHECKED,
            timezone: TZ,
            kind: PAGE_KIND,
            items: ALL_ITEMS,
            originalItems: ORIGINAL_ITEMS,
            sources: SOURCES,
            timeline: PAGE_KIND === 'rec' ? buildRail() : null,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json;charset=utf-8' },
    );
    const a = document.createElement('a'),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = PAGE_KIND + '_data_' + RECHECKED + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setupCommon() {
    renderSources();
    addEventListener('hashchange', revealHash, { signal: lifetime.signal });
    revealHash();
    document
      .getElementById('export-btn')
      .addEventListener('click', saveJSON, { signal: lifetime.signal });
    document.getElementById('q').setAttribute('aria-label', '搜索公司、城市、岗位与关键词');
    document
      .querySelectorAll('.filters .chip')
      .forEach((b) =>
        b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'),
      );
    document.getElementById('clock-date').textContent = chinaDay();
  }

  return {
    sourceRefs,
    auditHTML,
    historyHTML,
    textMatch,
    itemLinks,
    setupCommon,
    renderSources,
    revealHash,
    dispose: () => lifetime.abort(),
  };
}
