import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSITION_KEY,
  POSITION_IMPORT_MAX_BYTES,
  createPositionProgressStore,
  exportPositionProgress,
  parsePositionProgress,
  summarizePositionImport,
  readPositionProgress,
  writePositionProgress,
} from '../src/position-progress.js';
import { pendingOpportunities, noticeDeadline } from '../src/national-policy.js';
import { nationalFixture } from './fixtures/national.mjs';
const a = 'soe-00000000000000000001-p01';
const b = 'soe-00000000000000000001-p02';
const c = 'soe-00000000000000000002-p01';
function memory(entries = {}) {
  const data = new Map([
    [POSITION_KEY, exportPositionProgress(entries)],
    ['account', 'untouched'],
  ]);
  let denied = false,
    unreadable = false;
  return {
    data,
    deny: (value) => {
      denied = value;
    },
    unreadable: (value) => {
      unreadable = value;
    },
    getItem(key) {
      if (unreadable) throw Error('denied read');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (denied) throw Error('quota');
      data.set(key, value);
    },
  };
}
test('position store: consecutive failed writes retain every dirty edit and recover together', () => {
  const storage = memory({ [a]: 'pending', [b]: 'pending' });
  const store = createPositionProgressStore(storage);
  storage.deny(true);
  assert.equal(store.set(a, 'applied'), false);
  assert.equal(store.set(b, 'ignored'), false);
  assert.deepEqual(store.snapshot(), { [a]: 'applied', [b]: 'ignored' });
  assert.equal(store.unsaved, true);
  storage.deny(false);
  assert.equal(store.retry(), true);
  assert.equal(store.unsaved, false);
  assert.deepEqual(readPositionProgress(storage), store.snapshot());
  assert.equal(storage.data.get('account'), 'untouched');
});
test('position store: sequential tab updates merge unrelated IDs but dirty local choices win', () => {
  const storage = memory({ [a]: 'pending' });
  const first = createPositionProgressStore(storage),
    second = createPositionProgressStore(storage);
  storage.deny(true);
  first.set(a, 'applied');
  storage.deny(false);
  second.set(b, 'ignored');
  first.refresh();
  assert.deepEqual(first.snapshot(), { [a]: 'applied', [b]: 'ignored' });
  assert.equal(first.retry(), true);
  second.refresh();
  assert.deepEqual(second.snapshot(), first.snapshot());
  const copy = first.snapshot();
  copy[a] = 'pending';
  assert.equal(first.snapshot()[a], 'applied');
});
test('position store: explicit removal resets saved state without dropping unrelated unsaved edits', () => {
  const storage = memory({ [a]: 'applied' }),
    store = createPositionProgressStore(storage);
  storage.data.delete(POSITION_KEY);
  store.refresh();
  assert.deepEqual(store.snapshot(), {});
  storage.deny(true);
  store.set(b, 'ignored');
  storage.data.clear();
  store.refresh();
  assert.deepEqual(store.snapshot(), { [b]: 'ignored' });
});
test('position store: unreadable or corrupt storage is never overwritten by a partial snapshot', () => {
  const storage = memory({ [a]: 'applied' }),
    store = createPositionProgressStore(storage);
  const original = storage.data.get(POSITION_KEY);
  storage.unreadable(true);
  assert.equal(store.set(b, 'ignored'), false);
  assert.equal(storage.data.get(POSITION_KEY), original);
  storage.unreadable(false);
  storage.data.set(POSITION_KEY, '{broken');
  assert.equal(store.retry(), false);
  assert.equal(storage.data.get(POSITION_KEY), '{broken');
  storage.data.set(POSITION_KEY, original);
  assert.equal(store.retry(), true);
  assert.deepEqual(readPositionProgress(storage), { [a]: 'applied', [b]: 'ignored' });
});
test('position backup: original v1 exports roundtrip and malformed imports are rejected atomically', () => {
  const entries = { [a]: 'applied', [b]: 'pending' };
  assert.deepEqual(parsePositionProgress('\uFEFF' + exportPositionProgress(entries)), entries);
  const invalid = [
    null,
    [],
    {},
    { version: 2, entries },
    { version: 1, entries: [] },
    { version: 1, entries: { [a]: ['applied'] } },
    { version: 1, entries: { [a]: null } },
    { version: 1, entries: { 'soe-00000000000000000001': 'applied' } },
    { version: 1, entries, privateAccount: 'not a progress backup' },
  ];
  for (const value of invalid) assert.throws(() => parsePositionProgress(JSON.stringify(value)));
  assert.throws(() => parsePositionProgress('{broken'));
  assert.throws(() => parsePositionProgress(' '.repeat(POSITION_IMPORT_MAX_BYTES + 1)));
  assert.equal(writePositionProgress(memory(), { [a]: ['applied'] }), false);
});
test('position backup: preview reports conflicts and unknown IDs; merge preserves records outside backup', () => {
  const storage = memory({ [a]: 'applied', [b]: 'ignored' }),
    store = createPositionProgressStore(storage);
  const incoming = { [a]: 'pending', [c]: 'applied' };
  assert.deepEqual(summarizePositionImport(store.snapshot(), incoming, new Set([a, b])), {
    total: 2,
    added: 1,
    changed: 1,
    unchanged: 0,
    unknown: 1,
  });
  assert.equal(store.merge(incoming), true);
  assert.deepEqual(store.snapshot(), { [a]: 'pending', [b]: 'ignored', [c]: 'applied' });
  const before = store.snapshot();
  assert.throws(() => store.merge({ [a]: 'applied', broken: 'ignored' }));
  assert.deepEqual(store.snapshot(), before);
});
test('pending deadlines: handled, expired and internship jobs cannot resurrect a parent reminder', () => {
  const f = nationalFixture(),
    row = { matched: true, positions: f.positions };
  const handled = pendingOpportunities(
    row,
    { [f.positions[0].id]: 'applied', [f.positions[1].id]: 'ignored' },
    new Date('2026-09-28'),
  );
  assert.equal(handled.matched, true);
  assert.deepEqual(handled.positions, []);
  assert.equal(
    noticeDeadline(f.bank, {}, handled, f.catalog.SOURCES, new Date('2026-09-28')),
    null,
  );
  assert.equal(pendingOpportunities(row, {}, new Date('2026-10-01')).positions.length, 1);
  f.positions[1].type = 'internship';
  assert.equal(pendingOpportunities(row, {}, new Date('2026-10-01')).positions.length, 0);
});

test('position backup: limits apply to the latest merged disk snapshot before any edit', () => {
  const storage = memory(),
    store = createPositionProgressStore(storage);
  const full = Object.fromEntries(
    Array.from({ length: 10000 }, (_, i) => ['soe-00000000000000000003-p' + i, 'pending']),
  );
  storage.data.set(POSITION_KEY, exportPositionProgress(full));
  assert.throws(() => store.merge({ [a]: 'applied' }), /10000/);
  assert.equal(store.unsaved, false);
  assert.deepEqual(store.snapshot(), full);
  assert.throws(() => store.set(b, 'ignored'), /10000/);
  assert.deepEqual(readPositionProgress(storage), full);
});

test('position backup: oversized serialized merges keep the old snapshot exportable', () => {
  const storage = memory({ [a]: 'applied' }),
    store = createPositionProgressStore(storage);
  const huge = Object.fromEntries(
    Array.from({ length: 8000 }, (_, i) => [
      'soe-00000000000000000003-' + String(i).padStart(95, 'x'),
      'pending',
    ]),
  );
  assert.throws(() => store.merge(huge), /1 MiB/);
  assert.deepEqual(store.snapshot(), { [a]: 'applied' });
  assert.equal(store.unsaved, false);
  assert.deepEqual(parsePositionProgress(exportPositionProgress(store.snapshot())), {
    [a]: 'applied',
  });
});
