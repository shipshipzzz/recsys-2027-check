import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCatalogs, normalizeCatalogs, hydratedFromTables } from '../scripts/catalog-data.mjs';
import { validateScreening, screeningDigest } from '../scripts/validate-screening.mjs';
import {
  SOE_TRACKS,
  BROAD_TRACKS,
  createAssessmentLookup,
  matchesAssessment,
  hasMajorEvidence,
  canActOnNotice,
} from '../src/soe-policy.js';
import { createCatalogResource, validateRuntimeCatalog } from '../src/catalog-cache.js';
const catalogs = loadCatalogs(),
  baseline = catalogs.soe;
const policy = JSON.parse(
  fs.readFileSync(new URL('../data/soe-screening.json', import.meta.url), 'utf8'),
);
const preservation = JSON.parse(
  fs.readFileSync(new URL('./fixtures/soe-preservation.json', import.meta.url), 'utf8'),
);
const strong = () =>
  baseline.DATA.find(
    (item) =>
      hasMajorEvidence(policy.entries[item.id]) &&
      item.status === 'open' &&
      policy.entries[item.id].cycle === 'current',
  );
const copy = () => ({ catalog: structuredClone(baseline), policy: structuredClone(policy) });

test('SOE: every card has a substantive, fact-bound professional and recruitment-cycle assessment', () => {
  assert.equal(validateScreening(baseline, policy).cards, baseline.DATA.length);
});
test('SOE: retained stable IDs and the entire original history survive expansion', () => {
  for (const id of preservation.ids) assert.ok(baseline.DATA.some((item) => item.id === id));
  assert.equal(
    createHash('sha256').update(JSON.stringify(baseline.ORIGINAL_ITEMS)).digest('hex'),
    preservation.historySha256,
  );
  assert.ok(baseline.DATA.length > preservation.ids.length);
});
test('SOE: browser and publishing validation accept every shared direction, not only algorithm tracks', () => {
  for (const track of Object.keys(SOE_TRACKS)) {
    const c = structuredClone(catalogs);
    c.soe.DATA[0].track = track;
    assert.doesNotThrow(() => normalizeCatalogs(c));
    assert.doesNotThrow(() => validateRuntimeCatalog(c.soe, 'soe'));
  }
  const c = structuredClone(catalogs);
  c.soe.DATA[0].track = 'forged-direction';
  assert.throws(() => normalizeCatalogs(c), /track/);
  assert.throws(() => validateRuntimeCatalog(c.soe, 'soe'));
});
test('SOE: multiple directions and professional/cycle filters intersect without duplicating cards', () => {
  const a = { major: 'statistics', cycle: 'current', directions: ['research', 'supply', 'stats'] };
  assert.equal(
    matchesAssessment(a, { direction: 'broad', major: 'supported', cycle: 'current' }),
    true,
  );
  assert.equal(matchesAssessment(a, { direction: 'stats' }), true);
  assert.equal(matchesAssessment(a, { direction: 'research' }), true);
  assert.equal(matchesAssessment(a, { direction: 'ai' }), false);
  assert.equal(matchesAssessment(a, { major: 'unrestricted' }), false);
  assert.equal(matchesAssessment(a, { cycle: 'historical' }), false);
  for (const direction of BROAD_TRACKS) assert.ok(Object.hasOwn(SOE_TRACKS, direction));
});
test('SOE: identical database roundtrips retain professional assessments', () => {
  const lookup = createAssessmentLookup(policy, baseline),
    cloud = hydratedFromTables('soe', normalizeCatalogs(catalogs));
  for (const item of cloud.DATA) {
    assert.equal(lookup(item, cloud.SOURCES).matched, true, item.name);
    assert.equal(lookup(item, cloud.SOURCES).major, policy.entries[item.id].major);
  }
});
test('SOE: changed qualifications, cohort, ownership or evidence never inherit a stale positive assessment', () => {
  for (const edit of [
    (i) => {
      i.req += ' changed';
    },
    (i) => {
      i.window = '2026届';
    },
    (i) => {
      i.jobs += ' changed';
    },
    (i) => {
      i.ownership = 'other employer';
    },
  ]) {
    const item = structuredClone(strong());
    edit(item);
    const lookup = createAssessmentLookup(policy, baseline),
      a = lookup(item, baseline.SOURCES);
    assert.equal(a.major, 'unknown');
    assert.equal(a.cycle, 'unverified');
    assert.equal(a.matched, false);
  }
  const item = structuredClone(strong()),
    sources = structuredClone(baseline.SOURCES),
    lookup = createAssessmentLookup(policy, baseline);
  assert.equal(lookup(item, sources).matched, true);
  sources[item.audit.refs[0]].scope += ' changed';
  assert.equal(lookup(item, sources).matched, false);
});
test('SOE: in-place mutations invalidate the lookup cache as well as replacement objects', () => {
  const item = structuredClone(strong()),
    lookup = createAssessmentLookup(policy, baseline);
  assert.equal(lookup(item, baseline.SOURCES).matched, true);
  item.req = 'professional conditions changed';
  assert.equal(lookup(item, baseline.SOURCES).major, 'unknown');
});
test('SOE: missing or orphan assessments and silently changed facts fail publication', () => {
  let c = copy();
  delete c.policy.entries[c.catalog.DATA[0].id];
  assert.throws(() => validateScreening(c.catalog, c.policy));
  c = copy();
  c.policy.entries['soe-' + '0'.repeat(20)] = { ...Object.values(c.policy.entries)[0] };
  assert.throws(() => validateScreening(c.catalog, c.policy));
  c = copy();
  c.catalog.DATA[0].req += ' altered';
  assert.throws(() => validateScreening(c.catalog, c.policy), /changed/);
});
test('SOE: professional evidence alone does not prove that a posting is currently actionable', () => {
  const now = new Date('2026-09-13T00:00:00Z'),
    item = { status: 'open' },
    a = { major: 'statistics', cycle: 'current' };
  assert.equal(canActOnNotice(item, a, now), true);
  for (const major of ['related', 'unknown'])
    assert.equal(canActOnNotice(item, { ...a, major }, now), false);
  for (const cycle of ['historical', 'unverified'])
    assert.equal(canActOnNotice(item, { ...a, cycle }, now), false);
  assert.equal(canActOnNotice({ ...item, status: 'verify' }, a, now), false);
  assert.equal(canActOnNotice({ ...item, due: '2026-09-12' }, a, now), false);
  assert.equal(canActOnNotice({ ...item, start: '2026-09-14' }, a, now), false);
});
test('SOE: historical evidence cannot be relabelled as an open current-cycle opportunity', () => {
  const c = copy(),
    item = c.catalog.DATA.find((i) => i.id === strong().id),
    row = c.policy.entries[item.id];
  row.cycle = 'historical';
  row.intake = 2026;
  row.basisHash = screeningDigest(item, c.catalog.SOURCES);
  assert.throws(() => validateScreening(c.catalog, c.policy), /Historical/);
});
test('SOE: a stale cloud catalog cannot hide cards shipped in a newer build', async () => {
  const old = structuredClone(baseline);
  old.DATA.pop();
  const resource = createCatalogResource({
    kind: 'soe',
    fallback: baseline,
    fetchCatalog: async () => old,
  });
  const initial = resource.current;
  await resource.refresh();
  assert.equal(resource.current, initial);
  assert.ok(resource.lastError);
  assert.equal(resource.current.ALL_ITEMS.length, baseline.DATA.length);
});
test('SOE: fresh but incomplete cache data also falls back to the full bundled catalog', () => {
  const old = structuredClone(baseline);
  old.DATA.pop();
  const resource = createCatalogResource({
    kind: 'soe',
    fallback: baseline,
    now: () => 1000,
    storage: { getItem: () => JSON.stringify({ version: 2, savedAt: 999, catalog: old }) },
    fetchCatalog: async () => baseline,
  });
  assert.equal(resource.current.connection, 'fallback');
  assert.equal(resource.current.ALL_ITEMS.length, baseline.DATA.length);
});
test('SOE: conflicting recruitment years stay visible as unresolved, even with a major-unrestricted role', () => {
  const item = baseline.DATA.find((i) => i.id === 'soe-1bc9a6c37424182099b8');
  assert.equal(policy.entries[item.id].major, 'unrestricted');
  assert.equal(policy.entries[item.id].cycle, 'unverified');
  assert.equal(item.due, undefined);
  assert.match(item.window, /冲突/);
});
