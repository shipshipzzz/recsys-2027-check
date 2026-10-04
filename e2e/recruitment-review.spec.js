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
  const biliFacts = rec.DATA.find((item) => item.id === 'rec-cfc3d445066f6e83ca1d');
  await expect(bili.locator('.badges')).toContainText(
    biliFacts.audit.checked === rec.RECHECKED
      ? '官网正文·本次'
      : '官网记录·' + biliFacts.audit.checked,
  );
  await expect(bili.locator('.due-v')).toHaveText('滚动 / 截止待核');
  await expect(bili).toContainText('不作为实时数量');
  const vivo = card(page, 'rec-69337578b2468a881543');
  await expect(vivo).toHaveClass(/st-verify/);
  await expect(vivo.locator('.badges')).toContainText('当前需复核');
  await expect(vivo).toContainText('不因空正文认定停招');
});

test('current role evidence never borrows an expired applied-statistics qualification', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-04T12:00:00+08:00'));
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(soe.DATA.length);
  const hz = card(page, 'soe-15dcc83203fa8d55b59c');
  await expect(hz).toHaveAttribute('data-major', 'statistics');
  await expect(hz).toHaveClass(/st-open/);
  await expect(hz).toContainText('9/30');
  await expect(hz.locator('.action-strip')).toContainText('2026-10-25');
  await expect(hz.locator('.action-strip')).not.toContainText('2026-09-30');
  // Keep old job evidence as history, but use current evidence for the parent.
  const dataRole = hz.locator('[data-position="soe-15dcc83203fa8d55b59c-p01"]');
  const trainee = hz.locator('[data-position="soe-15dcc83203fa8d55b59c-p02"]');
  await expect(dataRole).toContainText('明确列应用统计');
  await expect(dataRole).toContainText('2026-09-30');
  await expect(dataRole).toContainText('该窗口已过');
  await expect(trainee).toContainText('统计类 / 数理统计');
  await expect(trainee).toContainText('2026-10-25');
  for (const suffix of ['ai-27158946', 'fx-27158944']) {
    const current = hz.locator('[data-position="soe-15dcc83203fa8d55b59c-' + suffix + '"]');
    await expect(current).toContainText('2026-10-25');
    await expect(current).not.toContainText('明确列应用统计');
  }
  await expect(hz.locator('.position-list')).toContainText('仅本机保存');
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

for (const path of ['./', 'soe.html']) {
  test(
    path + ': every evidence link resolves, including dated U-prefixed sources',
    async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.source-entry').first()).toBeAttached();
      const missing = await page
        .locator('a.source-ref')
        .evaluateAll((links) =>
          links
            .map((link) => link.getAttribute('href'))
            .filter(
              (href) =>
                href?.startsWith('#src-') &&
                !document.getElementById(decodeURIComponent(href.slice(1))),
            ),
        );
      expect([...new Set(missing)]).toEqual([]);
      await expect(page.locator('.source-entry[id^="src-U0927-"]').first()).toBeAttached();
    },
  );
}
test('expired application batches are not actionable even when later interviews continue', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  const cmb = card(page, 'soe-760d8065c74679611ff9');
  await expect(cmb).toHaveClass(/st-past/);
  await expect(cmb).toContainText('9/29');
  await page.locator('.chip[data-filter="now"]').click();
  await expect(cmb).toHaveCount(0);
});
test('new institutions retain independent identities and do not mix role-specific cities', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  const cdb = card(page, 'soe-b9fb017b087135609736');
  await expect(cdb).toHaveAttribute('data-major', 'statistics');
  await expect(cdb).toContainText('对应专业学位类别');
  await expect(card(page, 'soe-84e7d908cb72d28b63a2')).toHaveAttribute('data-major', 'unknown');
  await page.locator('#location-filter').selectOption('西安');
  await expect(cdb).toHaveCount(0);
});
