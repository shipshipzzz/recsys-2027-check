import { createTimelineSync, timelineError } from './timeline-sync.js';
import { TimelineStore } from './timeline-store.js';
import {
  TIMELINE_TYPES,
  TIMELINE_STATUSES,
  fromBeijingInput,
  toBeijingInput,
  matchesTimeline,
  sortTimeline,
  timelineCounts,
  timelinePhase,
} from './timeline-model.js';
import { escapeHTML as esc, safeHref, bindSearch } from './shared/dom.js';
import './timeline.css';

const options = (values) =>
  Object.entries(values)
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join('');
const displayTime = (value) => toBeijingInput(value).replace('T', ' ');
const phaseLabels = {
  overdue: '已逾期 · 待处理',
  ongoing: '进行中 · 待完成',
  upcoming: '待完成',
  completed: '已完成',
  cancelled: '已取消',
};
const PAGE_SIZE = 20;

export function createTimelineManager({ client, storage, namespace, catalog, anchor }) {
  const lifetime = new AbortController();
  const listen = (element, event, handler) =>
    element.addEventListener(event, handler, { signal: lifetime.signal });
  let items = catalog.ALL_ITEMS,
    page = 0,
    editingId = null,
    editingScope = null,
    editingMutation = null,
    returnFocus = null;
  const section = document.createElement('section');
  section.className = 'personal-timeline';
  section.id = 'personal-timeline';
  section.setAttribute('aria-labelledby', 'timeline-heading');
  section.innerHTML = `<div class="timeline-heading"><div><span class="personal-eyebrow">PERSONAL TIMELINE</span><h2 id="timeline-heading">我的时间线</h2><p>测评、笔试、面试，集中安排。两页共用；全部时间按北京时间（UTC+8）。</p></div><div class="timeline-buttons"><button type="button" data-timeline-add>新增日程</button><button type="button" data-timeline-export>导出日程</button></div></div>
    <div class="timeline-counts" data-timeline-counts aria-label="日程统计"></div>
    <div class="timeline-filters"><label>搜索日程<input type="search" data-timeline-query placeholder="公司、事项或备注" maxlength="160"></label><label>日程类型<select data-timeline-type><option value="all">全部类型</option>${options(TIMELINE_TYPES)}</select></label><label>完成状态<select data-timeline-status><option value="all">全部状态</option>${options(TIMELINE_STATUSES)}</select></label><label>时间范围<select data-timeline-period><option value="all">全部时间</option><option value="today">今天</option><option value="week">未来七天（含今天）</option><option value="overdue">已逾期</option></select></label></div>
    <div class="timeline-sync-row"><span data-timeline-sync role="status" aria-live="polite"></span><div class="timeline-buttons"><button type="button" data-timeline-refresh hidden>同步日程</button><button type="button" data-timeline-import hidden>导入本机日程</button></div></div>
    <p class="timeline-notice" data-timeline-notice role="status" aria-live="polite"></p>
    <p class="timeline-empty" data-timeline-empty>还没有日程。点击“新增日程”，或在公司卡片上点击“安排日程”。</p>
    <div class="timeline-table-wrap" data-timeline-table-wrap hidden><table class="timeline-table"><caption>个人测评、笔试和面试日程（北京时间）</caption><thead><tr><th scope="col">时间</th><th scope="col">公司 / 事项</th><th scope="col">类型</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody></tbody></table></div>
    <div class="timeline-pagination"><span data-timeline-page></span><div class="timeline-buttons"><button type="button" data-timeline-prev>上一页</button><button type="button" data-timeline-next>下一页</button></div></div>
    <p class="timeline-footnote">个人安排不会改动公开招聘信息或“已投递”标记。逾期只提示待处理，不会自动标记完成；关闭网页后不发送提醒。</p>`;
  anchor.after(section);
  const dialog = document.createElement('dialog');
  dialog.className = 'timeline-dialog';
  dialog.setAttribute('aria-labelledby', 'timeline-dialog-title');
  dialog.innerHTML = `<form novalidate autocomplete="off"><div class="timeline-heading"><h2 id="timeline-dialog-title">新增日程</h2><button type="button" data-timeline-close aria-label="关闭日程窗口">关闭</button></div>
    <p>全部按北京时间（UTC+8）填写。测评窗口可同时填写开始和截止时间。</p>
    <label>日程名称（必填）<input name="title" required maxlength="160" placeholder="例如：秋招在线测评 / 技术一面"></label>
    <div class="timeline-form-grid"><label>公司 / 单位<input name="company_name" maxlength="160" placeholder="可填写未收录的公司"></label><label>关联招聘卡片（选填）<select name="entry_id"><option value="">不关联卡片</option></select></label><label>日程类型<select name="event_type">${options(TIMELINE_TYPES)}</select></label><label>完成状态<select name="status">${options(TIMELINE_STATUSES)}</select></label><label>开始 / 计划时间（必填）<input name="starts_at" type="datetime-local" required min="2000-01-01T00:00" max="2199-12-31T23:59"></label><label>结束 / 截止时间（选填）<input name="ends_at" type="datetime-local" min="2000-01-01T00:00" max="2199-12-31T23:59"></label></div>
    <label>地点 / 平台<input name="location" maxlength="300" placeholder="例如：线上、会议号、考场地址"></label><label>会议 / 测评链接<input name="url" type="url" maxlength="2048" placeholder="https://…"></label><label>备注<textarea name="notes" rows="3" maxlength="2000" placeholder="准备材料、面试轮次、联系人等；不要填写密码"></textarea></label>
    <p class="timeline-feedback" data-timeline-feedback role="alert"></p><div class="timeline-buttons"><button type="submit">保存日程</button><button type="button" data-timeline-cancel>取消</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const tbody = section.querySelector('tbody');
  const filters = {
    query: section.querySelector('[data-timeline-query]'),
    type: section.querySelector('[data-timeline-type]'),
    status: section.querySelector('[data-timeline-status]'),
    period: section.querySelector('[data-timeline-period]'),
  };
  const notice = (message) => {
    section.querySelector('[data-timeline-notice]').textContent = message;
  };
  const sync = createTimelineSync({
    client,
    storage,
    namespace,
    onChange: render,
    onIdentityChange() {
      if (dialog.open) dialog.close();
      page = 0;
      notice('账号已切换，日程按账号独立保存；未保存的编辑未写入新账号。');
    },
  });

  function render() {
    const store = sync.store;
    const all = store.all();
    const counts = timelineCounts(all);
    section.querySelector('[data-timeline-counts]').innerHTML = Object.entries({
      pending: '待完成',
      today: '今日待办',
      overdue: '已逾期',
      completed: '已完成',
    })
      .map(([key, label]) => `<span><b>${counts[key]}</b>${label}</span>`)
      .join('');
    const selection = Object.fromEntries(
      Object.entries(filters).map(([key, input]) => [key, input.value]),
    );
    const events = sortTimeline(all.filter((event) => matchesTimeline(event, selection)));
    page = Math.min(page, Math.max(0, Math.ceil(events.length / PAGE_SIZE) - 1));
    const shown = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const focused = document.activeElement?.closest('[data-timeline-action]');
    const focus = focused
      ? { id: focused.dataset.timelineId, action: focused.dataset.timelineAction }
      : null;
    const opened = new Set(
      [...tbody.querySelectorAll('details[open]')].map((d) => d.closest('tr').dataset.eventId),
    );
    tbody.innerHTML = shown
      .map((event) => {
        const phase = timelinePhase(event);
        const detail = event.notes || event.location || event.url;
        const button = (action, label) =>
          `<button type="button" data-timeline-action="${action}" data-timeline-id="${event.id}" aria-label="${esc(label + '：' + event.title)}">${label}</button>`;
        return `<tr data-event-id="${event.id}"><td data-label="时间"><time datetime="${esc(event.starts_at)}">${displayTime(event.starts_at)}</time>${event.ends_at ? `<small>至 ${displayTime(event.ends_at)}</small>` : '<small>计划时间 / 时间点</small>'}</td><td data-label="公司 / 事项"><span class="timeline-company">${esc(event.company_name || '未填写公司')}</span><strong>${esc(event.title)}</strong>${detail ? `<details${opened.has(event.id) ? ' open' : ''}><summary>地点、链接与备注</summary>${event.location ? `<p>${esc(event.location)}</p>` : ''}${event.url ? `<p><a href="${esc(safeHref(event.url))}" target="_blank" rel="noopener noreferrer">打开日程链接</a></p>` : ''}${event.notes ? `<p class="timeline-notes">${esc(event.notes)}</p>` : ''}</details>` : ''}</td><td data-label="类型">${TIMELINE_TYPES[event.event_type]}</td><td data-label="状态"><span class="timeline-phase phase-${phase}">${phaseLabels[phase]}</span></td><td data-label="操作"><div class="timeline-buttons">${event.status === 'pending' ? button('complete', '完成') : button('restore', '恢复待办')}${button('edit', '编辑')}${button('delete', '删除')}</div></td></tr>`;
      })
      .join('');
    if (focus && !dialog.open) {
      const row = tbody.querySelector(`[data-event-id="${focus.id}"]`);
      (
        row?.querySelector(`[data-timeline-action="${focus.action}"]`) ||
        row?.querySelector('button')
      )?.focus({ preventScroll: true });
    }
    section.querySelector('[data-timeline-table-wrap]').hidden = !events.length;
    const empty = section.querySelector('[data-timeline-empty]');
    empty.hidden = !!events.length;
    empty.textContent = all.some((e) => !e.is_deleted)
      ? '没有匹配的日程，请调整类型、状态、时间或关键词。'
      : '还没有日程。点击“新增日程”，或在公司卡片上点击“安排日程”。';
    section.querySelector('[data-timeline-page]').textContent = events.length
      ? `显示 ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, events.length)} / ${events.length} 条`
      : '0 条日程';
    section.querySelector('[data-timeline-prev]').disabled = page === 0;
    section.querySelector('[data-timeline-next]').disabled =
      (page + 1) * PAGE_SIZE >= events.length;
    const pending = store.pendingCount();
    let state =
      store.scope === 'guest'
        ? '仅本机保存 · 启用上方云端同步后可保存到账号'
        : sync.hasRemote
          ? '个人日程已同步'
          : '正在读取账号日程…';
    if (pending) state = `${pending} 项日程修改待同步`;
    if (sync.syncing) state = '正在同步个人日程…';
    if (store.lastError) state = timelineError(store.lastError);
    if (store.storageError) state = '本地日程存储不可用或损坏，请立即导出日程，不要关闭页面。';
    section.querySelector('[data-timeline-sync]').textContent = state;
    section.querySelector('[data-timeline-refresh]').hidden = store.scope === 'guest';
    section.querySelector('[data-timeline-refresh]').disabled = sync.syncing;
    const guest = new TimelineStore(storage, 'guest', { namespace });
    section.querySelector('[data-timeline-import]').hidden =
      store.scope === 'guest' || !guest.all().some((e) => !e.is_deleted);
    section.querySelector('[data-timeline-import]').disabled = sync.syncing;
  }

  function openEditor(event = null, item = null) {
    form.reset();
    dialog.querySelector('[data-timeline-feedback]').textContent = '';
    editingId = event?.id || null;
    editingScope = sync.store.scope;
    editingMutation = editingId ? sync.store.entries[editingId]?.mutationId : null;
    returnFocus = document.activeElement;
    dialog.querySelector('h2').textContent = event ? '编辑日程' : '新增日程';
    const select = form.elements.entry_id;
    select.replaceChildren(new Option('不关联卡片', ''));
    for (const row of items) select.add(new Option(row.name, row.id));
    if (event?.entry_id && !items.some((row) => row.id === event.entry_id))
      select.add(
        new Option((event.company_name || '已关联公司') + '（另一页卡片）', event.entry_id),
      );
    const values = event || {
      company_name: item?.name || '',
      entry_id: item?.id || '',
      event_type: 'assessment',
      status: 'pending',
    };
    for (const key of [
      'title',
      'company_name',
      'entry_id',
      'event_type',
      'status',
      'location',
      'url',
      'notes',
    ])
      form.elements[key].value = values[key] ?? '';
    form.elements.starts_at.value = toBeijingInput(event?.starts_at);
    form.elements.ends_at.value = toBeijingInput(event?.ends_at);
    dialog.showModal();
    form.elements.title.focus();
  }
  listen(section.querySelector('[data-timeline-add]'), 'click', () => openEditor());
  listen(form.elements.entry_id, 'change', () => {
    const item = items.find((row) => row.id === form.elements.entry_id.value);
    if (item) form.elements.company_name.value = item.name;
  });
  for (const selector of ['[data-timeline-close]', '[data-timeline-cancel]'])
    listen(dialog.querySelector(selector), 'click', () => dialog.close());
  listen(dialog, 'close', () => {
    form.reset();
    editingId = null;
    (returnFocus?.isConnected ? returnFocus : section.querySelector('[data-timeline-add]'))?.focus({
      preventScroll: true,
    });
  });
  listen(form, 'submit', (event) => {
    event.preventDefault();
    if (!dialog.open || !form.reportValidity()) return;
    try {
      if (editingScope !== sync.store.scope) throw new Error('账号已切换，请重新打开日程窗口');
      sync.store.reload();
      if (editingId && sync.store.entries[editingId]?.mutationId !== editingMutation)
        throw new Error('这条日程已在其他设备或标签页更新。请取消并重新打开，避免覆盖新内容。');
      const fields = Object.fromEntries(new FormData(form));
      const saved = sync.store.save({
        ...fields,
        id: editingId || crypto.randomUUID(),
        entry_id: fields.entry_id || null,
        starts_at: fromBeijingInput(fields.starts_at),
        ends_at: fields.ends_at ? fromBeijingInput(fields.ends_at) : null,
        is_deleted: false,
      });
      filters.query.value = '';
      for (const key of ['type', 'status', 'period']) filters[key].value = 'all';
      page = 0;
      dialog.close();
      sync.changed();
      notice(
        '已保存日程：' +
          saved.title +
          (sync.store.storageError ? '。本地存储失败，请立即导出。' : '。'),
      );
      render();
    } catch (error) {
      dialog.querySelector('[data-timeline-feedback]').textContent = error.message;
    }
  });
  listen(tbody, 'click', (event) => {
    const button = event.target.closest('[data-timeline-action]');
    if (!button) return;
    sync.store.reload();
    const row = sync.store.get(button.dataset.timelineId);
    if (!row || row.is_deleted) {
      render();
      return;
    }
    const action = button.dataset.timelineAction;
    if (action === 'edit') {
      openEditor(row);
      return;
    }
    if (action === 'delete' && !confirm(`删除“${row.title}”？这只删除个人日程，不影响招聘卡片。`))
      return;
    try {
      if (action === 'delete') sync.store.remove(row.id);
      else sync.store.save({ ...row, status: action === 'complete' ? 'completed' : 'pending' });
      sync.changed();
      notice(
        action === 'delete'
          ? '日程已删除。'
          : action === 'complete'
            ? '日程已标记完成。'
            : '日程已恢复为待办。',
      );
    } catch (error) {
      notice(error.message);
    }
  });
  for (const key of ['type', 'status', 'period'])
    listen(filters[key], 'change', () => {
      page = 0;
      render();
    });
  const disposeSearch = bindSearch(filters.query, () => {
    page = 0;
    render();
  });
  listen(section.querySelector('[data-timeline-prev]'), 'click', () => {
    page--;
    render();
  });
  listen(section.querySelector('[data-timeline-next]'), 'click', () => {
    page++;
    render();
  });
  listen(section.querySelector('[data-timeline-refresh]'), 'click', () => {
    void sync.refresh();
  });
  listen(section.querySelector('[data-timeline-import]'), 'click', async () => {
    if (!confirm('将本机访客日程复制到当前账号？已导入过的同一日程不会覆盖账号记录。')) return;
    try {
      notice(`已导入 ${await sync.importGuest()} 条日程。`);
    } catch (error) {
      notice(error.message);
    }
  });
  listen(section.querySelector('[data-timeline-export]'), 'click', () => {
    const events = sync.store.all().filter((row) => !row.is_deleted);
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, timezone: 'Asia/Shanghai', exportedAt: new Date().toISOString(), events },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download =
      'personal-timeline-' + toBeijingInput(new Date().toISOString()).slice(0, 10) + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('已导出当前身份的个人日程；文件含私人安排，请妥善保管。');
  });
  let lastWake = 0;
  const wake = () => {
    if (Date.now() - lastWake < 15000) return;
    lastWake = Date.now();
    sync.reload();
    void sync.refresh();
  };
  listen(window, 'focus', wake);
  listen(document, 'visibilitychange', () => {
    if (!document.hidden) wake();
  });
  listen(window, 'online', () => {
    void sync.refresh();
  });
  listen(window, 'storage', (event) => {
    if (event.key === sync.store.key) {
      sync.reload();
      sync.changed();
    } else if (event.key === 'recsys:timeline:v1:' + namespace + ':guest') render();
  });
  const clock = setInterval(render, 60000);
  render();
  return {
    setUser: sync.setUser,
    async importGuest() {
      try {
        const count = await sync.importGuest();
        if (count) notice(`已导入 ${count} 条本机日程；同步状态见上方提示。`);
      } catch (error) {
        // A timeline migration/network problem must not fail existing card-state sign-in.
        notice(error.message);
      }
    },
    pendingCount: () => sync.store.pendingCount(),
    openForCard: (item) => openEditor(null, item),
    setCatalog(next) {
      items = next.ALL_ITEMS;
    },
    dispose() {
      lifetime.abort();
      disposeSearch();
      clearInterval(clock);
      sync.dispose();
      dialog.remove();
      section.remove();
    },
  };
}
