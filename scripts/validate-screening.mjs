import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  POLICY_VERSION,
  SOE_TRACKS,
  MAJOR_LEVELS,
  CYCLES,
  assessmentFacts,
} from '../src/soe-policy.js';

export const screeningDigest = (item, sources) =>
  createHash('sha256').update(assessmentFacts(item, sources)).digest('hex');
export function loadScreening(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data/soe-screening.json'), 'utf8'));
}
export function validateScreening(catalog, policy) {
  assert.equal(policy.version, 1, 'Unsupported screening format');
  assert.equal(policy.policyVersion, POLICY_VERSION, 'Screening policy version mismatch');
  assert.equal(policy.targetGraduationYear, 2027, 'Screening target cohort mismatch');
  assert.ok(
    policy.entries && typeof policy.entries === 'object' && !Array.isArray(policy.entries),
    'Missing assessments',
  );
  const ids = new Set(catalog.DATA.map((item) => item.id));
  assert.equal(
    Object.keys(policy.entries).length,
    ids.size,
    'Every SOE card needs one assessment; do not pad with orphan rows',
  );
  for (const id of Object.keys(policy.entries)) assert.ok(ids.has(id), 'Orphan assessment ' + id);
  for (const item of catalog.DATA) {
    const row = policy.entries[item.id];
    assert.ok(row, 'Missing screening for ' + item.name);
    const allowed = [
      'major',
      'cycle',
      'intake',
      'directions',
      'basis',
      'qualityBasis',
      'evidenceRefs',
      'reviewedOn',
      'basisHash',
    ];
    for (const key of Object.keys(row))
      assert.ok(allowed.includes(key), 'Unknown screening field ' + key);
    assert.ok(Object.hasOwn(MAJOR_LEVELS, row.major), 'Invalid major level');
    assert.ok(Object.hasOwn(CYCLES, row.cycle), 'Invalid recruitment cycle');
    assert.ok(
      Array.isArray(row.directions) &&
        row.directions.length > 0 &&
        new Set(row.directions).size === row.directions.length,
      'Invalid directions',
    );
    for (const track of row.directions)
      assert.ok(Object.hasOwn(SOE_TRACKS, track), 'Unknown track ' + track);
    assert.ok(row.directions.includes(item.track), 'Main track must appear among directions');
    for (const key of ['basis', 'qualityBasis'])
      assert.ok(
        typeof row[key] === 'string' && row[key].trim().length >= 12,
        'Missing substantive ' + key + ' for ' + item.name,
      );
    assert.ok(
      typeof item.req === 'string' && item.req.trim(),
      'Missing visible eligibility conditions',
    );
    assert.ok(
      /^\d{4}-\d{2}-\d{2}$/.test(row.reviewedOn) &&
        new Date(row.reviewedOn).toISOString().slice(0, 10) === row.reviewedOn,
      'Invalid review date',
    );
    assert.ok(
      Array.isArray(row.evidenceRefs) && row.evidenceRefs.length,
      'Missing evidence references',
    );
    for (const ref of row.evidenceRefs) {
      assert.ok(catalog.SOURCES[ref], 'Missing source ' + ref);
      assert.ok(item.audit?.refs?.includes(ref), 'Screening evidence must be visible on its card');
    }
    if (row.cycle === 'current') {
      assert.equal(row.intake, 2027, 'Current label must refer to target cohort');
      assert.ok(item.audit?.checked, 'Current label needs a dated evidence audit');
      assert.ok(
        row.evidenceRefs.some((ref) => catalog.SOURCES[ref]?.url),
        'Current label needs a public source',
      );
    } else if (row.cycle === 'historical') {
      assert.ok(
        Number.isInteger(row.intake) && row.intake < 2027,
        'Historical evidence needs its real cohort',
      );
      assert.ok(
        ['watch', 'past', 'verify'].includes(item.status),
        'Historical evidence cannot be marked open',
      );
      assert.ok(!item.due && !item.start, 'Do not reuse historical dates as this cycle deadlines');
    } else assert.ok(row.intake === null || Number.isInteger(row.intake), 'Invalid intake');
    if (row.major === 'explicit')
      assert.match(item.req, /应用统计/, 'Explicit evidence must be visible');
    if (row.major === 'unrestricted')
      assert.match(item.req, /不限专业|专业不限/, 'Unrestricted scope must be explicit');
    assert.equal(
      row.basisHash,
      screeningDigest(item, catalog.SOURCES),
      'Recruitment facts changed; review and rebind screening for ' + item.name,
    );
  }
  return {
    cards: ids.size,
    current: Object.values(policy.entries).filter((row) => row.cycle === 'current').length,
    historical: Object.values(policy.entries).filter((row) => row.cycle === 'historical').length,
  };
}
