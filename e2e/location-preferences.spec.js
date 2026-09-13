import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const catalog = JSON.parse(fs.readFileSync(new URL('../data/soe.json', import.meta.url), 'utf8'));
const errors = new WeakMap();
const cardByName = (page, name) =>
  page.locator('.card').filter({ has: page.locator('h3.name').filter({ hasText: name }) });
test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(catalog.DATA.length);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
test('all locations remain the default and nonpreferred opportunities remain visible', async ({
  page,
}) => {
  await expect(page.locator('#location-filter')).toHaveValue('all');
  await expect(cardByName(page, '建信人寿 · 精算')).toHaveCount(1);
  await expect(page.locator('#location-policy')).toContainText('杭州、成都、重庆、西安');
});
test('Hangzhou filtering requires city evidence instead of a company name or headquarters', async ({
  page,
}) => {
  await page.locator('#location-filter').selectOption('杭州');
  await expect(cardByName(page, '浙江省商业集团')).toHaveCount(1);
  await expect(cardByName(page, '杭州银行 · 总分行')).toHaveCount(0);
  await expect(cardByName(page, '建信人寿 · 精算')).toHaveCount(0);
  await page.locator('#location-filter').selectOption('浙江');
  await expect(cardByName(page, '杭州银行 · 总分行')).toHaveCount(1);
});
test('research plus Hangzhou cannot borrow locations from an unrelated business job', async ({
  page,
}) => {
  await page.locator('#location-filter').selectOption('杭州');
  await page.locator('#track-filter').selectOption('research');
  await expect(cardByName(page, '浙江省商业集团')).toHaveCount(1);
  await expect(cardByName(page, '国贸股份')).toHaveCount(0);
  await page.locator('#track-filter').selectOption('supply');
  await expect(cardByName(page, '国贸股份')).toHaveCount(1);
});
test('Chengdu Chongqing and Xian are independently filterable and keep state transitions', async ({
  page,
}) => {
  for (const city of ['成都', '重庆', '西安']) {
    await page.locator('#location-filter').selectOption(city);
    await expect(cardByName(page, '重庆三峡')).toHaveCount(1);
  }
  const card = cardByName(page, '重庆三峡');
  const id = await card.getAttribute('data-entry-id');
  await card.locator('[data-card-state="applied"]').click();
  await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
  await page.locator('#location-filter').selectOption('杭州');
  await expect(page.locator('[data-entry-id="' + id + '"]')).toHaveCount(0);
  await page.locator('#location-filter').selectOption('重庆');
  await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
});
test('geographic controls have accessible labels and fit the mobile viewport', async ({ page }) => {
  await expect(page.getByRole('combobox', { name: '筛选已核工作地区' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.locator('#location-filter').selectOption('杭州');
  const card = cardByName(page, '国贸股份');
  await expect(card.locator('[data-location-bonus]')).toHaveAttribute('data-location-bonus', '8');
  await expect(card.locator('.location-summary')).toContainText('行业研究');
});
