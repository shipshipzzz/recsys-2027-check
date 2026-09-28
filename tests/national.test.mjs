import test from 'node:test';
import assert from 'node:assert/strict';
import { nationalFixture } from './fixtures/national.mjs';
import {
  createOpportunityLookup,
  noticeDeadline,
  noticeActionable,
  deadlineUrgency,
  directoryMatch,
  hasHeadquartersClue,
} from '../src/national-policy.js';
import { timeState, deadlineEpoch } from '../src/shared/time.js';
import { locationMatchKind, availableCities, locationBonus } from '../src/location-policy.js';
import {
  readPositionProgress,
  writePositionProgress,
  exportPositionProgress,
  POSITION_KEY,
} from '../src/position-progress.js';
import { validateNational } from '../scripts/validate-national.mjs';
import { loadJSON } from '../src/shared/json-loader.js';
const now = new Date('2026-09-28T12:00:00+08:00');
test('yesterday evidence still supports deadlines, pending dates remind without asserting eligibility', () => {
  const f = nationalFixture(),
    a = f.screening.entries[f.oil.id];
  assert.equal(noticeDeadline(f.oil, a, {}, f.catalog.SOURCES, now).confidence, 'supported');
  assert.equal(deadlineUrgency(f.oil, a, {}, f.catalog.SOURCES, now), 'supported');
  const pending = f.screening.entries[f.pending.id];
  assert.equal(deadlineUrgency(f.pending, pending, {}, f.catalog.SOURCES, now), 'pending');
  assert.equal(noticeActionable(f.pending, pending, {}, now), false);
  assert.equal(
    deadlineUrgency(f.oil, { ...a, cycle: 'historical' }, {}, f.catalog.SOURCES, now),
    null,
  );
});
test('independent deadlines advance after September 30 and never expire the entire institution', () => {
  const f = nationalFixture(),
    lookup = createOpportunityLookup(f.opportunities, f.catalog, f.screening),
    a = f.screening.entries[f.bank.id],
    row = lookup(f.bank, f.catalog.SOURCES);
  assert.equal(noticeDeadline(f.bank, a, row, f.catalog.SOURCES, now).date, '2026-09-30');
  const october = new Date('2026-10-01T00:00:00+08:00');
  assert.equal(noticeDeadline(f.bank, a, row, f.catalog.SOURCES, october).date, '2026-10-25');
  assert.equal(noticeActionable(f.bank, a, row, october), true);
  assert.equal(noticeDeadline(f.bank, a, row, f.catalog.SOURCES, new Date('2026-10-26')), null);
  row.positions[0].type = 'internship';
  row.positions[0].cycle = 'historical';
  row.positions[1].major = 'unknown';
  assert.equal(noticeActionable(f.bank, a, row, now), false);
  assert.equal(noticeDeadline(f.bank, a, row, f.catalog.SOURCES, now).date, '2026-10-25');
});
test('clock times preserve single-day, unknown-time, 24:00 and exact expiration boundaries', () => {
  for (const time of [null, '24:00', '23:59:59']) {
    const ev = { date: '2026-09-30', time, confidence: 'supported' };
    assert.equal(timeState(ev, new Date('2026-09-30T12:00:00+08:00')).expired, false);
    assert.equal(timeState(ev, new Date(deadlineEpoch(ev) - 1)).expired, false);
    assert.equal(timeState(ev, new Date(deadlineEpoch(ev))).expired, true);
  }
  assert.match(
    timeState(
      { date: '2026-09-30', confidence: 'supported' },
      new Date('2026-09-30T12:00:00+08:00'),
    ).label,
    /时刻未注明/,
  );
  assert.equal(timeState(null, now).days, null);
});
test('changed cloud facts or a mismatched supplement hash revoke positions and supported deadlines', () => {
  const f = nationalFixture(),
    lookup = createOpportunityLookup(f.opportunities, f.catalog, f.screening);
  assert.equal(lookup(f.bank, f.catalog.SOURCES).matched, true);
  f.bank.jobs += ' changed';
  const row = lookup(f.bank, f.catalog.SOURCES);
  assert.equal(row.stale, true);
  assert.deepEqual(row.positions, []);
  assert.equal(
    noticeDeadline(f.bank, f.screening.entries[f.bank.id], row, f.catalog.SOURCES, now).confidence,
    'pending',
  );
  assert.equal(noticeActionable(f.bank, f.screening.entries[f.bank.id], row, now), false);
  const clean = nationalFixture();
  clean.opportunities.entries[clean.bank.id].basisHash = 'different';
  const mismatch = createOpportunityLookup(clean.opportunities, clean.catalog, clean.screening);
  assert.equal(mismatch(clean.bank, clean.catalog.SOURCES).stale, true);
});
test('aliases and headquarters refer only to directory-linked entries', () => {
  const f = nationalFixture();
  for (const q of ['中石油', '中国石油', 'CNPC', '三桶油'])
    assert.equal(directoryMatch(f.directory, f.oil.id, q), true);
  for (const q of ['中行', '中国银行', '四大行', '总行'])
    assert.equal(directoryMatch(f.directory, f.boc.id, q), true);
  assert.equal(directoryMatch(f.directory, f.icbc.id, '工行'), true);
  assert.equal(directoryMatch(f.directory, f.abc.id, '农行'), true);
  assert.equal(hasHeadquartersClue(f.directory, f.oil.id), false);
  assert.equal(directoryMatch(f.directory, f.bank.id, '四大行'), false);
});
test('pending-location opt-in does not widen known other-city jobs or add a bonus', () => {
  const unknown = { matched: false, current: false, locations: [] };
  assert.equal(locationMatchKind(unknown, '杭州'), null);
  assert.equal(locationMatchKind(unknown, '杭州', 'all', true), 'pending');
  assert.equal(locationBonus(unknown), 0);
  const known = {
    matched: true,
    current: true,
    locations: [{ city: '上海', province: '上海', level: 'position', directions: ['stats'] }],
  };
  assert.equal(locationMatchKind(known, '杭州', 'all', true), null);
  assert.deepEqual(availableCities([unknown, known]), ['上海']);
});
test('position progress has a separate key, survives reload, rejects parent IDs and handles denied storage', () => {
  const f = nationalFixture(),
    data = new Map([['legacy', 'untouched']]),
    storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const entries = { [f.positions[0].id]: 'applied', [f.positions[1].id]: 'pending' };
  assert.equal(writePositionProgress(storage, entries), true);
  assert.deepEqual(readPositionProgress(storage), entries);
  assert.equal(data.get('legacy'), 'untouched');
  assert.equal(data.size, 2);
  assert.ok(data.has(POSITION_KEY));
  assert.equal(writePositionProgress(storage, { [f.bank.id]: 'applied' }), false);
  assert.equal(
    writePositionProgress(
      {
        setItem() {
          throw Error();
        },
      },
      entries,
    ),
    false,
  );
  assert.deepEqual(
    readPositionProgress({
      getItem() {
        return '{bad';
      },
    }),
    {},
  );
  assert.deepEqual(JSON.parse(exportPositionProgress(entries)).entries, entries);
});
test('national validation rejects orphan references, stale binding, bad states, dates and source scope', () => {
  const f = nationalFixture();
  assert.equal(validateNational(f.catalog, f.directory, f.opportunities).positions, 2);
  for (const mutate of [
    (g) => g.directory.groups[0].entryIds.push('missing'),
    (g) => (g.directory.groups[0].reviewState = 'invented'),
    (g) => (g.opportunities.entries[g.bank.id].basisHash = 'bad'),
    (g) => (g.positions[0].refs = ['missing']),
    (g) => (g.positions[0].due = '2026-02-30'),
    (g) => (g.positions[0].dueTime = '25:00'),
    (g) => (g.directory.groups[4].checkedOn = '2026-09-28'),
  ]) {
    const next = nationalFixture();
    mutate(next);
    assert.throws(() => validateNational(next.catalog, next.directory, next.opportunities));
  }
});
test('JSON loading is bounded, same-origin, credential-free and rejects malformed assets', async () => {
  const base = 'https://example.com/app/';
  assert.deepEqual(
    await loadJSON('data.json', {
      base,
      fetchImpl: async (_url, options) => {
        assert.equal(options.credentials, 'omit');
        return new Response('{"ok":true}');
      },
    }),
    { ok: true },
  );
  await assert.rejects(loadJSON('https://other.example/data.json', { base }));
  await assert.rejects(
    loadJSON('bad.json', { base, fetchImpl: async () => new Response('<html>') }),
  );
  await assert.rejects(
    loadJSON('slow.json', { base, timeoutMs: 5, fetchImpl: () => new Promise(() => {}) }),
    /超时/,
  );
});
