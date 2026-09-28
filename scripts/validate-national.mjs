import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { screeningDigest } from './validate-screening.mjs';
import { REVIEW_STATES } from '../src/national-policy.js';
import { MAJOR_LEVELS, SOE_TRACKS, CYCLES } from '../src/soe-policy.js';

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function date(value) {
  assert.ok(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    'Invalid national review/deadline date',
  );
}
function url(value) {
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === 'https:' && !parsed.username && !parsed.password,
    'Expected public HTTPS URL',
  );
}
function fields(value, allowed) {
  assert.ok(record(value), 'Expected record');
  for (const key of Object.keys(value))
    assert.ok(allowed.includes(key), 'Unknown national field: ' + key);
}
function strings(value, nonempty = false) {
  assert.ok(
    Array.isArray(value) &&
      (!nonempty || value.length) &&
      value.every(text) &&
      new Set(value).size === value.length,
    'Expected unique string list',
  );
}
export function loadNational(root) {
  return Object.fromEntries(
    ['directory', 'opportunities'].map((name) => [
      name,
      JSON.parse(fs.readFileSync(path.join(root, 'data/soe-' + name + '.json'), 'utf8')),
    ]),
  );
}
export function validateNational(catalog, directory, opportunities) {
  const cards = new Map(catalog.DATA.map((item) => [item.id, item]));
  fields(directory, ['version', 'reviewedOn', 'groups']);
  fields(opportunities, ['version', 'reviewedOn', 'entries']);
  for (const file of [directory, opportunities]) {
    assert.equal(file.version, 1);
    date(file.reviewedOn);
  }
  assert.ok(Array.isArray(directory.groups));
  const groupIds = new Set(),
    positionIds = new Set();
  for (const group of directory.groups) {
    fields(group, [
      'id',
      'name',
      'sector',
      'aliases',
      'entryIds',
      'hqEntryIds',
      'reviewState',
      'checkedOn',
      'scope',
      'nextAction',
      'sourceUrls',
    ]);
    assert.match(group.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(!groupIds.has(group.id), 'Duplicate group ID');
    groupIds.add(group.id);
    for (const key of ['name', 'sector', 'scope', 'nextAction'])
      assert.ok(text(group[key]), 'Missing group ' + key);
    for (const key of ['aliases', 'entryIds', 'hqEntryIds', 'sourceUrls']) strings(group[key]);
    assert.ok(Object.hasOwn(REVIEW_STATES, group.reviewState), 'Invalid directory review state');
    if (group.checkedOn !== null) date(group.checkedOn);
    if (group.reviewState === 'not_reviewed')
      assert.equal(group.checkedOn, null, 'Unreviewed group cannot claim a check date');
    if (['reviewed_current', 'attempted_unresolved'].includes(group.reviewState)) {
      date(group.checkedOn);
      assert.ok(group.sourceUrls.length);
    }
    if (['reviewed_current', 'covered_existing', 'historical_only'].includes(group.reviewState))
      assert.ok(group.entryIds.length, 'Coverage needs card references');
    group.entryIds.forEach((id) => assert.ok(cards.has(id), 'Unknown directory card ' + id));
    group.hqEntryIds.forEach((id) =>
      assert.ok(group.entryIds.includes(id), 'Headquarters reference outside group entries'),
    );
    group.sourceUrls.forEach(url);
  }
  assert.ok(record(opportunities.entries));
  for (const [id, row] of Object.entries(opportunities.entries)) {
    const item = cards.get(id);
    assert.ok(item, 'Unknown opportunity parent ' + id);
    fields(row, ['basisHash', 'reviewedOn', 'scope', 'positions']);
    date(row.reviewedOn);
    assert.ok(text(row.scope));
    assert.equal(
      row.basisHash,
      screeningDigest(item, catalog.SOURCES),
      'Review opportunity facts before rebinding ' + id,
    );
    assert.ok(Array.isArray(row.positions) && row.positions.length);
    for (const p of row.positions) {
      fields(p, [
        'id',
        'name',
        'employer',
        'cycle',
        'type',
        'status',
        'major',
        'directions',
        'locations',
        'requirements',
        'due',
        'dueTime',
        'deadlineScope',
        'refs',
        'url',
        'applicationLimit',
        'risks',
      ]);
      assert.ok(
        typeof p.id === 'string' &&
          p.id.startsWith(id + '-') &&
          /^[a-zA-Z0-9-]+$/.test(p.id) &&
          !positionIds.has(p.id),
        'Invalid or duplicate position ID',
      );
      positionIds.add(p.id);
      for (const key of [
        'name',
        'employer',
        'requirements',
        'deadlineScope',
        'applicationLimit',
        'risks',
      ])
        assert.ok(text(p[key]), 'Missing position ' + key);
      assert.ok(Object.hasOwn(CYCLES, p.cycle));
      assert.ok(Object.hasOwn(MAJOR_LEVELS, p.major));
      assert.ok(['campus', 'internship'].includes(p.type));
      assert.ok(['open', 'verify', 'watch', 'past'].includes(p.status));
      strings(p.directions, true);
      p.directions.forEach((value) => assert.ok(Object.hasOwn(SOE_TRACKS, value)));
      strings(p.locations);
      strings(p.refs, true);
      p.refs.forEach((ref) =>
        assert.ok(
          catalog.SOURCES[ref] && item.audit?.refs?.includes(ref),
          'Position source must be visible on parent card',
        ),
      );
      url(p.url);
      if (p.due !== null) date(p.due);
      assert.ok(
        p.dueTime === null ||
          (p.due &&
            (p.dueTime === '24:00' || /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(p.dueTime))),
        'Invalid position clock time',
      );
      if (p.cycle === 'historical')
        assert.ok(
          ['past', 'watch', 'verify'].includes(p.status),
          'Historical position cannot be open',
        );
    }
  }
  return {
    groups: groupIds.size,
    parents: Object.keys(opportunities.entries).length,
    positions: positionIds.size,
  };
}
