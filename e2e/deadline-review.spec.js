import fs from 'node:fs';
const catalogCount = (kind) => {
  const data = JSON.parse(
    fs.readFileSync(new URL('../data/' + kind + '.json', import.meta.url), 'utf8'),
  );
  return data.DATA.length + (data.EXTRA?.length || 0);
};
import { test, expect } from '@playwright/test';

const card = (page, id) => page.locator(`.card[data-entry-id="${id}"]`);
const errors = new WeakMap();
test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await page.clock.install({ time: new Date('2026-10-07T12:00:00+08:00') });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('regular recruitment dates appear without invented midnight times or lost early-batch history', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  await expect(page.locator('.card')).toHaveCount(catalogCount('rec'));
  const mihoyo = card(page, 'rec-7b0537129aa42ab55ff5');
  const shopee = card(page, 'rec-2faa8bd0603d45617e25');
  await expect(mihoyo.locator('.due-v')).toHaveText('2026-10-31');
  await expect(shopee.locator('.due-v')).toHaveText('2026-11-30');
  await mihoyo.locator('.card-details > summary').click();
  await expect(mihoyo.locator('.node-scope')).toContainText('正式批');
  await expect(mihoyo.locator('.node-scope')).toContainText('不包括');
  await expect(mihoyo.locator('a[href="#src-D1007-R01"]')).not.toHaveCount(0);
  await mihoyo.screenshot({
    path: testInfo.outputPath('mihoyo-deadline.png'),
    animations: 'disabled',
  });
});

test('new deadline evidence never upgrades unknown professional eligibility', async ({ page }) => {
  await page.goto('soe.html');
  await expect(page.locator('.card')).toHaveCount(catalogCount('soe'));
  const cmb = card(page, 'soe-53b939996659dfde59e5');
  await expect(cmb).toHaveAttribute('data-major', 'unknown');
  await expect(cmb.locator('.action-strip')).toContainText('2026-10-10');
  const shared = card(page, 'soe-87ef8e3ebe4b4b4bb9fc');
  await expect(shared.locator('.action-strip')).toContainText('2026-10-15');
  await shared.locator('.position-list summary').click();
  for (const suffix of ['p01', 'p02']) {
    await expect(
      shared.locator(`[data-position="soe-87ef8e3ebe4b4b4bb9fc-${suffix}"]`),
    ).toContainText('2026-10-15');
  }
  const sinopec = card(page, 'soe-863efd948d7f8d33bfdb');
  await expect(sinopec).toHaveAttribute('data-major', 'unknown');
  await expect(sinopec).toHaveClass(/st-verify/);
  await expect(sinopec.locator('.action-strip')).toContainText('2026-10-28 17:00');
  await expect(sinopec).toContainText('转载');
});

test('one Guangfa card shows two shared-quota windows and advances only local child progress', async ({
  page,
}, testInfo) => {
  await page.goto('soe.html');
  const id = 'soe-e43cb34e4c801cf57150';
  const bank = card(page, id);
  await expect(bank).toHaveCount(1);
  await expect(bank.locator('.action-strip')).toContainText('2026-10-15');
  await bank.locator('.position-list summary').click();
  await expect(bank.locator('[data-position]')).toHaveCount(2);
  await expect(bank.locator('.position-list')).toContainText('2026-11-15');
  await expect(bank.locator('.position-list')).toContainText('3个平行志愿');
  await expect(bank).toHaveAttribute('data-major', 'related');
  await bank.screenshot({
    path: testInfo.outputPath('guangfa-shared-windows.png'),
    animations: 'disabled',
  });
  await bank.locator(`[data-position-id="${id}-window-head-office"]`).selectOption('applied');
  await expect(bank.locator('.action-strip')).toContainText('2026-11-15');
  await expect(bank.locator(`[data-position-id="${id}-window-branches"]`)).toHaveValue('pending');
  await page.reload();
  await expect(card(page, id).locator('.action-strip')).toContainText('2026-11-15');
  await expect(page.locator('.card')).toHaveCount(catalogCount('soe'));
});
