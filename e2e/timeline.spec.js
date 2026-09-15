import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { TimelineStore } from '../src/timeline-store.js';
import { normalizeTimelineEvent } from '../src/timeline-model.js';

const host = 'npqrixancnwbmzcyqafx.supabase.co';
const namespace = 'npqrixancnwbmzcyqafx';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const errors = new WeakMap();
function fixture(overrides = {}) {
  return normalizeTimelineEvent({
    id: crypto.randomUUID(),
    title: '测试日程',
    company_name: '测试公司',
    event_type: 'assessment',
    starts_at: '2026-09-15T09:00:00+08:00',
    ends_at: null,
    status: 'pending',
    entry_id: null,
    notes: '',
    url: '',
    location: '',
    is_deleted: false,
    ...overrides,
  });
}
async function seedGuest(context, events) {
  const disk = new Map();
  const store = new TimelineStore(
    { getItem: (key) => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) },
    'guest',
    { namespace },
  );
  events.forEach((event) => store.save(event));
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: store.key,
    value: disk.get(store.key),
  });
}
async function isolate(context) {
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'isolated test network' }),
    });
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
}
async function open(page, file = 'index.html') {
  await page.goto(file, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('#personal-timeline')).toBeVisible();
}
async function add(
  page,
  {
    title = '秋招在线测评',
    type = 'assessment',
    start = '2099-09-15T09:00',
    end = '',
    company = '测试公司',
  } = {},
) {
  await page.locator('[data-timeline-add]').click();
  const dialog = page.locator('.timeline-dialog');
  await dialog.locator('[name=title]').fill(title);
  await dialog.locator('[name=company_name]').fill(company);
  await dialog.locator('[name=event_type]').selectOption(type);
  await dialog.locator('[name=starts_at]').fill(start);
  if (end) await dialog.locator('[name=ends_at]').fill(end);
  await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await isolate(context);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

for (const file of ['index.html', 'soe.html']) {
  test(
    'timeline: card entry, cross-page CRUD and private export from ' + file,
    async ({ page }, testInfo) => {
      await open(page, file);
      const card = page.locator('#grid .card').first();
      // Offscreen cards use content-visibility; textContent does not depend on painting.
      const company = (await card.locator('.name').textContent()).trim();
      const entry = await card.getAttribute('data-entry-id');
      await card.locator('[data-timeline-card]').click();
      const dialog = page.locator('.timeline-dialog');
      await expect(dialog.locator('[name=company_name]')).toHaveValue(company);
      await expect(dialog.locator('[name=entry_id]')).toHaveValue(entry);
      await dialog.locator('[name=title]').fill('秋招笔试安排');
      await dialog.locator('[name=event_type]').selectOption('written_test');
      await dialog.locator('[name=starts_at]').fill('2099-09-15T09:00');
      await dialog.locator('[name=ends_at]').fill('2099-09-15T11:00');
      await dialog.locator('[name=notes]').fill('准备身份证\n提前进入考场');
      await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
      await expect(page.locator('[data-event-id]')).toHaveCount(1);
      await expect(page.locator('[data-event-id]')).toContainText(company);
      await open(page, file === 'index.html' ? 'soe.html' : 'index.html');
      await expect(page.locator('[data-event-id]')).toContainText('秋招笔试安排');
      await page.locator('[data-timeline-action=complete]').click();
      await expect(page.locator('.phase-completed')).toHaveCount(1);
      await page.locator('[data-timeline-status]').selectOption('pending');
      await expect(page.locator('[data-event-id]')).toHaveCount(0);
      await page.locator('[data-timeline-status]').selectOption('all');
      await page.locator('[data-timeline-action=edit]').click();
      await expect(dialog.locator('[name=entry_id]')).toHaveValue(entry);
      await dialog.locator('[name=title]').fill('技术一面');
      await dialog.locator('[name=event_type]').selectOption('interview');
      await dialog.locator('[name=status]').selectOption('pending');
      await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
      await expect(page.locator('[data-event-id]')).toContainText('技术一面');
      const download = page.waitForEvent('download');
      await page.locator('[data-timeline-export]').click();
      const exported = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
      expect(exported.timezone).toBe('Asia/Shanghai');
      expect(exported.events).toHaveLength(1);
      expect(exported.events[0].entry_id).toBe(entry);
      expect(exported.events[0].starts_at).toBe('2099-09-15T01:00:00.000Z');
      expect(exported.events[0].user_id).toBeUndefined();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-event-id]')).toContainText('技术一面');
      if (file === 'index.html')
        await page
          .locator('#personal-timeline')
          .screenshot({ path: 'test-results/timeline-' + testInfo.project.name + '.png' });
      page.once('dialog', (prompt) => prompt.accept());
      await page.locator('[data-timeline-action=delete]').click();
      await expect(page.locator('[data-event-id]')).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-event-id]')).toHaveCount(0);
      await expect(page.locator('#processed-grid .card')).toHaveCount(0);
    },
  );
}

test('timeline: fixed Beijing clock, combined filters and pagination', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Date.now = () => Date.parse('2026-09-15T12:00:00+08:00');
  });
  await seedGuest(context, [
    fixture({ title: '已逾期测评' }),
    fixture({
      title: '今天下午面试',
      event_type: 'interview',
      starts_at: '2026-09-15T15:00:00+08:00',
    }),
    fixture({
      title: '未来笔试',
      event_type: 'written_test',
      starts_at: '2026-09-17T09:00:00+08:00',
    }),
    ...Array.from({ length: 22 }, (_, i) =>
      fixture({ title: '已完成记录' + i, status: 'completed' }),
    ),
  ]);
  await open(page);
  await expect(page.locator('[data-event-id]')).toHaveCount(20);
  await page.locator('[data-timeline-next]').click();
  await expect(page.locator('[data-event-id]')).toHaveCount(5);
  await page.locator('[data-timeline-status]').selectOption('pending');
  await page.locator('[data-timeline-period]').selectOption('today');
  await expect(page.locator('[data-event-id]')).toHaveCount(2);
  await page.locator('[data-timeline-type]').selectOption('interview');
  await expect(page.locator('[data-event-id]')).toContainText('今天下午面试');
  await page.locator('[data-timeline-type]').selectOption('all');
  await page.locator('[data-timeline-period]').selectOption('overdue');
  await expect(page.locator('[data-event-id]')).toContainText('已逾期测评');
  await page.locator('[data-timeline-period]').selectOption('week');
  await expect(page.locator('[data-event-id]')).toHaveCount(2);
  await page.locator('[data-timeline-query]').fill('未来笔试');
  await expect(page.locator('[data-event-id]')).toHaveCount(1);
});

test('timeline: form validation, inert user text, keyboard dismissal and responsive accessibility', async ({
  page,
}, testInfo) => {
  await open(page);
  await page.locator('[data-timeline-add]').click();
  const dialog = page.locator('.timeline-dialog');
  await expect(dialog.locator('[name=title]')).toBeFocused();
  await dialog.locator('[name=title]').fill('<img src=x onerror="window.__attack=1">');
  await dialog.locator('[name=starts_at]').fill('2099-09-15T12:00');
  await dialog.locator('[name=ends_at]').fill('2099-09-15T11:00');
  await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(dialog.locator('[data-timeline-feedback]')).toContainText('晚于');
  await dialog.locator('[name=ends_at]').fill('2099-09-15T13:00');
  await dialog.locator('[name=url]').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(dialog.locator('[data-timeline-feedback]')).toContainText('HTTP');
  await dialog.locator('[name=url]').fill('https://example.test/interview');
  await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(page.locator('[onerror], a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__attack)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((html, value) => {
      html.dataset.theme = value;
    }, theme);
    let scan = await new AxeBuilder({ page })
      .include('#personal-timeline')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.locator('[data-timeline-action=edit]').click();
    scan = await new AxeBuilder({ page })
      .include('.timeline-dialog')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    await testInfo.attach('timeline-accessibility-' + theme, {
      body: JSON.stringify(scan),
      contentType: 'application/json',
    });
    expect(scan.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(dialog.locator('[name=title]')).toHaveValue('');
  }
});

test('timeline: quota failure warns and still allows a private in-memory export', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('recsys:timeline:')) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await open(page);
  await add(page);
  await expect(page.locator('[data-timeline-sync]')).toContainText('本地日程存储不可用');
  await expect(page.locator('[data-event-id]')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('[data-timeline-export]').click();
  expect(JSON.parse(fs.readFileSync(await (await download).path(), 'utf8')).events).toHaveLength(1);
});

test('timeline: browser tabs share guest events without writing production data', async ({
  page,
  context,
}) => {
  await open(page);
  const second = await context.newPage();
  await open(second, 'soe.html');
  await add(page);
  await expect(second.locator('[data-event-id]')).toHaveCount(1);
  await second.locator('[data-timeline-action=complete]').click();
  await expect(page.locator('.phase-completed')).toHaveCount(1);
  await second.close();
});

function session(userId) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token =
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') +
    '.' +
    Buffer.from(
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp }),
    ).toString('base64url') +
    '.isolated-fixture';
  return {
    access_token: token,
    token_type: 'bearer',
    refresh_token: 'isolated-fixture',
    expires_in: 3600,
    expires_at: exp,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'timeline@example.invalid',
      is_anonymous: false,
      email_confirmed_at: '2026-09-14T00:00:00Z',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-09-14T00:00:00Z',
    },
  };
}
async function mockAccount(context, owner, server, flags) {
  await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), {
    key: 'sb-' + namespace + '-auth-token',
    data: session(owner),
  });
  await context.route('https://' + host + '/rest/v1/**', (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const table = url.pathname.split('/').at(-1);
    if (table === 'user_card_states')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '*/0' },
        body: '[]',
      });
    if (table !== 'user_timeline_events') return route.fulfill({ status: 503, body: '{}' });
    if (flags.fail)
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST205', message: 'table not installed' }),
      });
    if (request.method() === 'POST') {
      const rows = request.postDataJSON();
      expect(rows.every((row) => row.user_id === owner)).toBe(true);
      const result = rows.map((row) => ({
        ...row,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      result.forEach((row) => server.set(row.user_id + ':' + row.id, row));
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(result),
      });
    }
    expect(url.searchParams.get('user_id')).toBe('eq.' + owner);
    const rows = [...server.values()].filter((row) => row.user_id === owner);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
      body: JSON.stringify(rows),
    });
  });
}

test('timeline: account sync, failed migration recovery, cross-device changes and private isolation', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const server = new Map(),
    flags = { fail: true };
  await mockAccount(context, A, server, flags);
  await open(page);
  await expect(page.locator('[data-timeline-sync]')).toContainText('迁移');
  await add(page, { title: '同账号面试', type: 'interview' });
  await expect(page.locator('[data-timeline-sync]')).toContainText('本机记录仍保留');
  expect(server.size).toBe(0);
  flags.fail = false;
  await page.locator('[data-timeline-refresh]').click();
  await expect(page.locator('[data-timeline-sync]')).toHaveText('个人日程已同步');
  expect(server.size).toBe(1);
  const secondContext = await browser.newContext({ baseURL });
  const otherContext = await browser.newContext({ baseURL });
  try {
    await isolate(secondContext);
    await isolate(otherContext);
    await mockAccount(secondContext, A, server, flags);
    await mockAccount(otherContext, B, server, flags);
    const second = await secondContext.newPage(),
      other = await otherContext.newPage();
    await open(second, 'soe.html');
    await open(other);
    await expect(second.locator('[data-event-id]')).toContainText('同账号面试');
    await expect(other.locator('[data-timeline-sync]')).toHaveText('个人日程已同步');
    await expect(other.locator('[data-event-id]')).toHaveCount(0);
    await second.locator('[data-timeline-action=complete]').click();
    await expect(second.locator('[data-timeline-sync]')).toHaveText('个人日程已同步');
    await page.locator('[data-timeline-refresh]').click();
    await expect(page.locator('.phase-completed')).toHaveCount(1);
    page.once('dialog', (prompt) => prompt.accept());
    await page.locator('[data-timeline-action=delete]').click();
    await expect(page.locator('[data-timeline-sync]')).toHaveText('个人日程已同步');
    await second.locator('[data-timeline-refresh]').click();
    await expect(second.locator('[data-event-id]')).toHaveCount(0);
  } finally {
    await secondContext.close();
    await otherContext.close();
  }
});
