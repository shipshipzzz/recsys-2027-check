import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
const rec = read('rec');
const soe = read('soe');
const card = (page, id) => page.locator('.card[data-entry-id="' + id + '"]');
const errors = new WeakMap();

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

test('deep review: fresh and previous-round REC evidence have different visible dates', async ({
  page,
}) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(rec.DATA.length + rec.EXTRA.length);
  for (const id of ['rec-99da41b4a60e34d30b0c', 'rec-57b33bc4f2a1d871291f']) {
    await expect(card(page, id).locator('.due-v')).toHaveText('滚动 / 截止待核');
  }
  const kuaishou = card(page, 'rec-b210af9eaeaa3d72cea6');
  const kuaishouFacts = rec.DATA.find((item) => item.id === 'rec-b210af9eaeaa3d72cea6');
  const kuaishouCurrent = kuaishouFacts.audit.checked === rec.RECHECKED;
  await expect(kuaishou.locator('.badges')).toContainText(
    kuaishouCurrent ? '本次官网记录' : '官网记录·' + kuaishouFacts.audit.checked,
  );
  if (!kuaishouCurrent) await expect(kuaishou.locator('.badges')).not.toContainText('本次');
  const fresh = rec.DATA.find(
    (item) => item.audit?.checked === rec.RECHECKED && item.src === 'see',
  );
  expect(fresh).toBeTruthy();
  await expect(card(page, fresh.id).locator('.badges')).toContainText('本次');
  await expect(card(page, fresh.id).locator('.s-rev')).toContainText(rec.RECHECKED);
  const bili = card(page, 'rec-cfc3d445066f6e83ca1d');
  await expect(bili.locator('.badges')).toContainText('官网记录·2026-09-27');
  await expect(bili.locator('.badges')).not.toContainText('本次');
  await page.locator('.chip[data-filter="rev"]').click();
  await expect(page.locator('.card')).toHaveCount(
    [...rec.DATA, ...rec.EXTRA].filter((item) => item.rev === rec.RECHECKED).length,
  );
  await expect(page.locator('.source-entry[id^="src-U0928-"]').first()).toBeAttached();
});

test('deep review: CIB cannot inherit preferred work cities from unrelated engineering qualifications', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card')).toHaveCount(soe.DATA.length);
  const cib = card(page, 'soe-6b718e14071e15579098');
  await expect(cib).toHaveAttribute('data-major', 'statistics');
  for (const direction of ['stats', 'research']) {
    await page.locator('#track-filter').selectOption(direction);
    await page.locator('#location-filter').selectOption('all');
    await expect(cib).toHaveCount(1);
    for (const city of ['杭州', '成都', '西安']) {
      await page.locator('#location-filter').selectOption(city);
      await expect(cib).toHaveCount(0);
    }
  }
});

test('deep review: date-only deadlines and CCB examination cities remain unambiguous', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  const sanxia = card(page, 'soe-15e8fe78032c98f915c3');
  await expect(sanxia).toContainText('未给具体时刻');
  const ccb = card(page, 'soe-9ed0ba98e2b378d91fe7');
  await expect(ccb).toContainText('24:00');
  await page.locator('#track-filter').selectOption('software');
  await page.locator('#location-filter').selectOption('成都');
  await expect(ccb).toHaveCount(1);
  for (const city of ['杭州', '重庆', '西安']) {
    await page.locator('#location-filter').selectOption(city);
    await expect(ccb).toHaveCount(0);
  }
});

test('deep review: updated role evidence retains source dates without implying personal qualification', async ({
  page,
}) => {
  // The assertion is about the live Oct 7 window, not the machine's present day.
  await page.clock.install({ time: new Date('2026-10-07T12:00:00+08:00') });
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  const cdb = card(page, 'soe-b9fb017b087135609736');
  await expect(cdb).toContainText(
    soe.DATA.find((item) => item.id === 'soe-b9fb017b087135609736').audit.checked,
  );
  await expect(cdb.locator('.position-list')).toContainText('专业依据不等于个人全部资格通过');
  await expect(cdb.locator('.action-strip')).toContainText('2026-10-07');
  await expect(cdb.locator('.action-strip')).toContainText('24:00');
  await expect(page.locator('#src-U0927-S27')).toContainText('2026-09-27');
  await expect(cdb.locator('.action-strip')).not.toContainText('临期待核');
  const teleai = card(page, 'soe-4ffa72152f7258fb78a2');
  await expect(teleai).toHaveAttribute('data-major', 'unknown');
  await expect(teleai).toHaveClass(/st-verify/);
  await page.locator('.chip[data-filter="now"]').click();
  await expect(teleai).toHaveCount(0);
});

test('deep review: official Zhejiang evidence supports research and software without treating province-wide rotation as a fixed city', async ({
  page,
}) => {
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  const zhejiang = card(page, 'soe-74afd94593431265ce3a');
  await expect(zhejiang).toHaveAttribute('data-major', 'explicit');
  await expect(zhejiang).toContainText('服从调配');
  for (const direction of ['research', 'software']) {
    await page.locator('#track-filter').selectOption(direction);
    await page.locator('#location-filter').selectOption('杭州');
    await expect(zhejiang).toHaveCount(1);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

// Complement the pre-deadline case; never change recruitment facts to satisfy the clock.
test('deep review: expired scoped deadlines leave the action banner while evidence stays visible', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-10T12:00:00+08:00') });
  await page.goto('soe.html', { waitUntil: 'domcontentloaded' });
  const cdb = card(page, 'soe-b9fb017b087135609736');
  await expect(cdb.locator('.action-strip')).toContainText('其他岗位 / 新批次另核');
  await expect(cdb.locator('.action-strip')).not.toContainText('2026-10-07');
  await expect(cdb.locator('.position-list')).toContainText('2026-10-07');
  await expect(cdb.locator('.position-list')).toContainText('专业依据不等于个人全部资格通过');
  await expect(page.locator('#src-U0927-S27')).toContainText('2026-09-27');
});
