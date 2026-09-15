import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const load = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const rec = load('rec');
const soe = load('soe');
const errors = new WeakMap();
const card = (page, id) => page.locator(`.card[data-entry-id="${id}"]`);

test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('review badges and the review filter follow the catalog date instead of a hard-coded date', async ({
  page,
}) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const all = [...rec.DATA, ...rec.EXTRA];
  const reviewed = all.filter((item) => item.rev === rec.RECHECKED);
  await expect(page.locator('.card')).toHaveCount(all.length);
  for (const item of reviewed) {
    await expect(card(page, item.id).locator('.s-rev')).toContainText(rec.RECHECKED);
  }
  await page.locator('.chip[data-filter="rev"]').click();
  await expect(page.locator('.card')).toHaveCount(reviewed.length);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('a campaign recheck does not turn old job counts or unsupported dates into current facts', async ({
  page,
}) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const bili = card(page, 'rec-cfc3d445066f6e83ca1d');
  await expect(bili.locator('.badges')).toContainText('官网正文·本次');
  await expect(bili.locator('.due-v')).toHaveText('滚动 / 截止待核');
  await expect(bili).toContainText('不作为实时数量');
  const vivo = card(page, 'rec-69337578b2468a881543');
  await expect(vivo).toHaveClass(/st-verify/);
  await expect(vivo.locator('.badges')).toContainText('当前需复核');
  await expect(vivo).toContainText('不因空正文认定停招');
});

test('conflicting notices stay visible without inheriting unrestricted-major eligibility', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(soe.DATA.length);
  const hz = card(page, 'soe-15dcc83203fa8d55b59c');
  await expect(hz).toHaveAttribute('data-major', 'unknown');
  await expect(hz).toHaveClass(/st-verify/);
  await expect(hz).toContainText('10/22');
  await expect(hz).toContainText('10/25');
  await expect(hz).toContainText('模板字段');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('new work-city evidence supports technical filters without borrowing interview cities', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(soe.DATA.length);
  await page.locator('#track-filter').selectOption('software');
  for (const city of ['杭州', '成都']) {
    await page.locator('#location-filter').selectOption(city);
    await expect(card(page, 'soe-760d8065c74679611ff9')).toHaveCount(1);
    await expect(card(page, 'soe-946c8b35a6045d05921e')).toHaveCount(1);
  }
  for (const city of ['重庆', '西安']) {
    await page.locator('#location-filter').selectOption(city);
    await expect(card(page, 'soe-760d8065c74679611ff9')).toHaveCount(0);
  }
});
