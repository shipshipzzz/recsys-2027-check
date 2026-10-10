import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { screeningDigest } from '../scripts/validate-screening.mjs';
import { locationDigest } from '../scripts/validate-locations.mjs';
const json = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const rec = json('../data/rec.json');
const soe = json('../data/soe.json');
const screening = json('../data/soe-screening.json');
const geography = json('../data/soe-locations.json');
const opportunities = json('../data/soe-opportunities.json');
const audit = json('../docs/deadline-review-2026-10-07.json');
const snapshots = json('../docs/deadline-snapshots-2026-10-07.json');
const cards = new Map([...rec.DATA, ...rec.EXTRA, ...soe.DATA].map((x) => [x.id, x]));

test('October deadline review accounts for every old card without claiming a full fresh review', () => {
  // This immutable report covers the 148 entries present on October 7, not future additions.
  assert.equal(audit.coverage.length, 148);
  assert.equal(new Set(audit.coverage.map((x) => x.id)).size, 148);
  assert.ok(cards.size >= audit.coverage.length);
  for (const row of audit.coverage) {
    assert.ok(cards.has(row.id));
    assert.equal(row.eligibilityRevalidated, false);
    assert.equal(row.locationRevalidated, false);
    if (row.outcome === 'not_rechecked') assert.equal(row.checkedOn, null);
    else assert.equal(row.checkedOn, '2026-10-07');
  }
  assert.equal(audit.counts.changedCards, snapshots.cards.length);
  assert.equal(audit.counts.sourceRecords, audit.evidence.length);
  for (const [outcome, count] of Object.entries(audit.counts)) {
    if (['cards', 'changedCards', 'sourceRecords'].includes(outcome)) continue;
    assert.equal(count, audit.coverage.filter((x) => x.outcome === outcome).length);
  }
});

test('Deadline-only changes preserve qualifications, locations, status and their old evidence dates', () => {
  const immutable = [
    'id',
    'name',
    'en',
    'status',
    'city',
    'jobs',
    'req',
    'window',
    'ownership',
    'fit',
    'tier',
    'track',
    'priority',
    'rec',
    'xian',
  ];
  for (const saved of snapshots.cards) {
    const now = cards.get(saved.id);
    for (const field of immutable)
      assert.deepEqual(now[field], saved.before[field], saved.id + ':' + field);
    for (const ref of saved.before.audit?.refs || []) assert.ok(now.audit.refs.includes(ref));
    assert.match(now.audit.scope, /只复核/);
    assert.match(now.audit.scope, /不代表/);
    if (saved.screen) {
      const { basisHash: _oldHash, ...before } = saved.screen;
      const { basisHash, ...after } = screening.entries[saved.id];
      assert.deepEqual(after, before);
      assert.equal(basisHash, screeningDigest(now, soe.SOURCES));
    }
    if (saved.location) {
      const { basisHash: _oldHash, ...before } = saved.location;
      const { basisHash, ...after } = geography.entries[saved.id];
      assert.deepEqual(after, before);
      assert.equal(basisHash, locationDigest(now, soe.SOURCES));
    }
  }
});

test('Missing dates gain the correct scope without fabricated clock times', () => {
  for (const [id, due] of [
    ['soe-6f3da4b7ad2476020757', '2026-10-10'],
    ['soe-53b939996659dfde59e5', '2026-10-10'],
    ['soe-1d81f573583960b2ca09', '2026-10-25'],
    ['soe-87ef8e3ebe4b4b4bb9fc', '2026-10-15'],
    ['soe-00f5a7bf22c3ecff3eff', '2026-10-15'],
    ['soe-95134bdc75c0737d281e', '2026-10-08'],
  ]) {
    assert.equal(cards.get(id).due, due);
    assert.equal(cards.get(id).dueTime, null);
    assert.ok(cards.get(id).dueScope.length > 15);
  }
  assert.match(cards.get('soe-53b939996659dfde59e5').dueScope, /仅.*授信.*智能科学.*系统研发/);
  assert.match(cards.get('soe-00f5a7bf22c3ecff3eff').dueScope, /不采用.*过期/);
  assert.equal(cards.get('soe-57a02b3fc6410f063563').due, null);
});

test('Secondary deadline evidence is never relabelled as an official JD', () => {
  const sinopec = cards.get('soe-863efd948d7f8d33bfdb');
  assert.equal(sinopec.due, '2026-10-28');
  assert.equal(sinopec.dueTime, '17:00');
  assert.match(sinopec.dueScope, /转载/);
  assert.equal(soe.SOURCES['D1007-S08'].level, '公告转载');
  assert.equal(soe.SOURCES['D1007-S11'].level, '公告转载');
  assert.match(cards.get('soe-95134bdc75c0737d281e').dueScope, /转载.*未读成/);
  assert.equal(sinopec.status, 'verify');
  assert.equal(screening.entries[sinopec.id].major, 'unknown');
});

test('Regular MiHoYo and Shopee deadlines are structured without overwriting early batch history', () => {
  assert.equal(rec.REC_DEADLINES['米哈游'].date, '2026-10-31');
  assert.equal(rec.REC_DEADLINES['米哈游'].time, null);
  assert.equal(rec.REC_DEADLINES['Shopee'].date, '2026-11-30');
  assert.equal(rec.REC_DEADLINES['Shopee'].time, null);
  assert.match(rec.REC_DEADLINES['米哈游'].scope, /正式批/);
  assert.match(rec.REC_DEADLINES['Shopee'].scope, /不代替AI Star/);
  assert.match(
    snapshots.cards.find((x) => x.id === 'rec-7b0537129aa42ab55ff5').before.closes,
    /24:00/,
  );
  assert.deepEqual(rec.REC_DEADLINES.vivo, snapshots.recDeadlinesBefore.vivo);
  assert.deepEqual(rec.REC_DEADLINES['货拉拉'], snapshots.recDeadlinesBefore['货拉拉']);
});

test('Guangfa remains one card with two shared-quota schedule nodes and no global deadline', () => {
  const id = 'soe-e43cb34e4c801cf57150';
  const row = opportunities.entries[id];
  assert.equal(cards.get(id).due, null);
  assert.equal(row.positions.length, 2);
  assert.deepEqual(
    row.positions.map((x) => x.due),
    ['2026-10-15', '2026-11-15'],
  );
  for (const p of row.positions) {
    assert.equal(p.major, 'related');
    assert.equal(p.status, 'verify');
    assert.match(p.applicationLimit, /3个平行志愿/);
    assert.equal(p.dueTime, null);
  }
  assert.match(row.positions[1].deadlineScope, /信用卡.*理财.*不自动/);
  assert.equal(row.basisHash, screeningDigest(cards.get(id), soe.SOURCES));
});

test('Old child position IDs and qualifications survive the deadline refresh', () => {
  for (const saved of snapshots.cards.filter((x) => x.opportunities)) {
    const row = opportunities.entries[saved.id];
    assert.equal(row.basisHash, screeningDigest(cards.get(saved.id), soe.SOURCES));
    for (const before of saved.opportunities.positions) {
      const after = row.positions.find((x) => x.id === before.id);
      assert.ok(after, before.id);
      for (const field of [
        'name',
        'employer',
        'cycle',
        'type',
        'status',
        'major',
        'directions',
        'locations',
        'requirements',
      ]) {
        assert.deepEqual(after[field], before[field], before.id + ':' + field);
      }
      for (const ref of before.refs) assert.ok(after.refs.includes(ref));
    }
  }
  for (const id of [
    'soe-1d81f573583960b2ca09',
    'soe-87ef8e3ebe4b4b4bb9fc',
    'soe-00f5a7bf22c3ecff3eff',
  ]) {
    for (const position of opportunities.entries[id].positions) {
      assert.equal(position.due, cards.get(id).due);
      assert.equal(position.dueTime, null);
    }
  }
});

test('Published research sources contain no browser-session identifiers', () => {
  for (const evidence of audit.evidence) {
    assert.ok(evidence.scope.length > 20);
    assert.ok(evidence.level);
    assert.doesNotMatch(evidence.url, /jsessionid|access_token|refresh_token|password=/i);
    assert.equal(new URL(evidence.url).username, '');
  }
});
