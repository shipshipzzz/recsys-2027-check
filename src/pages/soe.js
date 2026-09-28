import { loadJSON } from '../shared/json-loader.js';
import {
  createOpportunityLookup,
  noticeDeadline,
  noticeActionable,
  deadlineUrgency,
  positionDeadline,
  directoryMatch,
  hasHeadquartersClue,
  REVIEW_STATES,
} from '../national-policy.js';
import {
  readPositionProgress,
  writePositionProgress,
  exportPositionProgress,
  POSITION_STATES,
  POSITION_KEY,
} from '../position-progress.js';
// Missing new supplements are tolerated during parallel local editing only. Publishing validates them.
const assetURLs = import.meta.glob(
  '../../data/soe{,-screening,-locations,-directory,-opportunities}.json',
  { eager: true, query: '?url', import: 'default' },
);
const [fallback, screening, locations, directory, opportunities] = await Promise.all(
  ['soe', 'soe-screening', 'soe-locations', 'soe-directory', 'soe-opportunities'].map((name) => {
    const url = assetURLs['../../data/' + name + '.json'];
    if (!url && ['soe-directory', 'soe-opportunities'].includes(name))
      return loadJSON(import.meta.env.BASE_URL + 'data/' + name + '.json').catch(() =>
        name === 'soe-directory' ? { groups: [] } : { entries: {} },
      );
    return loadJSON(url);
  }),
);
const lookupOpportunities = createOpportunityLookup(opportunities, fallback, screening);
let progressStorage;
try {
  progressStorage = localStorage;
} catch {
  /* Local progress remains usable in memory. */
}
let positionProgress = readPositionProgress(progressStorage);

import {
  LOCATION_LEVELS,
  createLocationLookup,
  locationBonus,
  matchesLocation,
  locationMatchKind,
  availableCities,
  comparePreferredOpportunities,
} from '../location-policy.js';

import {
  SOE_TRACKS,
  MAJOR_LEVELS,
  CYCLES,
  BROAD_TRACKS,
  createAssessmentLookup,
  hasMajorEvidence,
  matchesAssessment,
} from '../soe-policy.js';

import { createPageCatalog } from '../backend.js';
import { createPersonalManager } from '../personal.js';
import { createCatalogView } from '../shared/catalog-view.js';
import { escapeHTML, safeHref, createCardRenderer, bindSearch } from '../shared/dom.js';
import { chinaDay, dayDistance, deadlineEpoch, timeState } from '../shared/time.js';

const lookupAssessment = createAssessmentLookup(screening, fallback);
const lookupGeography = createLocationLookup(locations, fallback);
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
const assessmentFor = (item) => lookupAssessment(item, catalog.SOURCES);
const opportunitiesFor = (item) => lookupOpportunities(item, catalog.SOURCES);
const geographyFor = (item) => lookupGeography(item, catalog.SOURCES);
const view = createCatalogView(
  () => catalog,
  () => null,
  () => ({
    screening: {
      policyVersion: screening.policyVersion,
      targetGraduationYear: screening.targetGraduationYear,
      entries: Object.fromEntries(DATA.map((item) => [item.id, assessmentFor(item)])),
    },
    geography: {
      policyVersion: locations.policyVersion,
      entries: Object.fromEntries(DATA.map((item) => [item.id, geographyFor(item)])),
    },
    directory,
    opportunities: {
      reviewedOn: opportunities.reviewedOn,
      entries: Object.fromEntries(DATA.map((item) => [item.id, opportunitiesFor(item)])),
    },
  }),
);
const { sourceRefs, auditHTML, historyHTML, textMatch, itemLinks, evidenceLinks, setupCommon } =
  view;

const STATUS = {
  open: ['公告窗口开放 · 资格另核', 'b-open'],
  soon: ['已公告·待开放', 'b-soon'],
  verify: ['当前需二次核验', 'b-verify'],
  watch: ['观察跟进', 'b-watch'],
  past: ['本窗口已过', 'b-past'],
};
const TRACK = SOE_TRACKS;
let locationFilter = 'all';
let includePendingLocations = false,
  headquartersOnly = false;
let filter = 'all',
  sortBy = 'priority',
  trackFilter = 'all',
  majorFilter = 'all',
  cycleFilter = 'all';
function daysTo(iso) {
  return dayDistance(iso);
}
function pendingOpportunitiesFor(item) {
  const row = opportunitiesFor(item);
  return {
    ...row,
    positions: row.positions.filter(
      (p) =>
        p.type === 'campus' &&
        p.cycle !== 'historical' &&
        p.status !== 'past' &&
        !timeState(positionDeadline(p)).expired &&
        (positionProgress[p.id] || 'pending') === 'pending',
    ),
  };
}
function deadlineFor(item) {
  const pending = pendingOpportunitiesFor(item);
  return noticeDeadline(
    item,
    assessmentFor(item),
    pending.positions.length ? pending : opportunitiesFor(item),
    catalog.SOURCES,
  );
}
function currentActionable(item) {
  return noticeActionable(item, assessmentFor(item), opportunitiesFor(item));
}
function effectiveItem(item) {
  const positions = opportunitiesFor(item);
  if (!positions.matched) return item;
  const event = deadlineFor(item);
  const remaining = positions.positions.some(
    (p) =>
      p.cycle !== 'historical' &&
      p.status !== 'past' &&
      (!p.due || !timeState(positionDeadline(p)).expired),
  );
  return {
    ...item,
    due: event?.date || null,
    dueTime: event?.time || null,
    status: remaining ? 'verify' : item.status === 'past' ? 'past' : 'watch',
  };
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
      label:
        ev.confidence === 'pending' && !m.expired && m.days <= 21
          ? '临期待核 · ' + m.label
          : m.label,
    };
  }
  if (opportunitiesFor(item).matched)
    return { cls: 'watch', label: '岗位子集日期见列表', text: '其他岗位 / 新批次另核' };
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
  if (item.status === 'verify' || assessmentFor(item).cycle !== 'current')
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

/** Short visible hint; the full geographic evidence stays in the card details. */
function locationFact(item) {
  const geography = geographyFor(item);
  if (!geography.matched || !geography.locations.length) return '';
  const bonus = locationBonus(geography, trackFilter);
  return bonus > 0 ? '<span class="fact fact-accent">偏好地区 +' + bonus + '</span>' : '';
}
function geographicHTML(item) {
  const geography = geographyFor(item),
    bonus = locationBonus(geography, trackFilter);
  if (!geography.matched)
    return '<p class="node-scope" data-location-bonus="0">地点条件尚未完成本轮独立核验，暂不计地区加分；不代表没有偏好地区机会。</p>';
  if (!geography.locations.length)
    return '<p class="node-scope" data-location-bonus="0">已读工作地点未命中偏好地区，仍保留机会；考试或总部城市不会自动加分。</p>';
  const groups = new Map();
  for (const place of geography.locations) {
    const key = place.level + '|' + place.scope + '|' + place.directions.join(',');
    if (!groups.has(key)) groups.set(key, { ...place, names: [] });
    groups.get(key).names.push(place.city || place.province + '（具体城市待核）');
  }
  const lines = [...groups.values()]
    .map(
      (place) =>
        '<p><b>' +
        escapeHTML(LOCATION_LEVELS[place.level]) +
        ' · ' +
        escapeHTML(place.names.join(' / ')) +
        '</b><br>' +
        escapeHTML(place.scope) +
        '<br>适用方向：' +
        escapeHTML(place.directions.map((key) => TRACK[key]).join(' / ')) +
        ' ' +
        sourceRefs(place.refs) +
        '</p>',
    )
    .join('');
  return (
    '<div class="screening-summary location-summary" data-location-bonus="' +
    bonus +
    '"><strong>本入口最高地区加分 +' +
    bonus +
    ' 分</strong><small>同一证据档内排序加分；选择方向时只计该方向的地区依据。不是资格或录用概率。一个入口的不同岗位不可混用城市和专业条件。</small><details class="more"><summary>地区依据：适用岗位与范围</summary>' +
    lines +
    '</details></div>'
  );
}

function hasPendingPosition(item) {
  return pendingOpportunitiesFor(item).positions.length > 0;
}
function needsAction(item) {
  return opportunitiesFor(item).matched ? hasPendingPosition(item) : !personal.muted(item);
}
function positionsHTML(item) {
  const row = opportunitiesFor(item);
  if (row.stale)
    return '<p class="node-scope">岗位附表与当前事实不一致，已撤回旧岗位日期与资格标签，等待复核。</p>';
  if (!row.matched) return '';
  return (
    '<details class="position-list"><summary>独立岗位与进度（' +
    row.positions.length +
    '）</summary><p>' +
    escapeHTML(row.scope) +
    '</p><p>旧卡标记仅表示入口状态，不代表全部岗位已投。下列进度仅本机保存，不与账号同步。专业依据不等于个人全部资格通过。</p>' +
    row.positions
      .map((p) => {
        const ev = positionDeadline(p),
          state = timeState(ev);
        return (
          '<section data-position="' +
          escapeHTML(p.id) +
          '"><h4>' +
          escapeHTML(p.name) +
          '</h4><p>' +
          escapeHTML(p.employer) +
          ' · ' +
          escapeHTML(CYCLES[p.cycle]) +
          ' · ' +
          (p.type === 'internship' ? '实习' : '正式校招') +
          '</p><p>' +
          escapeHTML(MAJOR_LEVELS[p.major]) +
          ' · 地点：' +
          escapeHTML(p.locations.join(' / ') || '待核') +
          '</p><p>' +
          escapeHTML(p.requirements) +
          '</p><p>截止：' +
          escapeHTML(p.due || '未知') +
          (p.dueTime ? ' ' + escapeHTML(p.dueTime) : p.due ? '（时刻未注明）' : '') +
          ' · ' +
          escapeHTML(state.label) +
          '</p><p>' +
          escapeHTML(p.deadlineScope) +
          ' ' +
          sourceRefs(p.refs) +
          '</p><p>投递限制：' +
          escapeHTML(p.applicationLimit) +
          '</p><p>' +
          escapeHTML(p.risks) +
          '</p><a target="_blank" rel="noopener noreferrer" href="' +
          escapeHTML(safeHref(p.url)) +
          '">岗位来源 / 入口</a><label>岗位进度（仅本机保存）<select data-position-id="' +
          escapeHTML(p.id) +
          '" aria-label="' +
          escapeHTML(p.name) +
          '岗位进度">' +
          Object.entries(POSITION_STATES)
            .map(
              ([key, value]) =>
                '<option value="' +
                key +
                '"' +
                ((positionProgress[p.id] || 'pending') === key ? ' selected' : '') +
                '>' +
                value +
                '</option>',
            )
            .join('') +
          '</select></label></section>'
        );
      })
      .join('') +
    '</details>'
  );
}
function card(item) {
  const u = urgency(item),
    assessment = assessmentFor(item),
    st = STATUS[effectiveItem(item).status];
  const label =
    assessment.cycle !== 'current' && item.status === 'open' ? '原记录已开 · 当前入口另核' : st[0];
  const alt = item.dueAlt && !opportunitiesFor(item).matched ? ' · ' + escapeHTML(item.dueAlt) : '';
  const directions = assessment.directions
    .map((key) => '<span class="badge b-track">' + escapeHTML(TRACK[key]) + '</span>')
    .join('');
  return `<article class="card st-${item.status}${personal.muted(item) ? ' is-muted' : ''}" data-name="${escapeHTML(item.name)}" data-entry-id="${item.id}" data-major="${assessment.major}" data-cycle="${assessment.cycle}" data-directions="${assessment.directions.join(' ')}">
    ${personal.controls(item)}
    <div class="card-head"><div><div class="rankline"><span class="tier t-${item.tier}">${item.tier} 参考</span><span class="badge ${st[1]}">${label}</span></div><h3 class="name">${escapeHTML(item.name)}</h3><div class="en">${escapeHTML(item.en)}</div></div><details class="score"><summary>参考分</summary>${item.fit}<small>参考 / 100</small></details></div>
    <div class="screening-directions">${directions}</div>
    <p class="screening-line"><strong>${MAJOR_LEVELS[assessment.major]}</strong><span>${CYCLES[assessment.cycle]}</span></p>
    <div class="action-strip ${u.cls}"><span class="k">日期</span><strong>${escapeHTML(u.text)}${alt}</strong><span class="pill">${escapeHTML(u.label)}</span></div>
    ${positionsHTML(item)}
    <div class="facts"><span class="fact">${escapeHTML(item.ownership)}</span><span class="fact">${escapeHTML(item.city)}</span>${locationMatchKind(geographyFor(item), locationFilter, trackFilter, includePendingLocations) === 'pending' ? '<span class="fact">地点待核线索 · 不加地区分</span>' : ''}${locationFact(item)}</div>
    <p class="card-gist"><b>现在动作</b>${escapeHTML(item.action)}</p>
    <div class="links">${itemLinks(item, 'own')}</div>
    <details class="more card-details"><summary>详情：专业依据 · 岗位 · 地区 · 风险 · 核查记录</summary>
    ${u.scope ? `<p class="node-scope">${escapeHTML(u.scope)} ${escapeHTML(u.event?.note || '')} ${sourceRefs(item.audit?.refs || ['H02'])}</p>` : ''}
    <div class="screening-summary"><div class="screening-badges"><strong data-major-label>${MAJOR_LEVELS[assessment.major]}</strong><span data-cycle-label>${CYCLES[assessment.cycle]}</span></div><p>${escapeHTML(assessment.basis)}</p><small>专业依据不等于个人全部资格通过；以具体职位与招聘方认定为准。</small></div>
    <p class="field"><b>岗位 / 职责</b>${escapeHTML(item.jobs)}</p>
    <p class="field"><b>专业条件</b>${escapeHTML(item.req || '具体专业要求待核')}</p><p class="field"><b>招聘对象</b>${escapeHTML(item.window || '具体毕业窗待核')}</p>
    ${item.closes ? '<p class="field"><b>报名窗口</b>' + escapeHTML(item.closes) + '</p>' : ''}
    <p class="field risk"><b>风险 / 取舍</b>${escapeHTML(item.risk)}</p>
    ${geographicHTML(item)}
    <p class="field"><b>单位 / 岗位依据</b>${escapeHTML(assessment.qualityBasis)}</p><p class="field"><b>能力联系</b>${escapeHTML(item.why)}</p><p class="field"><b>简历建议</b>${escapeHTML(item.resume)}</p><p class="field"><b>证据状态</b>${escapeHTML(item.evidence)}</p>
    <p class="note">${escapeHTML(item.note)}</p>
    ${auditHTML(item)}${evidenceLinks(item)}${historyHTML(item)}</details></article>`;
}
function isUrgent(item) {
  if (opportunitiesFor(item).matched && !hasPendingPosition(item)) return false;
  const state = deadlineUrgency(
    item,
    assessmentFor(item),
    pendingOpportunitiesFor(item),
    catalog.SOURCES,
  );
  const d = item.start ? dayDistance(item.start) : null;
  return (
    !!state ||
    (assessmentFor(item).cycle === 'current' &&
      item.status !== 'past' &&
      d !== null &&
      d >= 0 &&
      d <= 21)
  );
}
function match(item, q) {
  let ok = true;
  if (filter === 'now') ok = currentActionable(item);
  else if (filter === 'urgent') ok = isUrgent(item);
  else if (filter === 'pending-date')
    ok =
      needsAction(item) &&
      deadlineUrgency(item, assessmentFor(item), pendingOpportunitiesFor(item), catalog.SOURCES) ===
        'pending';
  else if (filter === 's') ok = item.tier === 'S';
  else if (Object.hasOwn(TRACK, filter)) ok = assessmentFor(item).directions.includes(filter);
  else if (filter === 'preferred')
    ok = matchesLocation(geographyFor(item), 'preferred', trackFilter);
  else if (filter === 'xian') ok = matchesLocation(geographyFor(item), '西安', trackFilter);
  else if (filter === 'watch')
    ok =
      ['verify', 'watch', 'past'].includes(item.status) ||
      assessmentFor(item).cycle !== 'current' ||
      !hasMajorEvidence(assessmentFor(item));
  else if (filter === 'rev') ok = item.rev === RECHECKED;
  return (
    ok &&
    !!locationMatchKind(geographyFor(item), locationFilter, trackFilter, includePendingLocations) &&
    (!headquartersOnly || hasHeadquartersClue(directory, item.id)) &&
    matchesAssessment(assessmentFor(item), {
      direction: trackFilter,
      major: majorFilter,
      cycle: cycleFilter,
    }) &&
    q
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every(
        (term) =>
          textMatch(item, term) ||
          directoryMatch(directory, item.id, term) ||
          opportunitiesFor(item).positions.some((p) =>
            [p.name, p.employer, p.requirements, ...p.locations]
              .join(' ')
              .toLowerCase()
              .includes(term.toLowerCase()),
          ),
      )
  );
}
function sorted(list) {
  return [...list].sort(
    (a, b) =>
      personal.compare(a, b) ||
      (sortBy === 'fit'
        ? b.fit - a.fit
        : sortBy === 'due'
          ? rank(a) - rank(b)
          : comparePreferredOpportunities(
              effectiveItem(a),
              effectiveItem(b),
              assessmentFor(a),
              assessmentFor(b),
              geographyFor(a),
              geographyFor(b),
              new Date(),
              trackFilter,
            )),
  );
}
function render() {
  const q = document.getElementById('q').value.trim(),
    list = sorted(DATA.filter((x) => match(x, q) && personal.matches(x)));
  const active = list.filter((x) => !personal.muted(x) || hasPendingPosition(x)),
    processed = list.filter((x) => personal.muted(x) && !hasPendingPosition(x)),
    grid = document.getElementById('grid');
  renderer.render(
    grid,
    active,
    card,
    (item) =>
      personal.status(item) +
      ':' +
      trackFilter +
      ':' +
      locationFilter +
      ':' +
      includePendingLocations +
      ':' +
      JSON.stringify(positionProgress),
  );
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
  const urgent = sorted(DATA.filter((x) => isUrgent(x) && needsAction(x))),
    other = sorted(DATA.filter((x) => currentActionable(x) && !isUrgent(x) && needsAction(x))),
    items = urgent.concat(other).slice(0, 8);
  document.getElementById('action-grid').innerHTML =
    items
      .map((x) => {
        const u = urgency(x);
        return `<div class="action ${u.cls === 'hot' ? 'urgent' : ''}"><span class="date">${escapeHTML(u.text)} / ${escapeHTML(u.label)}</span><b>${escapeHTML(x.name)}</b><p>${escapeHTML(x.action)}</p>${sourceRefs(x.audit?.refs || [])}</div>`;
      })
      .join('') ||
    '<p class="sub">当前没有已核实的近期时间节点；卡片与观察池全部保留，请按具体职位复核。</p>';
  document.getElementById('n-urgent').textContent = urgent.length;
}
function renderStats() {
  const count = DATA.filter((item) => locationBonus(geographyFor(item)) > 0).length;
  document.getElementById('location-count').textContent =
    count + ' 条本届入口有已核偏好地区依据（岗位或招聘范围），其余不自动排除';
  document.getElementById('n-now').textContent = DATA.filter(currentActionable).length;
  document.getElementById('n-total').textContent = DATA.length;
  document.getElementById('n-broad').textContent = DATA.filter((item) =>
    assessmentFor(item).directions.some((track) => BROAD_TRACKS.includes(track)),
  ).length;
  document.getElementById('n-major').textContent = DATA.filter((item) =>
    hasMajorEvidence(assessmentFor(item)),
  ).length;
  document.getElementById('n-watch').textContent = DATA.filter(
    (item) =>
      ['verify', 'watch', 'past'].includes(item.status) ||
      assessmentFor(item).cycle !== 'current' ||
      !hasMajorEvidence(assessmentFor(item)),
  ).length;
}
const filterLifetime = new AbortController();
function populateFilter(id, choices, apply) {
  const select = document.getElementById(id);
  for (const [value, label] of choices) select.add(new Option(label, value));
  select.addEventListener(
    'change',
    (event) => {
      apply(event.target.value);
      render();
    },
    { signal: filterLifetime.signal },
  );
}
populateFilter(
  'track-filter',
  [['broad', '业务 / 统计 / 管理扩展'], ...Object.entries(TRACK)],
  (value) => {
    trackFilter = value;
  },
);
populateFilter(
  'major-filter',
  [['supported', '有明确文字依据（非资格保证）'], ...Object.entries(MAJOR_LEVELS)],
  (value) => {
    majorFilter = value;
  },
);
populateFilter('cycle-filter', Object.entries(CYCLES), (value) => {
  cycleFilter = value;
});
populateFilter(
  'location-filter',
  [
    ['preferred', '全部偏好地区（有依据）'],
    ...[
      ...new Set([
        '杭州',
        '成都',
        '重庆',
        '西安',
        '浙江',
        ...availableCities(DATA.map(geographyFor)),
      ]),
    ].map((value) => [value, value === '浙江' ? '浙江全省（含杭州）' : value]),
  ],
  (value) => {
    locationFilter = value;
  },
);
const pendingChip = document.createElement('button');
pendingChip.className = 'chip';
pendingChip.dataset.filter = 'pending-date';
pendingChip.textContent = '临期待核';
document.querySelector('.filters').append(pendingChip);
const nationalControls = document.createElement('div');
nationalControls.className = 'national-controls';
nationalControls.innerHTML =
  '<label><input type="checkbox" id="location-pending"> 同时显示地点待核线索（不加地区分）</label><label><input type="checkbox" id="hq-filter"> 总行 / 总部线索（资格另核）</label><button type="button" id="position-export">导出岗位进度 JSON（仅本机）</button><p id="position-save-status" role="status"></p>';
document.getElementById('grid').before(nationalControls);
document.getElementById('location-pending').addEventListener('change', (event) => {
  includePendingLocations = event.target.checked;
  render();
});
document.getElementById('hq-filter').addEventListener('change', (event) => {
  headquartersOnly = event.target.checked;
  render();
});
document.getElementById('position-export').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([exportPositionProgress(positionProgress)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'soe-position-progress.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('change', (event) => {
  const id = event.target.dataset.positionId;
  if (!id || !Object.hasOwn(POSITION_STATES, event.target.value)) return;
  positionProgress = {
    ...positionProgress,
    ...readPositionProgress(progressStorage),
    [id]: event.target.value,
  };
  const saved = writePositionProgress(progressStorage, positionProgress);
  document.getElementById('position-save-status').textContent = saved
    ? '岗位进度已保存，仅本机有效。'
    : '本机存储不可用，当前进度仅在此页内存中；请导出 JSON。';
  render();
  renderActions();
});
const onPositionStorage = (event) => {
  if (event.key !== POSITION_KEY) return;
  positionProgress = readPositionProgress(progressStorage);
  render();
  renderActions();
};
addEventListener('storage', onPositionStorage);
const coverage = document.createElement('details');
coverage.className = 'national-directory';
coverage.innerHTML =
  '<summary>全国机构覆盖（' +
  directory.groups.length +
  ' 个集团条目）</summary><p>未检查不代表没有招聘，也不代表当前在招。母集团有卡不等于所有机构已核；集团关系不代表招聘资格。以下仅显示本轮核对范围。</p>' +
  directory.groups
    .map(
      (group) =>
        '<section><h3>' +
        escapeHTML(group.name) +
        ' · ' +
        escapeHTML(REVIEW_STATES[group.reviewState]) +
        '</h3><p>' +
        escapeHTML(group.aliases.join(' / ')) +
        '</p><p>' +
        escapeHTML(group.scope) +
        '</p><p>下一步：' +
        escapeHTML(group.nextAction) +
        '</p><p>关联入口 ' +
        group.entryIds.length +
        ' · 核查 ' +
        escapeHTML(group.checkedOn || '未检查') +
        '</p>' +
        group.sourceUrls
          .map(
            (url) =>
              '<a target="_blank" rel="noopener noreferrer" href="' +
              escapeHTML(safeHref(url)) +
              '">目录来源</a>',
          )
          .join(' · ') +
        '</section>',
    )
    .join('');
nationalControls.before(coverage);

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
  chinaDay() +
  ':' +
  DATA.map((x) => JSON.stringify(deadlineFor(x)) + timeState(deadlineFor(x)).expired).join('');
const boundaryTimer = setInterval(() => {
  const key =
    chinaDay() +
    ':' +
    DATA.map((x) => JSON.stringify(deadlineFor(x)) + timeState(deadlineFor(x)).expired).join('');
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
    filterLifetime.abort();
    disposeSearch();
    view.dispose();
    personal.dispose();
    renderer.clear();
    removeEventListener('online', onCatalogOnline);
    removeEventListener('storage', onPositionStorage);
  });
