import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  loadCatalogs,
  normalizeCatalogs,
  hydratedFromTables,
  validatePrevious,
  ROOT,
} from '../scripts/catalog-data.mjs';
import { loadDiverse, validateDiverse } from '../scripts/validate-diverse.mjs';
import { createDiverseLookup, matchingPositions } from '../src/diverse-policy.js';
import { BUILD_BUDGETS } from '../scripts/build-policy.mjs';
const json = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const report = json('docs/recruitment-expansion-2026-10-10.json');
const catalogs = loadCatalogs(),
  policy = loadDiverse(ROOT);
const original = (p) =>
  JSON.parse(
    execFileSync('git', ['show', report.baseline + ':' + p], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20_000_000,
    }),
  );
const old = Object.fromEntries(
  ['rec', 'soe', 'div'].map((k) => [k, original('data/' + k + '.json')]),
);
const all = (d) => [...d.DATA, ...(d.EXTRA || [])];
const now = new Date('2026-10-10T12:00:00+08:00');

test('expansion: all 77 previously named employers have a real disposition and no pending placeholder', () => {
  assert.equal(report.priorDispositions.length, 77);
  assert.equal(new Set(report.priorDispositions.map((x) => x.name)).size, 77);
  const ids = new Set(
    Object.values(catalogs)
      .flatMap(all)
      .map((x) => x.id),
  );
  for (const row of report.priorDispositions) {
    assert.ok(['new', 'existing', 'excluded'].includes(row.decision));
    assert.ok(row.reason.length > 10);
    if (row.decision === 'excluded') assert.equal(row.entryId, null);
    else assert.ok(ids.has(row.entryId), row.name);
  }
  assert.equal(report.counts.priorPending, 0);
});

test('expansion: every new card and role is counted once with directions separate from specific positions', () => {
  const records = report.records.filter((x) => x.decision === 'new');
  const added = [];
  for (const kind of ['rec', 'soe', 'div']) {
    const prior = new Set(all(old[kind]).map((x) => x.id));
    const fresh = all(catalogs[kind]).filter((x) => !prior.has(x.id));
    assert.ok(fresh.length > 0);
    assert.equal(fresh.length, report.counts.byKind[kind]);
    added.push(...fresh.map((x) => x.id));
  }
  assert.deepEqual(added.sort(), records.map((x) => x.entryId).sort());
  assert.equal(new Set(added).size, report.counts.newCards);
  const positions = records.flatMap((x) => x.normalizedPositions);
  assert.equal(new Set(positions.map((x) => x.id)).size, positions.length);
  assert.equal(
    positions.filter((x) => x.recordType === 'position').length,
    report.counts.newSpecificPositions,
  );
  assert.equal(
    positions.filter((x) => x.recordType === 'direction').length,
    report.counts.newDirectionRecords,
  );
  assert.equal(Object.values(catalogs).flatMap(all).length, report.counts.totalCards);
});

test('expansion: every legacy card, source, historical snapshot and assessment survives unchanged', () => {
  for (const kind of ['rec', 'soe', 'div']) {
    const current = new Map(all(catalogs[kind]).map((x) => [x.id, x]));
    for (const item of all(old[kind]))
      assert.deepEqual(current.get(item.id), item, kind + '/' + item.name);
    for (const [id, s] of Object.entries(old[kind].SOURCES))
      assert.deepEqual(catalogs[kind].SOURCES[id], s);
    for (const field of ['ORIGINAL_ITEMS', 'LOG', 'TIMELINE', 'TIMELINE_EVENTS', 'DUE'])
      assert.deepEqual(catalogs[kind][field], old[kind][field]);
  }
  for (const name of ['div-screening', 'soe-screening', 'soe-opportunities', 'soe-locations']) {
    const previous = original('data/' + name + '.json').entries,
      current = json('data/' + name + '.json').entries;
    for (const [id, row] of Object.entries(previous))
      assert.deepEqual(current[id], row, name + '/' + id);
  }
  validatePrevious(old, catalogs);
});

test('expansion: unsupported deadlines, hard student leadership and stale annual jobs cannot pretend to be current', () => {
  for (const e of report.records.filter((e) => e.decision === 'new'))
    for (const p of e.normalizedPositions) {
      assert.notEqual(p.leadership, 'required');
      if (p.deadline) assert.ok(p.deadline.date >= report.reviewedOn, e.name);
      if (p.cycle !== 'current') assert.notEqual(p.status, 'open');
      if (p.recordType === 'direction') assert.ok(p.requirements.length > 15);
    }
  const p = report.records.find((x) => x.key === 'pg-expired');
  assert.equal(p.decision, 'excluded');
  assert.match(p.exclusionReason, /2026-09-28/);
  const ict = report.records.find((x) => x.key === 'cas-ict');
  assert.equal(ict.cycle, 'unverified');
});

test('expansion: school administrative opportunities are distinct from mandatory student-cadre roles', () => {
  const ordinary = report.records.find((x) => x.key === 'shisu-regular-excluded');
  assert.equal(ordinary.decision, 'excluded');
  const special = report.records.find((x) => x.key === 'shisu-special').normalizedPositions[0];
  assert.equal(special.leadership, 'preferred');
  assert.match(special.requirements, /维吾尔语/);
  const physics = report.records.find((x) => x.key === 'cas-iop');
  assert.equal(physics.normalizedPositions.length, 5);
  assert.ok(physics.normalizedPositions.every((p) => p.leadership === 'not_stated'));
  assert.ok(policy.excluded.some((x) => x.name.includes('上海外国语大学普通')));
});

test('expansion: new geophysics and financial data evidence remains valid after database roundtrip', () => {
  const restored = hydratedFromTables('div', normalizeCatalogs(catalogs));
  const lookup = createDiverseLookup(policy, catalogs.div);
  validateDiverse(catalogs, policy);
  for (const item of restored.ALL_ITEMS)
    assert.equal(lookup(item, restored.SOURCES).matched, true, item.name);
  const record = report.records.find((x) => x.key === 'cas-igg');
  const item = restored.ALL_ITEMS.find((x) => x.id === record.entryId),
    a = lookup(item, restored.SOURCES);
  assert.equal(matchingPositions(a, { direction: 'ai' }, now, item).length, 2);
  assert.ok(a.positions.every((x) => x.major === 'related'));
});

test('expansion: overseas internship remains an internship and worldwide job directions are not domestic vacancies', () => {
  const fedex = report.records.find((x) => x.key === 'fedex').normalizedPositions[0];
  assert.equal(fedex.employment, 'internship');
  assert.equal(fedex.status, 'intern');
  assert.match(fedex.restrictions, /工作许可|签证/);
  const br = report.records.find((x) => x.key === 'blackrock').normalizedPositions[0];
  assert.equal(br.deadline.date, '2026-10-25');
  assert.equal(br.deadline.time, '23:55');
  assert.deepEqual(br.cities, ['香港', '新加坡']);
});

test('expansion: only aggregate JSON capacity changes; per-page and code safety budgets remain bounded', () => {
  assert.equal(BUILD_BUDGETS.totalJsonGzip, 256 * 1024);
  assert.equal(BUILD_BUDGETS.pageJsonGzip, 200 * 1024);
  assert.equal(BUILD_BUDGETS.totalJsonBytes, 2 * 1024 * 1024);
  assert.equal(BUILD_BUDGETS.totalJavaScriptGzip, 210 * 1024);
  assert.equal(BUILD_BUDGETS.pageJavaScriptGzip, 155 * 1024);
  assert.equal(BUILD_BUDGETS.pageCssGzip, 16 * 1024);
  assert.equal(BUILD_BUDGETS.pageHtmlGzip, 14 * 1024);
});

test('expansion final review: E Fund quota is shared and two newly found securities notices have separate employer entries', () => {
  const fund = report.records.find((e) => e.key === 'efunds');
  assert.equal(fund.normalizedPositions.length, 3);
  assert.ok(fund.normalizedPositions.every((p) => p.deadline.date === '2026-10-11'));
  assert.ok(fund.normalizedPositions.every((p) => p.restrictions.includes('合计最多2岗位')));
  assert.ok((fund.additionalSources || []).some((s) => s.url.endsWith('/118048.html')));
  const securities = ['guosen', 'wanlian'].map((key) => report.records.find((e) => e.key === key));
  assert.ok(
    securities.every((e) => e.kind === 'soe' && e.decision === 'new' && e.cycle === 'current'),
  );
  assert.notEqual(securities[0].entryId, securities[1].entryId);
  assert.ok(
    securities.every((e) => e.normalizedPositions.every((p) => p.recordType === 'direction')),
  );
});
