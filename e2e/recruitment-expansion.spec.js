import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const read = (name) => JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const report = read('docs/recruitment-expansion-2026-10-10.json');
const record = (key) => report.records.find((e) => e.key === key);
const card = (page, key) => page.locator('.card[data-entry-id="' + record(key).entryId + '"]');
const errors = new WeakMap();
test.beforeEach(async ({ page, context }) => {
  errors.set(page, []);
  page.on('pageerror', (e) => errors.get(page).push(e.message));
  await page.clock.install({ time: new Date('2026-10-10T12:00:00+08:00') });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await context.routeWebSocket('**/*', (socket) => socket.close());
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

for (const [kind, file] of [
  ['rec', 'index.html'],
  ['soe', 'soe.html'],
  ['div', 'div.html'],
]) {
  test(
    'expansion ' + kind + ': all new and old cards load from the complete static snapshot',
    async ({ page }) => {
      const d = read('data/' + kind + '.json'),
        items = [...d.DATA, ...(d.EXTRA || [])];
      await page.goto(file);
      await expect(page.locator('.card')).toHaveCount(items.length);
      for (const e of report.records.filter((e) => e.kind === kind && e.decision === 'new'))
        await expect(card(page, e.key)).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    },
  );
}

test('expansion: new REC business data roles remain searchable and marking does not remove unrelated cards', async ({
  page,
}) => {
  await page.goto('index.html');
  await page.locator('#q').fill('扬腾创新');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, 'yangteng')).toContainText('商业分析');
  await card(page, 'yangteng').locator('[data-card-state="applied"]').click();
  await expect(page.locator('#processed-grid .card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#processed-grid .card')).toHaveCount(1);
  const rec = read('data/rec.json');
  // REC renders core and supplemental employers in distinct grids.
  await expect(page.locator('#grid .card')).toHaveCount(rec.DATA.length);
  await expect(page.locator('#extra .card')).toHaveCount(rec.EXTRA.length - 1);
  await expect(page.locator('.card')).toHaveCount(rec.DATA.length + rec.EXTRA.length);
});

test('expansion: CCDC deadline does not claim a specific city and Guoyuan keeps four roles in one pool', async ({
  page,
}) => {
  await page.goto('soe.html');
  await page.locator('#q').fill('中央国债');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, 'ccdc')).toContainText('2026-10-13');
  await expect(card(page, 'ccdc')).toContainText('24:00');
  await page.locator('#q').fill('国元证券');
  await expect(page.locator('.card')).toHaveCount(1);
  await card(page, 'guoyuan').locator('.position-list summary').click();
  await expect(card(page, 'guoyuan').locator('[data-position]')).toHaveCount(4);
  await expect(card(page, 'guoyuan').locator('.position-list')).toContainText('专业不限');
  await expect(card(page, 'guoyuan').locator('.position-list')).toContainText('11月底');
});

test('expansion: research assistant, hard conditions and genuine opportunities are not combined', async ({
  page,
}) => {
  await page.goto('div.html');
  await page.locator('#q').fill('地球物理智能');
  await expect(page.locator('.card')).toHaveCount(1);
  await card(page, 'cas-igg').locator('.card-details > summary').click();
  await expect(card(page, 'cas-igg')).toContainText('2026-10-30 17:00');
  await expect(card(page, 'cas-igg')).toContainText('应用统计0252');
  await page.locator('#q').fill('上海外国语');
  await expect(page.locator('.card')).toHaveCount(1);
  await card(page, 'shisu-special').locator('.card-details > summary').click();
  await expect(card(page, 'shisu-special')).toContainText('维吾尔语');
  await expect(card(page, 'shisu-special')).toContainText('优先');
});

test('expansion: expired P&G batch is disclosed while FedEx stays an overseas internship', async ({
  page,
}) => {
  await page.goto('div.html');
  await page.locator('#q').fill('联邦快递');
  await expect(page.locator('.card')).toHaveCount(1);
  await card(page, 'fedex').locator('.card-details > summary').click();
  await expect(card(page, 'fedex')).toContainText('实习');
  await expect(card(page, 'fedex')).toContainText('工作许可');
  await page.locator('#q').fill('宝洁');
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.locator('#excluded-list')).toContainText('9月28日');
});

test('expansion: new evidence links resolve and full export includes the qualification layer', async ({
  page,
}) => {
  await page.goto('div.html');
  await page.locator('#q').fill('贝莱德');
  await expect(page.locator('.card')).toHaveCount(1);
  await card(page, 'blackrock').locator('.card-details > summary').click();
  const link = card(page, 'blackrock').locator('a[href^="#src-E1010-"]').first();
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page.locator(href)).toBeVisible();
  const promise = page.waitForEvent('download');
  await page.locator('#export-btn').click();
  const data = JSON.parse(fs.readFileSync(await (await promise).path(), 'utf8'));
  expect(data.items.length).toBe(read('data/div.json').DATA.length);
  expect(
    data.screening.entries[record('blackrock').entryId].positions.some(
      (p) => p.deadline?.time === '23:55',
    ),
  ).toBe(true);
});

test('expansion final review: REC restrictions and employer identity are visible instead of stored-only fields', async ({
  page,
}) => {
  await page.goto('index.html');
  await page.locator('#q').fill('深信服');
  await expect(page.locator('.card')).toHaveCount(1);
  const entry = card(page, 'sangfor');
  await entry.locator('.card-details > summary').click();
  await expect(entry).toContainText('资格与取舍');
  await expect(entry).toContainText('志愿仅1个');
  await expect(entry).toContainText('用人主体');
  await expect(entry).toContainText('下一步');
});

test('expansion final review: E Fund has one entry with three directions sharing the same deadline and quota', async ({
  page,
}) => {
  await page.goto('div.html');
  await page.locator('#q').fill('易方达基金');
  await expect(page.locator('.card')).toHaveCount(1);
  const entry = card(page, 'efunds');
  await entry.locator('.card-details > summary').click();
  await expect(entry.locator('.div-position')).toHaveCount(3);
  for (const role of await entry.locator('.div-position').all()) {
    await expect(role).toContainText('合计最多2岗位');
    await expect(role).toContainText('2026-10-11');
  }
});
