import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogs, ROOT } from '../scripts/catalog-data.mjs';
import { loadDiverse, validateDiverse } from '../scripts/validate-diverse.mjs';
import {
  createDiverseLookup,
  matchingPositions,
  positionMatches,
  diverseOrder,
} from '../src/diverse-policy.js';

const catalogs = loadCatalogs();
const policy = loadDiverse(ROOT);
const first = catalogs.div.DATA[0];
const base = policy.entries[first.id].positions[0];
const now = new Date('2026-10-10T12:00:00+08:00');

test('review: keyword search and city/major filters intersect within one role', () => {
  const a = {
    matched: true,
    category: 'foreign',
    positions: [
      {
        ...base,
        cities: ['上海'],
        major: 'statistics',
        title: '数据分析',
        directions: ['data'],
        requirements: 'SQL',
        restrictions: '测试',
      },
      {
        ...base,
        cities: ['无锡'],
        major: 'unknown',
        title: '机器学习',
        directions: ['ai'],
        requirements: 'PyTorch',
        restrictions: '测试',
      },
    ],
  };
  const employer = { name: '测试企业', en: 'Example Corp', jobs: 'SQL / PyTorch' };
  assert.equal(matchingPositions(a, { city: '上海', query: 'PyTorch' }, now, employer).length, 0);
  assert.equal(
    matchingPositions(a, { major: 'supported', query: 'PyTorch' }, now, employer).length,
    0,
  );
  assert.equal(matchingPositions(a, { query: 'SQL PyTorch' }, now, employer).length, 0);
  assert.equal(matchingPositions(a, { query: 'example SQL' }, now, employer).length, 1);
  assert.equal(
    matchingPositions(a, { city: '无锡', query: '机器学习 PyTorch' }, now, employer).length,
    1,
  );
});

test('review: closed and watch-only records cannot be advertised as urgent', () => {
  const p = {
    ...base,
    cycle: 'current',
    deadline: { date: '2026-10-15', time: null, scope: 'test' },
  };
  for (const status of ['past', 'watch'])
    assert.equal(positionMatches({ ...p, status }, { status: 'urgent' }, now), false);
  for (const status of ['open', 'verify'])
    assert.equal(positionMatches({ ...p, status }, { status: 'urgent' }, now), true);
  assert.equal(
    positionMatches({ ...p, status: 'open', cycle: 'historical' }, { status: 'urgent' }, now),
    false,
  );
});

test('review: ranking uses only the selected evidence and never promotes watch-only roles', () => {
  const eligible = { ...base, major: 'statistics', cycle: 'current', status: 'open' };
  const pending = { ...base, major: 'unknown', cycle: 'unverified', status: 'verify' };
  assert.ok(
    diverseOrder({ matched: true, positions: [pending] }, now) >
      diverseOrder({ matched: true, positions: [eligible] }, now),
  );
  assert.ok(
    diverseOrder({ matched: true, positions: [{ ...eligible, status: 'watch' }] }, now) >
      diverseOrder({ matched: true, positions: [pending] }, now),
  );
});

test('review: a hard personal requirement does not falsify the public recruitment window', () => {
  const p = structuredClone(policy);
  p.entries[first.id].positions[0].leadership = 'required';
  p.entries[first.id].positions[0].leadershipBasis = '测试：官方硬要求';
  p.entries[first.id].positions[0].status = 'open';
  assert.doesNotThrow(() => validateDiverse(catalogs, p));
  assert.equal(positionMatches(p.entries[first.id].positions[0], {}, now), false);
  assert.equal(
    positionMatches(p.entries[first.id].positions[0], { leadership: 'all', status: 'open' }, now),
    true,
  );
});

test('review: duplicate roles metadata and duplicate crosslinks fail validation', () => {
  for (const edit of [
    (p) => p.entries[first.id].positions[0].cities.push(p.entries[first.id].positions[0].cities[0]),
    (p) =>
      p.entries[first.id].positions[0].directions.push(
        p.entries[first.id].positions[0].directions[0],
      ),
    (p) => p.entries[first.id].positions[0].refs.push(p.entries[first.id].positions[0].refs[0]),
    (p) => p.existingEntries.push(p.existingEntries[0]),
    (p) => (p.entries[first.id].reviewedOn = '2099-01-01'),
  ]) {
    const p = structuredClone(policy);
    edit(p);
    assert.throws(() => validateDiverse(catalogs, p));
  }
});

test('review: supplemental div cards cannot bypass assessment validation or lose their lookup', () => {
  const copy = structuredClone(catalogs);
  const item = copy.div.DATA.pop();
  copy.div.EXTRA.push(item);
  assert.doesNotThrow(() => validateDiverse(copy, policy));
  const lookup = createDiverseLookup(policy, copy.div);
  assert.equal(lookup(item, copy.div.SOURCES).matched, true);
  const missing = structuredClone(policy);
  delete missing.entries[item.id];
  assert.throws(() => validateDiverse(copy, missing));
});
