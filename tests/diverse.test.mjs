import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KINDS, CARD_ID } from '../src/catalog-kinds.js';
import {
  loadCatalogs,
  normalizeCatalogs,
  hydratedFromTables,
  validatePrevious,
  ROOT,
} from '../scripts/catalog-data.mjs';
import { loadDiverse, validateDiverse } from '../scripts/validate-diverse.mjs';
import {
  createDiverseLookup,
  positionMatches,
  matchingPositions,
  positionWindow,
} from '../src/diverse-policy.js';
import { validateRuntimeCatalog } from '../src/catalog-cache.js';
import { StateStore } from '../src/state-store.js';
import { writeUserStateBatch } from '../src/cloud-sync.js';
import { normalizeTimelineEvent } from '../src/timeline-model.js';
import { sourceIdsForPage } from '../src/shared/source-index.js';

const catalogs = loadCatalogs(),
  policy = loadDiverse(ROOT),
  tables = normalizeCatalogs(catalogs);
const base = catalogs.div.DATA[0],
  lookup = createDiverseLookup(policy, catalogs.div);
const role = policy.entries[base.id].positions[0];
const now = new Date('2026-10-09T12:00:00+08:00');
const memory = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};

test('diverse: all three registered kinds and stable ID formats remain explicit', () => {
  assert.deepEqual([...KINDS], ['rec', 'soe', 'div']);
  for (const kind of KINDS) assert.ok(CARD_ID.test(kind + '-' + '1'.repeat(20)));
  for (const id of ['foreign-' + '1'.repeat(20), 'div-x', 'div-' + '1'.repeat(21)])
    assert.ok(!CARD_ID.test(id));
});

test('diverse: strict current publication requires three catalogs, historical comparison permits two', () => {
  const legacy = { rec: catalogs.rec, soe: catalogs.soe };
  assert.throws(() => normalizeCatalogs(legacy));
  assert.equal(normalizeCatalogs(legacy, { legacy: true }).catalog_archives.length, 2);
  assert.equal(validatePrevious(legacy, catalogs).catalog_archives.length, 3);
  const damaged = structuredClone(catalogs);
  damaged.soe.DATA.shift();
  assert.throws(() => validatePrevious(legacy, damaged), /removal|no matching card/);
});

test('diverse: every qualification snapshot matches its public evidence and legacy crosslinks', () => {
  const counts = validateDiverse(catalogs, policy);
  assert.equal(counts.cards, catalogs.div.DATA.length);
  assert.ok(counts.positions > counts.cards);
  assert.ok(policy.existingEntries.length > 0);
  assert.ok(
    Object.values(policy.entries)
      .flatMap((row) => row.positions)
      .some((p) => p.leadership === 'preferred'),
  );
  for (const item of catalogs.div.DATA)
    assert.equal(lookup(item, catalogs.div.SOURCES).matched, true);
  const changed = structuredClone(policy);
  changed.entries[base.id].basisHash = '0'.repeat(64);
  assert.throws(() => validateDiverse(catalogs, changed), /Stale/);
});

test('diverse: a city and a direction must match the same role, not different roles', () => {
  const positions = [
    { ...role, id: base.id + '-a', cities: ['上海'], directions: ['ai'] },
    { ...role, id: base.id + '-b', cities: ['成都'], directions: ['data'] },
  ];
  const assessment = { category: 'foreign', matched: true, positions };
  assert.equal(matchingPositions(assessment, { city: '上海', direction: 'data' }, now).length, 0);
  assert.equal(matchingPositions(assessment, { city: '成都', direction: 'data' }, now).length, 1);
  assert.equal(
    matchingPositions(assessment, { city: '成都', category: 'research' }, now).length,
    0,
  );
});

test('diverse: no student leadership excludes only hard requirements by default', () => {
  assert.equal(positionMatches({ ...role, leadership: 'required' }, {}, now), false);
  assert.equal(
    positionMatches({ ...role, leadership: 'required' }, { leadership: 'all' }, now),
    true,
  );
  assert.equal(positionMatches({ ...role, leadership: 'preferred' }, {}, now), true);
  assert.equal(positionMatches({ ...role, leadership: 'unknown' }, {}, now), true);
  assert.equal(
    positionMatches({ ...role, leadership: 'unknown' }, { leadership: 'not_stated' }, now),
    false,
  );
});

test('diverse: changing cloud facts or source evidence invalidates old qualification claims', () => {
  assert.equal(
    lookup({ ...base, req: base.req + ' changed' }, catalogs.div.SOURCES).matched,
    false,
  );
  const sources = structuredClone(catalogs.div.SOURCES);
  sources[base.audit.refs[0]].scope += ' changed';
  const stale = lookup(base, sources);
  assert.equal(stale.matched, false);
  assert.deepEqual(stale.positions, []);
  assert.equal(matchingPositions(stale, {}, now).length, 0);
});

test('diverse: database round-trip retains the exact screening evidence boundary', () => {
  const restored = hydratedFromTables('div', tables);
  validateRuntimeCatalog(restored, 'div');
  for (const item of restored.ALL_ITEMS)
    assert.equal(lookup(item, restored.SOURCES).matched, true, item.name);
});

test('diverse: unknown deadlines never become urgent; date-only deadlines use Beijing day boundary', () => {
  assert.equal(positionMatches({ ...role, deadline: null }, { status: 'urgent' }, now), false);
  const p = {
    ...role,
    deadline: { date: '2026-10-09', time: null, scope: 'test' },
    status: 'open',
  };
  assert.equal(positionWindow(p, new Date('2026-10-09T23:59:00+08:00')).status, 'open');
  assert.equal(positionWindow(p, new Date('2026-10-10T00:00:01+08:00')).status, 'past');
  assert.equal(
    positionMatches(p, { status: 'urgent' }, new Date('2026-10-10T00:00:01+08:00')),
    false,
  );
});

test('diverse: mixed old and new guest states persist in the same existing storage key', () => {
  const storage = memory(),
    store = new StateStore(storage);
  const oldRec = catalogs.rec.DATA[0].id,
    oldSoe = catalogs.soe.DATA[0].id;
  store.set(oldRec, 'applied');
  store.set(oldSoe, 'uninterested');
  store.set(base.id, 'applied');
  const reloaded = new StateStore(storage);
  assert.equal(reloaded.status(oldRec), 'applied');
  assert.equal(reloaded.status(oldSoe), 'uninterested');
  assert.equal(reloaded.status(base.id), 'applied');
  assert.throws(() => reloaded.set('other-' + '0'.repeat(20), 'applied'));
});

test('diverse: cloud upsert accepts new IDs without changing the owner-scoped table', async () => {
  let sent;
  const user = '00000000-0000-4000-8000-000000000001';
  const query = {
    upsert(rows, options) {
      sent = { rows, options };
      return this;
    },
    select() {
      return this;
    },
    abortSignal() {
      return Promise.resolve({
        data: sent.rows.map((r) => ({
          entry_id: r.entry_id,
          status: r.status,
          updated_at: '2026-10-09T00:00:00Z',
        })),
        error: null,
      });
    },
  };
  const client = {
    from(name) {
      assert.equal(name, 'user_card_states');
      return query;
    },
  };
  const rows = await writeUserStateBatch(client, user, [{ entry_id: base.id, status: 'applied' }]);
  assert.equal(rows[0].entry_id, base.id);
  assert.equal(sent.rows[0].user_id, user);
  assert.equal(sent.options.onConflict, 'user_id,entry_id');
  await assert.rejects(() =>
    writeUserStateBatch(client, user, [{ entry_id: 'fake-' + base.id, status: 'applied' }]),
  );
});

test('diverse: private timeline can reference a new card without schema changes', () => {
  const value = {
    id: '00000000-0000-4000-8000-000000000002',
    entry_id: base.id,
    title: '面试',
    company_name: base.name,
    event_type: 'interview',
    starts_at: '2026-10-11T02:00:00Z',
    ends_at: null,
    status: 'pending',
    location: '线上',
    url: '',
    notes: '',
    is_deleted: false,
  };
  assert.equal(normalizeTimelineEvent(value).entry_id, base.id);
  assert.throws(() => normalizeTimelineEvent({ ...value, entry_id: 'fake-' + base.id }));
});

test('diverse: sources do not inherit the old SOE history label or unrelated source prefixes', () => {
  const ids = sourceIdsForPage({
    ...catalogs.div,
    SOURCES: { ...catalogs.div.SOURCES, H02: {}, RZZ: {}, SZZ: {} },
  });
  assert.ok(ids.includes('D001'));
  assert.ok(!ids.includes('H02'));
  assert.ok(!ids.includes('RZZ'));
  assert.ok(!ids.includes('SZZ'));
});

test('diverse: additive migration extends public contracts without altering private tables', () => {
  const sql = fs.readFileSync(
    new URL('../supabase/migrations/202610100005_diverse_catalog.sql', import.meta.url),
    'utf8',
  );
  for (const name of ['job_entries', 'catalog_archives', 'timeline_events', 'change_logs'])
    assert.ok(sql.includes('alter table public.' + name + ' add constraint'));
  assert.match(sql, /\^\(rec\|soe\|div\)/);
  assert.match(sql, /not in \(2,3\)/);
  assert.match(sql, /Archive and catalog kinds must match/);
  assert.doesNotMatch(
    sql,
    /(?:alter table|delete from|update|insert into)\s+(?:public\.)?(?:user_card_states|user_timeline_events|auth\.)/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.recsys_apply_catalog[\s\S]*from public,anon,authenticated/,
  );
});

test('diverse: cloud source index excludes unrelated legacy D1007 references', () => {
  const restored = hydratedFromTables('div', tables);
  restored.SOURCES['D1007-unrelated'] = {
    id: 'D1007-unrelated',
    title: 'Unrelated old-page source',
  };
  const shown = sourceIdsForPage(restored);
  const expected = [...new Set(catalogs.div.DATA.flatMap((item) => item.audit.refs))];
  assert.deepEqual(shown.sort(), expected.sort());
  assert.ok(!shown.includes('D1007-unrelated'));
});
