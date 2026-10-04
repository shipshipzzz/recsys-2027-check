import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createOpportunityLookup,
  noticeDeadline,
  noticeActionable,
} from '../src/national-policy.js';
import { hasMajorEvidence } from '../src/soe-policy.js';
const read = (path) => JSON.parse(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const catalog = read('data/soe.json'),
  rec = read('data/rec.json');
const screening = read('data/soe-screening.json'),
  locations = read('data/soe-locations.json');
const opportunities = read('data/soe-opportunities.json');
const coverage = read('docs/recruitment-coverage-2026-10-04.json');
const snapshots = read('docs/recruitment-snapshots-2026-10-04.json');
const find = (part) => catalog.DATA.find((item) => item.name.includes(part));
const now = new Date('2026-10-04T12:00:00+08:00');

test('October review coverage accounts for all cards without backdating unreviewed entries', () => {
  const all = [...rec.DATA, ...rec.EXTRA, ...catalog.DATA];
  assert.equal(all.length, 148);
  assert.equal(coverage.entries.length, all.length);
  assert.equal(new Set(coverage.entries.map((row) => row.id)).size, all.length);
  assert.equal(coverage.entries.filter((row) => row.status === 'reviewed_scoped').length, 10);
  assert.equal(coverage.entries.filter((row) => row.status === 'not_reviewed').length, 138);
  for (const row of coverage.entries) {
    const item = all.find((item) => item.id === row.id);
    assert.ok(item);
    if (row.status === 'not_reviewed') {
      assert.equal(row.checkedOn, null);
      assert.notEqual(item.rev, coverage.reviewedOn);
    } else {
      assert.equal(item.rev, coverage.reviewedOn);
      assert.equal(item.audit.checked, coverage.reviewedOn);
      assert.ok(row.sourceIds.length);
      for (const ref of row.sourceIds) assert.ok(catalog.SOURCES[ref]);
    }
  }
  assert.equal(
    coverage.sources.filter((row) => row.status === 'unresolved_empty_detail').length,
    1,
  );
});
test('October before-images preserve existing identities, evidence links and position history', () => {
  assert.equal(snapshots.records.length, 10);
  for (const before of snapshots.records) {
    const item = catalog.DATA.find((item) => item.id === before.id);
    assert.ok(item);
    for (const ref of before.card.audit.refs) assert.ok(item.audit.refs.includes(ref));
    for (const position of before.opportunities?.positions || []) {
      const current = opportunities.entries[item.id].positions.find(
        (row) => row.id === position.id,
      );
      assert.equal(current.name, position.name);
      for (const ref of position.refs) assert.ok(current.refs.includes(ref));
    }
  }
});
test('Hangzhou expired explicit-statistics evidence is not promoted onto new AI or FX jobs', () => {
  const item = find('杭州银行'),
    assessment = screening.entries[item.id];
  const row = createOpportunityLookup(opportunities, catalog, screening)(item, catalog.SOURCES);
  assert.equal(row.positions.length, 4);
  assert.equal(row.positions[0].status, 'past');
  assert.equal(row.positions[0].major, 'explicit');
  assert.equal(assessment.major, 'statistics');
  assert.equal(noticeDeadline(item, assessment, row, catalog.SOURCES, now).date, '2026-10-25');
  assert.equal(noticeActionable(item, assessment, row, now), true);
  for (const position of row.positions.slice(2)) {
    assert.equal(position.major, 'related');
    assert.equal(hasMajorEvidence(position), false);
    assert.equal(position.dueTime, null);
    assert.deepEqual(position.locations, ['杭州']);
  }
  assert.ok(
    !locations.entries[item.id].locations.some((place) => place.refs.includes('N0928-B02')),
  );
});
test('new banking positions keep qualification, city evidence and shared application limits separate', () => {
  const cdb = find('国家开发银行'),
    psbc = find('中国邮政储蓄银行');
  const cdbPosition = opportunities.entries[cdb.id].positions[0];
  assert.deepEqual(cdbPosition.locations, ['北京']);
  assert.equal(cdbPosition.major, 'statistics');
  assert.match(cdbPosition.applicationLimit, /1—2家单位/);
  for (const position of opportunities.entries[psbc.id].positions) {
    assert.equal(position.major, 'related');
    assert.deepEqual(position.locations, []);
    assert.equal(position.due, '2026-10-07');
    assert.equal(position.dueTime, '24:00');
    assert.match(position.applicationLimit, /合计任意2岗/);
  }
});
test('October source scopes retain exact bank times, special technology requirements and expired windows', () => {
  const spdb = find('浦发银行总行'),
    ccb = find('建信金融科技'),
    cq = find('三峡融资担保');
  assert.equal(spdb.dueTime, '18:00');
  assert.equal(ccb.dueTime, '24:00');
  assert.equal(opportunities.entries[spdb.id].positions[0].major, 'unrestricted');
  assert.equal(opportunities.entries[spdb.id].positions[1].major, 'related');
  assert.equal(locations.entries[ccb.id].locations.length, 7);
  for (const city of ['杭州', '重庆', '西安'])
    assert.equal(
      locations.entries[ccb.id].locations.some((place) => place.city === city),
      false,
    );
  assert.equal(cq.status, 'past');
  assert.equal(cq.dueTime, null);
  assert.equal(noticeActionable(cq, screening.entries[cq.id], {}, now), false);
});
