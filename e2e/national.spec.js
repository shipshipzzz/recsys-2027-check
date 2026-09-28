import { test, expect } from '@playwright/test';
import { nationalFixture } from '../tests/fixtures/national.mjs';
const fixtures = new WeakMap();
test.beforeEach(async ({ context, page }) => {
  const f = nationalFixture();
  fixtures.set(page, f);
  await page.clock.install({ time: new Date('2026-09-28T12:00:00+08:00') });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1')
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    const name = url.pathname.split('/').pop();
    const key = [
      ['soe-screening', 'screening'],
      ['soe-locations', 'locations'],
      ['soe-directory', 'directory'],
      ['soe-opportunities', 'opportunities'],
      ['soe', 'catalog'],
    ].find(([prefix]) => new RegExp('^' + prefix + '(?:-[A-Za-z0-9_-]+)?\\.json$').test(name))?.[1];
    if (key)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(f[key]) });
    return route.continue();
  });
});
async function open(page) {
  await page.goto('soe.html');
  await expect(page.locator('.card')).toHaveCount(fixtures.get(page).catalog.DATA.length);
}
const card = (page, id) => page.locator('[data-entry-id="' + id + '"]');
test('national aliases, headquarters filter and unchecked coverage remain distinct from qualification', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  for (const [query, id] of [
    ['中石油', f.oil.id],
    ['CNPC', f.oil.id],
    ['三桶油', f.oil.id],
    ['中行', f.boc.id],
    ['工行', f.icbc.id],
    ['农行', f.abc.id],
  ]) {
    await page.locator('#q').fill(query);
    await expect(card(page, id)).toHaveCount(1);
    await expect(page.locator('.card')).toHaveCount(1);
  }
  await page.locator('#q').fill('中行 ' + f.boc.city);
  await expect(card(page, f.boc.id)).toHaveCount(1);
  await page.locator('#q').fill('四大行');
  await expect(page.locator('.card')).toHaveCount(3);
  await page.locator('#q').fill('');
  await page.locator('#hq-filter').check();
  await expect(page.locator('.card')).toHaveCount(3);
  await page.locator('.national-directory summary').click();
  await expect(page.locator('.national-directory')).toContainText('未检查测试集团');
  await expect(page.locator('.national-directory')).toContainText('不代表当前在招');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('separate dates and local position progress survive reload without marking sibling applied', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  let bank = card(page, f.bank.id);
  await expect(bank.locator('.action-strip')).toContainText('2026-09-30');
  await bank.locator('.position-list summary').click();
  await expect(bank.locator('.position-list')).toContainText('2026-10-25');
  await bank.locator('[data-card-state="applied"]').click();
  await expect(page.locator('#grid [data-entry-id="' + f.bank.id + '"]')).toHaveCount(1);
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  await expect(bank.locator('.action-strip')).toContainText('2026-10-25');
  await expect(bank.locator('[data-position-id="' + f.positions[1].id + '"]')).toHaveValue(
    'pending',
  );
  await page.reload();
  bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await expect(bank.locator('[data-position-id="' + f.positions[0].id + '"]')).toHaveValue(
    'applied',
  );
  await expect(bank.locator('[data-position-id="' + f.positions[1].id + '"]')).toHaveValue(
    'pending',
  );
  const download = page.waitForEvent('download');
  await page.locator('#position-export').click();
  expect((await download).suggestedFilename()).toBe('soe-position-progress.json');
  await page.clock.setSystemTime(new Date('2026-10-01T00:01:00+08:00'));
  await page.reload();
  await expect(card(page, f.bank.id).locator('.action-strip')).toContainText('2026-10-25');
  await expect(card(page, f.bank.id).locator('.action-strip')).not.toContainText('已过');
});
test('yesterday deadlines and pending deadlines are visible while eligibility stays independent', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  await page.locator('[data-filter="urgent"]').click();
  await expect(card(page, f.oil.id)).toHaveCount(1);
  await expect(card(page, f.pending.id)).toHaveCount(1);
  await page.locator('[data-filter="pending-date"]').click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, f.pending.id).locator('.action-strip')).toContainText('临期待核');
  await page.locator('[data-filter="now"]').click();
  await expect(card(page, f.pending.id)).toHaveCount(0);
});
test('national default, dynamic city and opt-in pending locations never widen a known different city', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  await expect(page.locator('#location-filter')).toHaveValue('all');
  await page.locator('#location-filter').selectOption('上海');
  await expect(card(page, f.shanghai.id)).toHaveCount(1);
  await page.locator('#location-filter').selectOption('杭州');
  await expect(card(page, f.unknown.id)).toHaveCount(0);
  await page.locator('#location-pending').check();
  await expect(card(page, f.unknown.id)).toContainText('地点待核线索');
  await expect(card(page, f.shanghai.id)).toHaveCount(0);
  await expect(card(page, f.unknown.id).locator('[data-location-bonus]')).toHaveAttribute(
    'data-location-bonus',
    '0',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('failed static data load offers a recoverable reload', async ({ context, page }) => {
  const pattern = /\/assets\/soe-[A-Za-z0-9_-]+\.json$/;
  await context.route(pattern, (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('soe.html');
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
  await context.unroute(pattern);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(fixtures.get(page).catalog.DATA.length);
});

test('changed cached facts withdraw old positions while preserving the independent local progress', async ({
  page,
}) => {
  const f = fixtures.get(page),
    changed = structuredClone(f.catalog);
  changed.DATA[0].jobs = 'Changed remote facts';
  await page.addInitScript(
    ({ catalog, positionId }) => {
      localStorage.setItem(
        'recsys:catalog:v2:npqrixancnwbmzcyqafx.supabase.co:soe',
        JSON.stringify({ version: 2, savedAt: Date.now(), catalog }),
      );
      localStorage.setItem(
        'recsys:soe-position-progress:v1',
        JSON.stringify({ version: 1, entries: { [positionId]: 'applied' } }),
      );
    },
    { catalog: changed, positionId: f.positions[0].id },
  );
  await open(page);
  const bank = card(page, f.bank.id);
  await expect(bank).toContainText('岗位附表与当前事实不一致');
  await expect(bank.locator('.position-list')).toHaveCount(0);
  await expect(bank).toHaveAttribute('data-major', 'unknown');
  await expect(bank.locator('.action-strip')).toContainText('临期待核');
  const entries = await page.evaluate(
    () => JSON.parse(localStorage.getItem('recsys:soe-position-progress:v1')).entries,
  );
  expect(entries[f.positions[0].id]).toBe('applied');
});
