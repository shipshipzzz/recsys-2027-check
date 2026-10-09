import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CARD_ID } from '../src/catalog-kinds.js';
import {
  DIVERSE_CATEGORIES,
  DIVERSE_TRACKS,
  DIVERSE_MAJORS,
  DIVERSE_CYCLES,
  DIVERSE_LEADERSHIP,
  DIVERSE_EMPLOYMENT,
  DIVERSE_STATUS,
  POSITION_ID,
  diverseFacts,
} from '../src/diverse-policy.js';
export const diverseDigest = (item, sources) =>
  createHash('sha256').update(diverseFacts(item, sources)).digest('hex');
export const loadDiverse = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, 'data/div-screening.json'), 'utf8'));
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const keys = (value, allowed) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  for (const key of Object.keys(value))
    assert.ok(allowed.includes(key), 'Unknown diverse field: ' + key);
};
export function validateDiverse(catalogs, policy) {
  keys(policy, [
    'version',
    'targetGraduationYear',
    'reviewedOn',
    'entries',
    'existingEntries',
    'excluded',
  ]);
  assert.equal(policy.version, 1);
  assert.equal(policy.targetGraduationYear, 2027);
  assert.ok(date(policy.reviewedOn));
  const catalog = catalogs.div;
  const cards = [...catalog.DATA, ...(catalog.EXTRA || [])];
  const ids = new Set(cards.map((x) => x.id));
  assert.deepEqual(
    Object.keys(policy.entries).sort(),
    [...ids].sort(),
    'Exactly one assessment per diverse card',
  );
  const pools = new Set();
  const names = new Set(
    [...catalogs.rec.DATA, ...(catalogs.rec.EXTRA || []), ...catalogs.soe.DATA].map((x) => x.name),
  );
  let positions = 0;
  let current = 0;
  for (const item of cards) {
    assert.ok(!names.has(item.name), 'Existing employer must be cross-linked, not duplicated');
    const row = policy.entries[item.id];
    keys(row, ['category', 'poolKey', 'basisHash', 'reviewedOn', 'positions']);
    assert.ok(Object.hasOwn(DIVERSE_CATEGORIES, row.category));
    assert.ok(text(row.poolKey));
    assert.ok(!pools.has(row.poolKey), 'Duplicate application pool');
    pools.add(row.poolKey);
    assert.equal(
      row.basisHash,
      diverseDigest(item, catalog.SOURCES),
      'Stale diverse evidence: ' + item.name,
    );
    assert.ok(
      date(row.reviewedOn) && row.reviewedOn <= policy.reviewedOn,
      'Assessment review date exceeds policy review',
    );
    assert.ok(Array.isArray(row.positions) && row.positions.length);
    const pids = new Set();
    for (const p of row.positions) {
      keys(p, [
        'id',
        'title',
        'recordType',
        'cities',
        'directions',
        'major',
        'cycle',
        'leadership',
        'leadershipBasis',
        'employment',
        'status',
        'deadline',
        'requirements',
        'restrictions',
        'refs',
      ]);
      assert.ok(POSITION_ID.test(p.id) && p.id.startsWith(item.id + '-') && !pids.has(p.id));
      pids.add(p.id);
      assert.ok(['position', 'direction'].includes(p.recordType), 'Unknown record type');
      assert.ok(
        text(p.title) && text(p.requirements) && text(p.restrictions) && text(p.leadershipBasis),
      );
      for (const [value, words] of [
        [p.major, DIVERSE_MAJORS],
        [p.cycle, DIVERSE_CYCLES],
        [p.leadership, DIVERSE_LEADERSHIP],
        [p.employment, DIVERSE_EMPLOYMENT],
        [p.status, DIVERSE_STATUS],
      ])
        assert.ok(Object.hasOwn(words, value), 'Unknown diverse label ' + value);
      assert.ok(
        Array.isArray(p.cities) &&
          p.cities.every(text) &&
          new Set(p.cities).size === p.cities.length,
      );
      assert.ok(
        Array.isArray(p.directions) &&
          p.directions.length &&
          new Set(p.directions).size === p.directions.length &&
          p.directions.every((x) => Object.hasOwn(DIVERSE_TRACKS, x)),
      );
      assert.ok(
        Array.isArray(p.refs) &&
          p.refs.length &&
          new Set(p.refs).size === p.refs.length &&
          p.refs.every((id) => item.audit?.refs.includes(id) && catalog.SOURCES[id]),
        'Unbound position evidence',
      );
      if (p.deadline !== null) {
        keys(p.deadline, ['date', 'time', 'scope']);
        assert.ok(date(p.deadline.date));
        assert.ok(
          p.deadline.time === null || /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(p.deadline.time),
        );
        assert.ok(text(p.deadline.scope));
      }
      // A publicly open vacancy can still be unsuitable for this user.
      // Keep window facts independent; the default leadership filter excludes it.
      positions++;
      if (p.cycle === 'current') current++;
    }
  }
  const oldIds = new Set(
    [...catalogs.rec.DATA, ...(catalogs.rec.EXTRA || []), ...catalogs.soe.DATA].map((x) => x.id),
  );
  assert.ok(Array.isArray(policy.existingEntries) && Array.isArray(policy.excluded));
  assert.equal(
    new Set(policy.existingEntries.map((x) => x.entryId)).size,
    policy.existingEntries.length,
    'Duplicate existing-entry crosslink',
  );
  for (const x of policy.existingEntries) {
    keys(x, ['entryId', 'name', 'reason']);
    assert.ok(CARD_ID.test(x.entryId) && oldIds.has(x.entryId));
    assert.ok(text(x.name) && text(x.reason));
  }
  for (const x of policy.excluded) {
    keys(x, ['name', 'reason']);
    assert.ok(text(x.name) && text(x.reason));
  }
  return {
    cards: ids.size,
    positions,
    currentPositions: current,
    existingLinks: policy.existingEntries.length,
    excluded: policy.excluded.length,
  };
}
