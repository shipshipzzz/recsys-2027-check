import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogs, ROOT } from '../scripts/catalog-data.mjs';
import { loadScreening } from '../scripts/validate-screening.mjs';
import { loadLocations, validateLocations } from '../scripts/validate-locations.mjs';
import {
  PRIORITY_CITIES,
  createLocationLookup,
  locationBonus,
  matchesLocation,
  comparePreferredOpportunities,
} from '../src/location-policy.js';
const catalog = loadCatalogs().soe,
  policy = loadLocations(ROOT),
  screening = loadScreening(ROOT);
const place = (city, province = '浙江', level = 'position', directions = ['stats']) => ({
  city,
  province,
  level,
  directions,
});
const geo = (locations, current = true) => ({ matched: true, current, locations });
const lookup = createLocationLookup(policy, catalog);
const find = (name) => catalog.DATA.find((item) => item.name.startsWith(name));

test('geographic metadata is evidenced, bounded and attached to existing cards', () => {
  const result = validateLocations(catalog, policy, screening);
  assert.equal(result.cards, catalog.DATA.length);
  assert.ok(result.reviewed > 0);
  assert.equal(result.cards, result.reviewed + result.unreviewed);
});
test('all four requested cities receive equal priority, with no implicit hierarchy', () => {
  assert.deepEqual(PRIORITY_CITIES, ['杭州', '成都', '重庆', '西安']);
  for (const [city, province] of [
    ['杭州', '浙江'],
    ['成都', '四川'],
    ['重庆', '重庆'],
    ['西安', '陕西'],
  ])
    assert.equal(locationBonus(geo([place(city, province)])), 8);
  assert.equal(locationBonus(geo([place('宁波')])), 6);
});
test('city counts and Hangzhou plus Zhejiang never compound bonuses', () => {
  assert.equal(
    locationBonus(
      geo([place('杭州'), place('宁波'), place('成都', '四川'), place('', '浙江', 'campaign')]),
    ),
    8,
  );
  assert.equal(locationBonus(geo([place('杭州', '浙江', 'campaign')])), 4);
  assert.equal(locationBonus(geo([place('', '浙江', 'campaign')])), 3);
});
test('headquarters, historical and unreviewed geography receive no bonus', () => {
  assert.equal(locationBonus(geo([place('杭州', '浙江', 'headquarters')])), 0);
  assert.equal(locationBonus(geo([place('杭州', '浙江', 'historical')])), 0);
  assert.equal(locationBonus(geo([place('杭州')], false)), 0);
  assert.equal(locationBonus({ ...geo([place('杭州')]), matched: false }), 0);
});
test('province-only campaign evidence is not silently converted into a Hangzhou job', () => {
  const item = find('杭州银行'),
    value = lookup(item, catalog.SOURCES);
  assert.equal(matchesLocation(value, '浙江'), true);
  assert.equal(matchesLocation(value, '杭州'), false);
  assert.equal(matchesLocation(value, 'all'), true);
});
test('directions and cities intersect at the actual job scope, not across different jobs', () => {
  const item = find('国贸股份'),
    value = lookup(item, catalog.SOURCES);
  assert.equal(matchesLocation(value, '杭州', 'research'), false);
  assert.equal(matchesLocation(value, '杭州', 'supply'), true);
  assert.equal(locationBonus(value, 'research'), 0);
  assert.equal(locationBonus(value, 'supply'), 8);
});
test('service-area rotation and bank insurance examination cities are not fixed Hangzhou jobs', () => {
  const commercial = lookup(find('浙江省商业集团'), catalog.SOURCES);
  assert.equal(matchesLocation(commercial, '杭州', 'research'), true);
  const life = lookup(find('建信人寿 · 精算'), catalog.SOURCES);
  assert.equal(locationBonus(life), 0);
  assert.equal(matchesLocation(life, 'preferred'), false);
  assert.equal(matchesLocation(life, 'all'), true);
});
test('changed cloud job or source facts revoke previously verified geography', () => {
  const item = find('重庆三峡'),
    source = catalog.SOURCES;
  assert.equal(lookup(item, source).matched, true);
  for (const field of ['city', 'jobs', 'req', 'status']) {
    const next = { ...item, [field]: 'changed' };
    assert.equal(lookup(next, source).matched, false);
  }
  const changed = structuredClone(source);
  changed[item.audit.refs[0]].scope += ' updated';
  assert.equal(lookup(item, changed).matched, false);
});
test('publishing rejects orphaned geography, stale bindings, fabricated role scope and incorrect province', () => {
  let next = structuredClone(policy);
  next.entries['soe-' + 'f'.repeat(20)] = Object.values(next.entries)[0];
  assert.throws(() => validateLocations(catalog, next, screening), /Orphan/);
  const id = find('浙江省商业集团').id;
  next = structuredClone(policy);
  next.entries[id].basisHash = 'a'.repeat(64);
  assert.throws(() => validateLocations(catalog, next, screening), /facts changed/);
  next = structuredClone(policy);
  next.entries[id].locations[0].directions = ['insurance'];
  assert.throws(() => validateLocations(catalog, next, screening), /role scope/);
  next = structuredClone(policy);
  next.entries[id].locations[0].province = '四川';
  assert.throws(() => validateLocations(catalog, next, screening), /geography/);
});
test('a location bonus breaks a comparable score tie but cannot override qualification or an expired window', () => {
  const now = new Date('2026-09-13T00:00:00Z');
  const a = { id: 'a', status: 'open', fit: 85, priority: 3 },
    b = { id: 'b', status: 'open', fit: 85, priority: 1 };
  const qualified = { cycle: 'current', major: 'statistics' },
    uncertain = { cycle: 'current', major: 'unknown' };
  const local = geo([place('杭州')]),
    remote = geo([]);
  assert.ok(comparePreferredOpportunities(a, b, qualified, qualified, local, remote, now) < 0);
  assert.ok(comparePreferredOpportunities(a, b, uncertain, qualified, local, remote, now) > 0);
  assert.ok(
    comparePreferredOpportunities(
      { ...a, due: '2026-09-01' },
      b,
      qualified,
      qualified,
      local,
      remote,
      now,
    ) > 0,
  );
  assert.ok(
    comparePreferredOpportunities(a, b, qualified, qualified, local, remote, now, 'research') > 0,
  );
});
