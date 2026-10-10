import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { StateStore } from '../src/state-store.js';
import { loadCatalogs, normalizeCatalogs } from '../scripts/catalog-data.mjs';
const catalogs = loadCatalogs();
const count = catalogs.div.DATA.length;
const errors = new WeakMap();
const stateKey = 'recsys:cards:v1:npqrixancnwbmzcyqafx:guest';
async function open(page) {
  await page.goto('div.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(count);
}
async function advanced(page) {
  await page.locator('#advanced-filters').evaluate((node) => {
    node.open = true;
  });
}
test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: '{"message":"isolated test"}',
        }),
  );
  await context.routeWebSocket('**/*', (socket) => socket.close());
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('diverse: offline snapshot, defaults and three-column navigation render without cloud', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('多元机会');
  await expect(page.locator('#leadership')).toHaveValue('hide_required');
  await expect(page.locator('#n-div')).toHaveText(String(count));
  const screening = JSON.parse(
    fs.readFileSync(new URL('../data/div-screening.json', import.meta.url), 'utf8'),
  );
  const roles = Object.values(screening.entries).reduce(
    (sum, row) => sum + row.positions.length,
    0,
  );
  await expect(page.locator('#count')).toContainText(roles + ' 条岗位记录');
  await expect(page.getByRole('navigation', { name: '招聘专栏' }).getByRole('link')).toHaveCount(3);
  await expect(page.locator('#personal-workspace')).toBeVisible();
  await expect(page.locator('#personal-timeline')).toBeVisible();
});

test('diverse: combined filters do not mix one role city with another role direction', async ({
  page,
}) => {
  await open(page);
  await advanced(page);
  await page.locator('#city').selectOption('上海');
  await page.locator('#direction').selectOption('ai');
  await expect(page.locator('.card[data-name="卡特彼勒"]')).toHaveCount(0);
  await expect(page.locator('.card[data-name="上海人工智能实验室"]')).toHaveCount(1);
  await page.locator('#reset-filters').click();
  await page.locator('#city').selectOption('重庆');
  await page.locator('#direction').selectOption('operations');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('华夏航空');
  await page.locator('#direction').selectOption('quant');
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#reset-filters').click();
  await expect(page.locator('.card')).toHaveCount(count);
});

test('diverse: leadership preference is not excluded as a hard requirement', async ({ page }) => {
  await open(page);
  await advanced(page);
  await page.locator('#q').fill('华夏航空');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card-details > summary').click();
  await expect(page.locator('.card')).toContainText('优先');
  await page.locator('#leadership').selectOption('not_stated');
  await expect(page.locator('.card')).toHaveCount(0);
  await page.locator('#leadership').selectOption('preferred');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('#leadership').selectOption('required');
  await expect(page.locator('.card')).toHaveCount(0);
});

test('diverse: marking and restoring persist without changing existing rec and soe states', async ({
  context,
  page,
}) => {
  const disk = new Map(),
    store = new StateStore({
      getItem: (k) => disk.get(k) ?? null,
      setItem: (k, v) => disk.set(k, v),
    });
  const rec = catalogs.rec.DATA[0].id,
    soe = catalogs.soe.DATA[0].id;
  store.set(rec, 'applied');
  store.set(soe, 'uninterested');
  await context.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: store.key, value: disk.get(store.key) },
  );
  await open(page);
  const card = page.locator('#grid .card').first(),
    id = await card.getAttribute('data-entry-id');
  await card.locator('[data-card-state="applied"]').click();
  await expect(page.locator('#processed-grid .card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#processed-grid .card')).toHaveCount(1);
  const states = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).entries,
    stateKey,
  );
  expect(states[rec].status).toBe('applied');
  expect(states[soe].status).toBe('uninterested');
  expect(states[id].status).toBe('applied');
  await page.locator('#processed-grid [data-card-state="active"]').click();
  await expect(page.locator('#grid .card')).toHaveCount(count);
  await expect(page.locator('#processed-wrap')).toBeHidden();
});

test('diverse: new card interview follows user across the two original pages', async ({ page }) => {
  await open(page);
  const card = page.locator('#grid .card').first(),
    entry = await card.getAttribute('data-entry-id');
  await card.locator('[data-timeline-card]').click();
  const dialog = page.locator('.timeline-dialog');
  await expect(dialog.locator('[name="entry_id"]')).toHaveValue(entry);
  await dialog.locator('[name="title"]').fill('多元机会测试面试');
  await dialog.locator('[name="event_type"]').selectOption('interview');
  await dialog.locator('[name="starts_at"]').fill('2099-10-11T09:00');
  await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(page.locator('[data-event-id]')).toContainText('多元机会测试面试');
  await page.goto('index.html');
  await expect(page.locator('[data-event-id]')).toContainText('多元机会测试面试');
  await page.goto('soe.html');
  await expect(page.locator('[data-event-id]')).toContainText('多元机会测试面试');
  const promise = page.waitForEvent('download');
  await page.locator('[data-timeline-export]').click();
  const exported = JSON.parse(fs.readFileSync(await (await promise).path(), 'utf8'));
  expect(exported.events[0].entry_id).toBe(entry);
});

test('diverse: references expand the source panel and data export retains screening evidence', async ({
  page,
}) => {
  await open(page);
  await page.locator('#q').fill('汇丰科技');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card-details > summary').click();
  await page.locator('.card a[href="#src-D001"]').first().click();
  await expect(page.locator('#source-index')).toHaveAttribute('open', '');
  await expect(page.locator('#src-D001')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('#export-btn').click();
  const exported = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
  expect(exported.kind).toBe('div');
  expect(exported.items).toHaveLength(count);
  expect(Object.keys(exported.screening.entries)).toHaveLength(count);
  expect(exported.sources.D001).toBeTruthy();
  expect(Object.values(exported.screening.entries).every((a) => a.matched)).toBe(true);
});

test('diverse: existing employers link to the original searchable card, not duplicate state', async ({
  page,
}) => {
  await open(page);
  await page.locator('#existing-opportunities > summary').click();
  await page
    .locator('#existing-list')
    .getByRole('link', { name: '同花顺 → 原专栏', exact: true })
    .click();
  await expect(page.locator('#q')).toHaveValue('同花顺');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toHaveAttribute('data-entry-id', 'rec-99da41b4a60e34d30b0c');
  await page.getByRole('link', { name: '多元机会', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(count);
});

test('diverse: failed page chunk shows recoverable error and retry', async ({ context, page }) => {
  const pattern = /\/assets\/div-[^/]+\.js$/;
  await context.route(pattern, (route) => route.abort('failed'));
  await page.goto('div.html');
  await expect(page.locator('#app-loading')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#app-loading')).toContainText('页面初始化失败');
  await context.unroute(pattern);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(count);
});

test('diverse: light and dark themes are accessible and narrow layouts do not overflow', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await open(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  if (testInfo.project.name === 'mobile') {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await advanced(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
  } else
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  await page.screenshot({
    path: 'test-results/diverse/' + testInfo.project.name + '.png',
    fullPage: true,
    scale: 'css',
  });
});

async function mockPublicCatalog(context, tables) {
  await context.route('https://npqrixancnwbmzcyqafx.supabase.co/rest/v1/**', (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').at(-1);
    if (!tables[table]) return route.fulfill({ status: 403, body: '{}' });
    const kind = url.searchParams.get('kind')?.replace('eq.', '');
    let rows = tables[table].filter((row) => !kind || row.kind === kind);
    if (table === 'job_entries')
      rows = rows.map((row) => ({
        ...row,
        companies: tables.companies.find((c) => c.id === row.company_id),
        ...Object.fromEntries(
          ['entry_links', 'entry_audits', 'entry_deadlines', 'job_sources'].map((t) => [
            t,
            tables[t].filter((c) => c.entry_id === row.id),
          ]),
        ),
      }));
    const offset = Number(url.searchParams.get('offset') || 0),
      limit = Number(url.searchParams.get('limit') || 500);
    const selected = rows.slice(offset, offset + limit);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range',
        'content-range': selected.length
          ? offset + '-' + (offset + selected.length - 1) + '/' + rows.length
          : '*/0',
      },
      body: JSON.stringify(table === 'catalog_archives' ? rows[0] : selected),
    });
  });
}

test('diverse review: text search cannot borrow qualifications from a different-city role', async ({
  page,
}) => {
  await open(page);
  await advanced(page);
  await page.locator('#city').selectOption('上海');
  await page.locator('#q').fill('卡特彼勒 自然语言');
  await expect(page.locator('.card')).toHaveCount(0);
  await page.locator('#city').selectOption('无锡');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.div-matched')).toContainText('1 / 2');
  await page.locator('#q').fill('卡特彼勒 SQL');
  await expect(page.locator('.card')).toHaveCount(0);
});

test('diverse review: reset includes the personal filter but never clears marks', async ({
  page,
}) => {
  await open(page);
  const card = page.locator('#grid .card').first();
  const id = await card.getAttribute('data-entry-id');
  await card.locator('[data-card-state="applied"]').click();
  await page.locator('[data-personal-filter]').selectOption('applied');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('#reset-filters').click();
  await expect(page.locator('[data-personal-filter]')).toHaveValue('all');
  await expect(page.locator('#leadership')).toHaveValue('hide_required');
  await expect(page.locator('.card')).toHaveCount(count);
  await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
});

test('diverse review: actual cloud-shaped hydration keeps all assessments and only cited sources', async ({
  context,
  page,
}) => {
  await mockPublicCatalog(context, normalizeCatalogs(catalogs));
  await open(page);
  await expect(page.locator('[data-catalog-mode]')).toContainText('云端招聘资料');
  await expect(page.locator('.div-matched')).toHaveCount(count);
  expect(await page.locator('.div-matched').allTextContents()).toEqual(
    expect.arrayContaining([expect.stringContaining('当前筛选命中')]),
  );
  await expect(page.locator('.source-entry')).toHaveCount(Object.keys(catalogs.div.SOURCES).length);
  await expect(page.locator('.card')).not.toContainText(['评估已失效']);
});

test('diverse review: cloud evidence invalidation cannot silently broaden a selected city', async ({
  context,
  page,
}) => {
  const tables = normalizeCatalogs(catalogs);
  await mockPublicCatalog(context, tables);
  await open(page);
  await expect(page.locator('[data-catalog-mode]')).toContainText('云端招聘资料');
  await advanced(page);
  await page.locator('#city').selectOption('广州');
  // New employers may legitimately add Guangzhou roles; the city is not a unique employer key.
  const screening = JSON.parse(
    fs.readFileSync(new URL('../data/div-screening.json', import.meta.url), 'utf8'),
  );
  const cityCount = Object.values(screening.entries).filter((row) =>
    row.positions.some(
      (position) => position.cities.includes('广州') && position.leadership !== 'required',
    ),
  ).length;
  expect(cityCount).toBeGreaterThan(0);
  await expect(page.locator('.card')).toHaveCount(cityCount);
  await page.locator('.card [data-card-state="applied"]').first().click();
  for (const row of tables.job_entries) if (row.kind === 'div') row.requirements += ' 变更后须复核';
  await expect(page.locator('[data-refresh-catalog]')).toBeEnabled();
  await page.locator('[data-refresh-catalog]').click();
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.locator('#city')).toHaveValue('广州');
  await page.locator('#reset-filters').click();
  await expect(page.locator('.card')).toHaveCount(count);
  await expect(page.locator('.card').first()).toContainText('评估已失效');
  await expect(page.locator('#processed-grid .card')).toHaveCount(1);
  await expect(page.locator('#n-current')).toHaveText('0');
});
