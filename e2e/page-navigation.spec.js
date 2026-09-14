import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const rec = JSON.parse(fs.readFileSync(new URL('../data/rec.json', import.meta.url), 'utf8'));
const totalNodes = rec.TIMELINE_EVENTS.length + 1;
const preferenceKey = 'recsys:layout:v1:rec:public-timeline';
const errors = new WeakMap();

test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"isolated navigation test"}',
    });
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
async function open(page, file = 'index.html') {
  await page.goto(file, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('#personal-timeline')).toBeVisible();
}
async function notCovered(page, target, includeFilters = false) {
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      const bar = await page.locator(includeFilters ? '.toolbar' : '.page-directory').boundingBox();
      return box && bar ? box.y - (bar.y + bar.height) : -999;
    })
    .toBeGreaterThanOrEqual(-1);
}

for (const file of ['index.html', 'soe.html']) {
  test(
    'navigation: private timeline comes before account and recruitment content on ' + file,
    async ({ page }, testInfo) => {
      await open(page, file);
      const order = await page
        .locator('#main-content > *')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) =>
              node.matches('.page-directory, #personal-timeline, #personal-workspace, .hero'),
            )
            .map((node) => node.id || node.className),
        );
      expect(order).toEqual([
        'page-directory',
        'personal-timeline',
        'personal-workspace',
        'recruitment-overview',
      ]);
      await expect(page.getByRole('heading', { name: '我的时间线', exact: true })).toBeInViewport();
      await expect(page.locator('[data-timeline-sync]')).toContainText('下方投递工作台');
      const links = await page
        .getByRole('navigation', { name: '页面目录' })
        .locator('a')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            href: node.getAttribute('href'),
            exists: !!document.getElementById(node.hash.slice(1)),
          })),
        );
      expect(links.length).toBeGreaterThanOrEqual(7);
      expect(links.every((link) => link.exists)).toBe(true);
      expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('top-workspace.png'),
        animations: 'disabled',
      });
      await page.locator('[data-timeline-add]').click();
      await expect(page.getByRole('dialog', { name: '新增日程' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-timeline-add]')).toBeFocused();
    },
  );

  test(
    'navigation: sticky directory, keyboard anchors and source links on ' + file,
    async ({ page }) => {
      await open(page, file);
      const directory = page.getByRole('navigation', { name: '页面目录' });
      const jobs = directory.getByRole('link', { name: '招聘卡片', exact: true });
      await jobs.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#job-list$/);
      await expect(page.locator('#job-list')).toBeFocused();
      await notCovered(page, page.locator('#job-list'));
      await expect(jobs).toHaveAttribute('aria-current', 'location');
      await directory.getByRole('link', { name: '复核与来源', exact: true }).click();
      await expect(page.locator('#audit-panel')).toBeFocused();
      await notCovered(page, page.locator('#audit-panel'), true);
      await page.goBack();
      await expect(page).toHaveURL(/#job-list$/);
      await expect(page.locator('#job-list')).toBeFocused();
      await directory.getByRole('link', { name: '投递与同步', exact: true }).click();
      await expect(page.locator('#personal-workspace')).toBeFocused();
      await page.locator('[data-account]').click();
      await expect(page.locator('.account-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await directory.getByRole('link', { name: '我的时间线', exact: true }).click();
      await expect(page.locator('#personal-timeline')).toBeFocused();
      await notCovered(page, page.locator('#personal-timeline'));
      // Existing evidence anchors still open the nested source disclosure.
      await page.goto(file + '#src-' + (file === 'index.html' ? 'R01' : 'H02'));
      await expect(page.locator('#source-index')).toHaveJSProperty('open', true);
      const source = page.locator(file === 'index.html' ? '#src-R01' : '#src-H02');
      await expect(source).toBeFocused();
      await notCovered(page, source, true);
    },
  );
}

test('navigation: public timeline collapse preserves nodes, filtering, today and preferences', async ({
  page,
}, testInfo) => {
  await open(page);
  const fold = page.locator('#timeline');
  const summary = fold.locator(':scope > summary');
  await expect(fold).toHaveJSProperty('open', false);
  await expect(page.locator('#rail > li')).toHaveCount(totalNodes);
  await expect(page.locator('#rail')).not.toBeVisible();
  await expect(summary.locator('.when-collapsed')).toBeVisible();
  await summary.click();
  await expect(fold).toHaveJSProperty('open', true);
  await expect(summary.locator('.when-expanded')).toBeVisible();
  await page.locator('[data-rail-filter=deadline]').click();
  const filtered = await page.locator('#rail > li').count();
  expect(filtered).toBeLessThan(totalNodes);
  await page.locator('#jump-today').click();
  await expect(page.locator('#rail-today-marker')).toBeFocused();
  await summary.click();
  await summary.press('Enter');
  await expect(fold).toHaveJSProperty('open', true);
  await expect(page.locator('[data-rail-filter=deadline]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rail > li')).toHaveCount(filtered);
  await page.locator('[data-rail-filter=all]').click();
  await expect(page.locator('#rail > li')).toHaveCount(totalNodes);
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((html, value) => {
      html.dataset.theme = value;
    }, theme);
    const result = await new AxeBuilder({ page })
      .include('#timeline')
      .include('.page-directory')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('public-timeline-expanded.png'),
    animations: 'disabled',
  });
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), preferenceKey))
    .toBe('open');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(fold).toHaveJSProperty('open', true);
  await summary.press('Space');
  await expect(fold).toHaveJSProperty('open', false);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), preferenceKey))
    .toBe('closed');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(fold).toHaveJSProperty('open', false);
});

test('navigation: public deep links and a repeated same-hash click open the closed timeline', async ({
  page,
}) => {
  await open(page, 'index.html#timeline');
  const fold = page.locator('#timeline');
  const summary = fold.locator(':scope > summary');
  await expect(fold).toHaveJSProperty('open', true);
  await expect(summary).toBeFocused();
  await summary.click();
  await expect(fold).toHaveJSProperty('open', false);
  await page
    .getByRole('navigation', { name: '页面目录' })
    .getByRole('link', { name: '2027 届时间线', exact: true })
    .click();
  await expect(fold).toHaveJSProperty('open', true);
  await expect(summary).toBeFocused();
  await notCovered(page, summary);
  await summary.click();
  await page.goto('index.html#rail-today-marker');
  await expect(fold).toHaveJSProperty('open', true);
  await expect(page.locator('#rail-today-marker')).toBeFocused();
  await page.goto('index.html#%E0%A4%A');
  await expect(page.locator('#personal-timeline')).toBeVisible();
});

test('navigation: storage failures do not block folding or navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('recsys:layout:')) throw new DOMException('blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('recsys:layout:')) throw new DOMException('blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await open(page);
  await page.locator('#timeline > summary').click();
  await expect(page.locator('#timeline')).toHaveJSProperty('open', true);
  await page.locator('#timeline > summary').click();
  await expect(page.locator('#timeline')).toHaveJSProperty('open', false);
  await page
    .getByRole('navigation', { name: '页面目录' })
    .getByRole('link', { name: '2027 届时间线', exact: true })
    .click();
  await expect(page.locator('#rail')).toBeVisible();
});

test('navigation: printing temporarily expands public events without changing screen preferences', async ({
  page,
}) => {
  await open(page);
  const fold = page.locator('#timeline');
  await expect(fold).toHaveJSProperty('open', false);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(fold).toHaveJSProperty('open', true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#rail')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '页面目录' })).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(fold).toHaveJSProperty('open', false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(fold).toHaveJSProperty('open', false);
});
