import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { loadCatalogs, normalizeCatalogs } from '../scripts/catalog-data.mjs';

const errors = new WeakMap();
const hostname = 'npqrixancnwbmzcyqafx.supabase.co';
const cacheKey = (kind) => 'recsys:catalog:v2:' + hostname + ':' + kind;
const readCatalog = (kind) =>
  JSON.parse(fs.readFileSync(new URL('../data/' + kind + '.json', import.meta.url), 'utf8'));

// Browser tests never create users, write states or contact a production service.
test.beforeEach(async ({ context, page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ message: 'network unavailable in isolated browser test' }),
    });
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.__cspViolations.push(event.violatedDirective),
    );
  });
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.__cspViolations || [])).toEqual([]);
});

for (const [kind, file, count] of [
  ['rec', 'index.html', 57],
  ['soe', 'soe.html', 29],
]) {
  async function open(page, suffix = '') {
    await page.goto(file + suffix, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.card')).toHaveCount(count);
    await expect(page.locator('#app-loading')).toHaveCount(0);
  }

  test(
    kind + ': interactive snapshot does not wait for a stalled cloud',
    async ({ page, context }, testInfo) => {
      const pending = [];
      await context.route('https://' + hostname + '/**', (route) => {
        pending.push(route);
      });
      await open(page);
      const interactiveMs = await page.evaluate(
        () => performance.getEntriesByName('app:interactive')[0].startTime,
      );
      await testInfo.attach('interactive-timing', {
        body: JSON.stringify({
          kind,
          interactiveMs,
          condition: 'cloud requests deliberately stalled',
        }),
        contentType: 'application/json',
      });
      expect(interactiveMs).toBeLessThan(3000);
      await expect.poll(() => pending.length).toBeGreaterThan(0);
      await page.locator('#q').fill('不存在的企业级回归测试XYZ');
      await expect(page.locator('#count')).toContainText('显示 0');
      await Promise.all(pending.map((route) => route.abort().catch(() => {})));
    },
  );

  test(
    kind + ': a failed page chunk shows recovery and can be retried',
    async ({ page, context }) => {
      const pattern = new RegExp('/assets/' + kind + '-[^/]+\\.js$');
      await context.route(pattern, (route) => route.abort('failed'));
      await page.goto(file, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app-loading')).toHaveAttribute('role', 'alert');
      await expect(page.locator('#app-loading')).toContainText('页面初始化失败');
      await context.unroute(pattern);
      await page.getByRole('button', { name: '重新加载', exact: true }).click();
      await expect(page.locator('.card')).toHaveCount(count);
    },
  );

  test(kind + ': marking, reloading, restoring and undo preserve user state', async ({ page }) => {
    await open(page);
    const first = page.locator('#grid .card').first();
    const id = await first.getAttribute('data-entry-id');
    await first.locator('[data-card-state="applied"]').click();
    const card = page.locator('[data-entry-id="' + id + '"]');
    await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
    await expect(card.locator('[data-testid="card-personal-status"]')).toContainText('已投递');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.card')).toHaveCount(count);
    await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
    await card.locator('[data-card-state="active"]').click();
    await expect(page.locator('#grid [data-entry-id="' + id + '"]')).toHaveCount(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
  });

  test(
    kind + ': search and filter changes reuse nodes and retain expanded details',
    async ({ page }) => {
      await open(page);
      const first = page.locator('#grid .card').first();
      const name = await first.locator('.name').innerText();
      const handle = await first.elementHandle();
      await first
        .locator('details')
        .first()
        .evaluate((detail) => {
          detail.open = true;
        });
      await page.locator('#q').fill(name);
      await expect(first).toContainText(name);
      await page.locator('#q').fill('不存在的企业级回归测试XYZ');
      await expect(page.locator('#count')).toContainText('显示 0');
      // Exercise a cache-minute rollover while this card is filtered out.
      await page.evaluate(() => {
        const time = Date.now();
        Date.now = () => time + 60000;
      });
      await page.locator('#q').fill('');
      await expect(page.locator('.card')).toHaveCount(count);
      expect(
        await handle.evaluate((node) => node.isConnected && node.querySelector('details').open),
      ).toBe(true);
      await handle.dispose();
    },
  );

  test(kind + ': IME composition waits until confirmation before filtering', async ({ page }) => {
    await open(page);
    await page.locator('#q').evaluate((input) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = '不存在的企业级回归测试XYZ';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    await page.waitForTimeout(150);
    await expect(page.locator('.card')).toHaveCount(count);
    await page.locator('#q').dispatchEvent('compositionend');
    await expect(page.locator('#count')).toContainText('显示 0');
  });

  test(
    kind + ': malformed URL fragments and corrupt caches do not break startup',
    async ({ page }) => {
      await page.addInitScript((key) => localStorage.setItem(key, '{invalid'), cacheKey(kind));
      await open(page, '#%E0%A4%A');
      await expect(page.locator('[data-catalog-mode]')).toContainText('内置只读备份');
    },
  );

  test(
    kind + ': local storage failure is visible and in-memory marking still works',
    async ({ page }) => {
      await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('recsys:cards:'))
            throw new DOMException('quota', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      await open(page);
      await page.locator('#grid .card').first().locator('[data-card-state="applied"]').click();
      await expect(page.locator('[data-sync-status]')).toContainText('本地存储不可用');
      await expect(page.locator('#processed-grid .card')).toHaveCount(1);
    },
  );

  test(
    kind + ': account dialog supports keyboard dismissal and clears passwords',
    async ({ page }) => {
      await open(page);
      await page.locator('[data-account]').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[name="email"]')).toBeFocused();
      await dialog.locator('[name="password"]').fill('test-only-password');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await page.locator('[data-account]').click();
      await expect(dialog.locator('[name="password"]')).toHaveValue('');
    },
  );

  test(
    kind + ': responsive layout, reduced motion, theme and external link protections',
    async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page);
      const original = await page.locator('html').getAttribute('data-theme');
      await page.locator('#theme-btn').click();
      const theme = original === 'dark' ? 'light' : 'dark';
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.card')).toHaveCount(count);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(
        await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
      ).toBe('auto');
      expect(
        await page
          .locator('a[target="_blank"]')
          .evaluateAll((links) =>
            links.every((link) => link.rel.includes('noopener') && link.rel.includes('noreferrer')),
          ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            performance
              .getEntriesByType('resource')
              .filter((entry) => /fonts\.googleapis|fonts\.gstatic/.test(entry.name)).length,
        ),
      ).toBe(0);
      await page.screenshot({
        path: testInfo.outputPath(kind + '-viewport.png'),
        animations: 'disabled',
      });
    },
  );

  test(kind + ': injected cached text and executable links are inert', async ({ page }) => {
    const data = readCatalog(kind);
    data.DATA[0].name = '<img src=x onerror="window.__attack=1">';
    data.DATA[0].links = [['unsafe', 'javascript:window.__attack=1']];
    data.SOURCES[(kind === 'rec' ? 'R' : 'S') + '<img onerror="window.__attack=1">'] = {
      title: 'malicious fixture',
      url: 'javascript:window.__attack=1',
    };
    await page.addInitScript(
      ({ key, catalog }) =>
        localStorage.setItem(key, JSON.stringify({ version: 2, savedAt: Date.now(), catalog })),
      { key: cacheKey(kind), catalog: data },
    );
    await open(page);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.locator('[onerror]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__attack)).toBeUndefined();
  });

  test(
    kind + ': cloud refresh updates facts without erasing local marks or search',
    async ({ page, context }) => {
      await open(page);
      const card = page.locator('#grid .card').first(),
        id = await card.getAttribute('data-entry-id');
      await card.locator('[data-card-state="applied"]').click();
      // Public requests have an eight-second total deadline, including SDK retries.
      await expect(page.locator('[data-refresh-catalog]')).toBeEnabled({ timeout: 10000 });
      const tables = normalizeCatalogs(loadCatalogs());
      tables.job_entries.find((row) => row.id === id).jobs = '企业级回归测试专用岗位';
      await context.route('https://' + hostname + '/rest/v1/**', (route) => {
        const url = new URL(route.request().url()),
          table = url.pathname.split('/').at(-1);
        if (!tables[table]) return route.fulfill({ status: 403, body: '{}' });
        const selectedKind = url.searchParams.get('kind')?.replace('eq.', '');
        let rows = tables[table].filter((row) => !selectedKind || row.kind === selectedKind);
        if (table === 'job_entries')
          rows = rows.map((row) => ({
            ...row,
            companies: tables.companies.find((company) => company.id === row.company_id),
            entry_links: tables.entry_links.filter((child) => child.entry_id === row.id),
            entry_audits: tables.entry_audits.filter((child) => child.entry_id === row.id),
            entry_deadlines: tables.entry_deadlines.filter((child) => child.entry_id === row.id),
            job_sources: tables.job_sources.filter((child) => child.entry_id === row.id),
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
      await page.locator('#q').fill('企业级回归测试专用岗位');
      await page.locator('[data-refresh-catalog]').click();
      await expect(page.locator('[data-catalog-mode]')).toContainText('云端招聘资料');
      await expect(page.locator('#q')).toHaveValue('企业级回归测试专用岗位');
      await expect(page.locator('#processed-grid [data-entry-id="' + id + '"]')).toHaveCount(1);
      await expect(page.locator('.card')).toHaveCount(1);
    },
  );

  test(
    kind + ': automated WCAG checks cover the rendered workspace',
    async ({ page }, testInfo) => {
      await open(page);
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((html, value) => {
          html.dataset.theme = value;
        }, theme);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        await testInfo.attach('accessibility-' + theme, {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json',
        });
        expect(
          result.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.map((node) => ({
              target: node.target,
              summary: node.failureSummary,
            })),
          })),
        ).toEqual([]);
      }
    },
  );
}
