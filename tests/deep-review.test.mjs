import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCatalogs, normalizeCatalogs, counts } from '../scripts/catalog-data.mjs';
import { createAssessmentLookup, canActOnNotice } from '../src/soe-policy.js';
import { createLocationLookup, locationBonus, matchesLocation } from '../src/location-policy.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const catalogs = loadCatalogs();
const screening = read('data/soe-screening.json');
const geography = read('data/soe-locations.json');
const coverage = read('docs/recruitment-coverage-2026-09-28.json');
const snapshots = read('docs/recruitment-snapshots-2026-09-28.json');
const items = [...catalogs.rec.DATA, ...catalogs.rec.EXTRA, ...catalogs.soe.DATA];
const byId = new Map(items.map((item) => [item.id, item]));
const assessment = createAssessmentLookup(screening, catalogs.soe);
const location = createLocationLookup(geography, catalogs.soe);
const cib = 'soe-6b718e14071e15579098';
const isLatestRound = Object.values(catalogs).every(
  (catalog) => catalog.RECHECKED === coverage.reviewedOn,
);

// Data-specific evidence assertions deliberately fail when these facts change: review the
// replacement evidence before updating an assertion, rather than changing only a digest.
test('deep review: the coverage manifest accounts for every card without inflating successful checks', () => {
  assert.equal(new Set(coverage.entries.map((row) => row.id)).size, coverage.entries.length);
  assert.equal(
    coverage.entries.length,
    Object.values(coverage.totals).reduce((a, b) => a + b, 0),
  );
  for (const row of coverage.entries) assert.ok(byId.has(row.id), row.id);
  if (isLatestRound)
    assert.deepEqual(new Set(coverage.entries.map((row) => row.id)), new Set(byId.keys()));
  for (const [outcome, total] of Object.entries(coverage.totals)) {
    assert.equal(coverage.entries.filter((row) => row.outcome === outcome).length, total);
  }
  assert.deepEqual(coverage.totals, {
    reviewed: 15,
    new: 1,
    attempted_unresolved: 4,
    not_reviewed: 95,
  });
  if (isLatestRound) assert.deepEqual(coverage.metrics, counts(normalizeCatalogs(catalogs)));
  assert.equal(coverage.newSourceCount, coverage.sources.length);
});

test('deep review: unsuccessful or unattempted checks never refresh individual audit dates', () => {
  for (const row of coverage.entries.filter((entry) =>
    ['attempted_unresolved', 'not_reviewed'].includes(entry.outcome),
  )) {
    assert.equal(row.checked, row.previousChecked, row.id);
    if (isLatestRound)
      assert.equal(byId.get(row.id).audit?.checked ?? null, row.previousChecked, row.id);
  }
});

test('deep review: full before-images survive for every revised existing card', () => {
  const changed = coverage.entries.filter((row) => row.outcome === 'reviewed');
  assert.deepEqual(
    new Set(snapshots.entries.map((row) => row.id)),
    new Set(changed.map((row) => row.id)),
  );
  for (const snapshot of snapshots.entries) {
    assert.equal(snapshot.before.id, snapshot.id);
    assert.equal(typeof snapshot.before.name, 'string');
    if (snapshot.kind === 'soe') assert.ok(snapshot.screeningBefore.basisHash);
  }
});

test('deep review: CIB statistical roles cannot borrow preferred cities from a different engineering role', () => {
  const item = byId.get(cib);
  assert.equal(assessment(item, catalogs.soe.SOURCES).major, 'statistics');
  const geo = location(item, catalogs.soe.SOURCES);
  assert.equal(geo.matched, true);
  assert.equal(locationBonus(geo), 0);
  for (const city of ['杭州', '成都', '西安']) {
    assert.equal(matchesLocation(geo, city, 'stats'), false);
    assert.equal(matchesLocation(geo, city, 'research'), false);
  }
  assert.equal(matchesLocation(geo, '上海', 'research'), true);
  assert.equal(matchesLocation(geo, '福州', 'finance'), true);
  assert.equal(matchesLocation(geo, '福州', 'research'), false);
});

test('deep review: date-only deadlines remain distinct from an explicit Beijing midnight cutoff', () => {
  assert.equal(byId.get('soe-15e8fe78032c98f915c3').due, '2026-09-30');
  assert.equal(byId.get('soe-15e8fe78032c98f915c3').dueTime, null);
  assert.equal(byId.get(cib).dueTime, null);
  assert.equal(byId.get('soe-140f2087c58956d157f6').dueTime, null);
  assert.equal(byId.get('soe-9ed0ba98e2b378d91fe7').dueTime, '24:00');
});

test('deep review: Zhejiang specific jobs and province-wide service-area assignment remain separate', () => {
  const item = byId.get('soe-74afd94593431265ce3a');
  const geo = location(item, catalogs.soe.SOURCES);
  assert.equal(matchesLocation(geo, '杭州', 'research'), true);
  assert.equal(matchesLocation(geo, '杭州', 'software'), true);
  const reserve = geo.locations.find((row) => row.refs.includes('U0928-S08'));
  assert.equal(reserve.city, '');
  assert.equal(reserve.province, '浙江');
  assert.equal(reserve.level, 'campaign');
  assert.deepEqual(reserve.directions, ['operations']);
});

test('deep review: a current program label is insufficient for unknown professional eligibility', () => {
  for (const id of ['soe-933afa76439b71816ede', 'soe-4ffa72152f7258fb78a2']) {
    const item = byId.get(id);
    const result = assessment(item, catalogs.soe.SOURCES);
    assert.equal(result.cycle, 'current');
    assert.equal(result.major, 'unknown');
    assert.equal(canActOnNotice(item, result, new Date('2026-09-28T02:00:00+08:00')), false);
  }
  assert.equal(byId.get('soe-4ffa72152f7258fb78a2').status, 'verify');
});

test('deep review: list counts and incomplete degree evidence are not upgraded into blanket eligibility', () => {
  assert.match(byId.get('rec-b210af9eaeaa3d72cea6').opened, /19.*常规.*快Star/);
  assert.match(byId.get('rec-cd6362472aea60ef45d5').opened, /41.*应届.*实习/);
  assert.equal(catalogs.rec.REC_DEADLINES['同花顺'], null);
  assert.equal(catalogs.rec.REC_DEADLINES['滴滴'], null);
  assert.equal(catalogs.rec.DUE['同花顺'], '2026-09-19');
  assert.equal(catalogs.rec.DUE['滴滴'], '2026-10-13');
  const didi = byId.get('rec-57b33bc4f2a1d871291f');
  assert.match(didi.window, /硕士/);
  assert.match(didi.req, /SQL\/Spark/);
  assert.match(didi.req, /3次/);
  assert.match(byId.get('rec-99da41b4a60e34d30b0c').req, /不等于硕士可投/);
});
