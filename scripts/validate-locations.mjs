import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  LOCATION_POLICY_VERSION,
  LOCATION_LEVELS,
  ZHEJIANG_CITIES,
  locationFacts,
} from '../src/location-policy.js';
export const locationDigest = (item, sources) =>
  createHash('sha256').update(locationFacts(item, sources)).digest('hex');
export const loadLocations = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, 'data/soe-locations.json'), 'utf8'));
/** Partial coverage is explicit. A missing row means unreviewed, not no opportunity in that city. */
export function validateLocations(catalog, policy, screening) {
  assert.equal(policy.version, 1, 'Unsupported location data version');
  assert.equal(policy.policyVersion, LOCATION_POLICY_VERSION, 'Unknown location policy');
  assert.ok(
    policy.entries && typeof policy.entries === 'object' && !Array.isArray(policy.entries),
    'Invalid location entries',
  );
  const items = new Map(catalog.DATA.map((item) => [item.id, item]));
  for (const [id, row] of Object.entries(policy.entries)) {
    const item = items.get(id);
    assert.ok(item, 'Orphan geographic assessment ' + id);
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'Invalid location assessment');
    for (const key of Object.keys(row))
      assert.ok(
        ['current', 'reviewedOn', 'locations', 'basisHash'].includes(key),
        'Unknown geographic field ' + key,
      );
    assert.equal(typeof row.current, 'boolean', 'Missing geographic cohort flag');
    if (row.current)
      assert.equal(
        screening.entries[id]?.cycle,
        'current',
        'Location bonus requires evidence from the current cohort',
      );
    assert.match(row.reviewedOn, /^\d{4}-\d{2}-\d{2}$/, 'Invalid location review date');
    assert.equal(
      new Date(row.reviewedOn).toISOString().slice(0, 10),
      row.reviewedOn,
      'Invalid location review date',
    );
    assert.ok(Array.isArray(row.locations), 'Missing explicit geographic assessment');
    const seen = new Set();
    for (const place of row.locations) {
      assert.ok(place && typeof place === 'object' && !Array.isArray(place), 'Invalid place');
      for (const key of Object.keys(place))
        assert.ok(
          ['city', 'province', 'level', 'scope', 'refs', 'directions'].includes(key),
          'Unknown place field ' + key,
        );
      assert.ok(
        typeof place.city === 'string' &&
          typeof place.province === 'string' &&
          place.province.length,
        'Invalid city/province',
      );
      assert.ok(Object.hasOwn(LOCATION_LEVELS, place.level), 'Invalid geographic evidence level');
      if (place.level === 'position')
        assert.ok(place.city.length, 'A position-level location needs a specific city');
      if (ZHEJIANG_CITIES.includes(place.city))
        assert.equal(place.province, '浙江', 'Wrong Zhejiang geography');
      assert.ok(
        Array.isArray(place.directions) &&
          place.directions.length &&
          place.directions.every((value) => screening.entries[id].directions.includes(value)),
        'Geographic role scope must be a subset of the assessed job directions',
      );
      assert.ok(
        typeof place.scope === 'string' && place.scope.trim().length >= 8,
        'Explain which jobs this location applies to',
      );
      assert.ok(Array.isArray(place.refs) && place.refs.length, 'Missing geographic evidence');
      for (const ref of place.refs) {
        assert.ok(catalog.SOURCES[ref]?.url, 'Missing public location source');
        assert.ok(item.audit?.refs?.includes(ref), 'Location source must be visible on the card');
      }
      const key = JSON.stringify([place.city, place.province, place.level, place.scope]);
      assert.ok(!seen.has(key), 'Duplicate geographic evidence');
      seen.add(key);
    }
    assert.equal(
      row.basisHash,
      locationDigest(item, catalog.SOURCES),
      'Job/location facts changed; review geography for ' + item.name,
    );
  }
  return {
    cards: items.size,
    reviewed: Object.keys(policy.entries).length,
    unreviewed: items.size - Object.keys(policy.entries).length,
  };
}
