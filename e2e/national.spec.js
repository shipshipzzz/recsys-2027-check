import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { nationalFixture } from '../tests/fixtures/national.mjs';
import { screeningDigest } from '../scripts/validate-screening.mjs';
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

test('review regression: handled positions never resurrect a pending deadline', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  const bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  await bank.locator('[data-position-id="' + f.positions[1].id + '"]').selectOption('ignored');
  await expect(bank.locator('.action-strip')).toContainText('已核岗位均已处理');
  await expect(bank.locator('.action-strip')).not.toContainText('2026-09-30');
  await expect(page.locator('#action-grid')).not.toContainText(f.bank.name);
});

test('review regression: failed writes retain every unsaved position edit', async ({ page }) => {
  const f = fixtures.get(page);
  await page.addInitScript(
    (ids) => {
      const key = 'recsys:soe-position-progress:v1';
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          entries: Object.fromEntries(ids.map((id) => [id, 'pending'])),
        }),
      );
      const original = Storage.prototype.setItem;
      window.__restorePositionWrites = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Full', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    },
    f.positions.map((p) => p.id),
  );
  await open(page);
  const bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  await bank.locator('[data-position-id="' + f.positions[1].id + '"]').selectOption('ignored');
  await expect(bank.locator('[data-position-id="' + f.positions[0].id + '"]')).toHaveValue(
    'applied',
  );
  await expect(page.locator('#position-save-status')).toContainText('内存');
  const downloaded = page.waitForEvent('download');
  await page.locator('#position-export').click();
  const backup = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  expect(backup.entries[f.positions[0].id]).toBe('applied');
  expect(backup.entries[f.positions[1].id]).toBe('ignored');
  await page.evaluate(() => window.__restorePositionWrites());
  await page.locator('#position-retry').click();
  await expect(page.locator('#position-save-status')).toContainText('已保存');
  await expect(page.locator('#position-retry')).toBeHidden();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('recsys:soe-position-progress:v1')).entries,
  );
  expect(saved).toEqual(backup.entries);
});

test('review regression: local storage clear in another tab resets saved position UI', async ({
  page,
  context,
}) => {
  const f = fixtures.get(page);
  await open(page);
  const bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  const other = await context.newPage();
  await other.goto('soe.html');
  await other.evaluate(() => localStorage.clear());
  await expect(bank.locator('[data-position-id="' + f.positions[0].id + '"]')).toHaveValue(
    'pending',
  );
  await other.close();
});

test('review regression: deadline ordering respects earlier clock times on the same day', async ({
  page,
}) => {
  const f = fixtures.get(page);
  f.oil.dueTime = '24:00';
  f.boc.dueTime = '18:00';
  for (const item of [f.oil, f.boc])
    f.screening.entries[item.id].basisHash = screeningDigest(item, f.catalog.SOURCES);
  await open(page);
  await page.locator('#sort').selectOption('due');
  const ids = await page
    .locator('#grid .card')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.entryId));
  expect(ids.indexOf(f.boc.id)).toBeLessThan(ids.indexOf(f.oil.id));
});

test('review regression: an expired supported parent window no longer carries an open badge', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await page.clock.setSystemTime(new Date('2026-10-01T12:00:00+08:00'));
  await open(page);
  await expect(card(page, f.oil.id).locator('.b-past')).toContainText('本窗口已过');
  await page.locator('[data-filter="watch"]').click();
  await expect(card(page, f.oil.id)).toHaveCount(1);
});

test('position backup: confirmed merge restores progress without deleting sibling or unknown IDs', async ({
  page,
}) => {
  const f = fixtures.get(page),
    unknown = f.bank.id + '-future';
  await open(page);
  const bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  await bank.locator('[data-position-id="' + f.positions[1].id + '"]').selectOption('ignored');
  const backup = {
    version: 1,
    storage: '仅本机保存，不与账号同步',
    entries: { [f.positions[0].id]: 'pending', [unknown]: 'applied' },
  };
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('覆盖不同状态 1 条');
    expect(dialog.message()).toContain('1 条不在当前岗位附表');
    await dialog.accept();
  });
  await page.locator('#position-import-file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator('#position-save-status')).toContainText('已合并 2 条');
  await expect(bank.locator('[data-position-id="' + f.positions[0].id + '"]')).toHaveValue(
    'pending',
  );
  await expect(bank.locator('[data-position-id="' + f.positions[1].id + '"]')).toHaveValue(
    'ignored',
  );
  await page.reload();
  await bank.locator('.position-list summary').click();
  await expect(bank.locator('[data-position-id="' + f.positions[1].id + '"]')).toHaveValue(
    'ignored',
  );
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('recsys:soe-position-progress:v1')).entries,
  );
  expect(saved[unknown]).toBe('applied');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('position backup: cancellation, corrupt JSON and oversize files do not mutate progress', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  const before = await page.evaluate(() => localStorage.getItem('recsys:soe-position-progress:v1'));
  page.once('dialog', (dialog) => dialog.dismiss());
  const file = page.locator('#position-import-file');
  await file.setInputFiles({
    name: 'cancel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ version: 1, entries: { [f.positions[0].id]: 'applied' } }),
    ),
  });
  await expect(page.locator('#position-save-status')).toContainText('已取消');
  for (const text of [
    '{broken',
    JSON.stringify({ version: 1, entries: { [f.positions[0].id]: ['applied'] } }),
  ]) {
    await file.setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(page.locator('#position-save-status')).toContainText('未导入');
  }
  await file.setInputFiles({
    name: 'too-large.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(1024 * 1024 + 1, 32),
  });
  await expect(page.locator('#position-save-status')).toContainText('不能超过1 MiB');
  expect(await page.evaluate(() => localStorage.getItem('recsys:soe-position-progress:v1'))).toBe(
    before,
  );
  await expect(page.locator('#position-import')).toBeEnabled();
});

test('clock review: parent deadline badges advance without reloading the page', async ({
  page,
}) => {
  const f = fixtures.get(page);
  f.oil.due = '2026-09-28';
  f.oil.dueTime = '12:01';
  f.screening.entries[f.oil.id].basisHash = screeningDigest(f.oil, f.catalog.SOURCES);
  await open(page);
  await expect(card(page, f.oil.id).locator('.b-past')).toHaveCount(0);
  await page.clock.fastForward(61000);
  await expect(card(page, f.oil.id).locator('.b-past')).toContainText('本窗口已过');
});

test('clock review: handled child deadlines advance while the pending sibling remains unchanged', async ({
  page,
}) => {
  const f = fixtures.get(page);
  f.positions[0].due = '2026-09-28';
  f.positions[0].dueTime = '12:03';
  await open(page);
  const bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  // Consume the first tick caused by changing the pending primary deadline.
  await page.clock.fastForward(61000);
  await expect(bank.locator('.position-list')).not.toContainText('该窗口已过');
  await page.clock.fastForward(121000);
  await expect(bank.locator('.position-list')).toContainText('该窗口已过');
  await expect(bank.locator('.action-strip')).toContainText('2026-10-25');
  await expect(bank.locator('[data-position-id="' + f.positions[1].id + '"]')).toHaveValue(
    'pending',
  );
});

test('position progress: already-processed cards refresh child controls within the same minute', async ({
  page,
}) => {
  const f = fixtures.get(page);
  await open(page);
  const bank = card(page, f.bank.id);
  await bank.locator('.position-list summary').click();
  await bank.locator('[data-position-id="' + f.positions[0].id + '"]').selectOption('applied');
  await bank.locator('[data-position-id="' + f.positions[1].id + '"]').selectOption('ignored');
  await bank.locator('[data-card-state="applied"]').click();
  await expect(page.locator('#processed-grid .card')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#position-import-file').setInputFiles({
    name: 'processed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ version: 1, entries: { [f.positions[0].id]: 'ignored' } }),
    ),
  });
  await expect(page.locator('#position-save-status')).toContainText('已合并');
  const download = page.waitForEvent('download');
  await page.locator('#position-export').click();
  const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(backup.entries[f.positions[0].id]).toBe('ignored');
  await expect(bank.locator('[data-position-id="' + f.positions[0].id + '"]')).toHaveValue(
    'ignored',
  );
});
