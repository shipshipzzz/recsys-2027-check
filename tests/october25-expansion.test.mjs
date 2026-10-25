import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCatalogs } from '../scripts/catalog-data.mjs';

const json = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const ledger = json('docs/recruitment-expansion-2026-10-25.json');
const snapshot = json('docs/deadline-snapshots-2026-10-25.json');
const catalogs = loadCatalogs();
const all = (d) => [...d.DATA, ...(d.EXTRA || [])];
const byId = new Map(
  ['rec', 'soe', 'div'].flatMap((k) => all(catalogs[k]).map((x) => [k + ':' + x.id, x])),
);

test('october25: ledger accounts for every card it claims, with per-kind counts intact', () => {
  assert.equal(ledger.version, 1);
  assert.equal(ledger.reviewedOn, '2026-10-25');
  assert.equal(ledger.baseline, snapshot.baseCommit);
  assert.equal(ledger.counts.newCards, ledger.cards.length);
  assert.equal(new Set(ledger.cards.map((x) => x.id)).size, ledger.cards.length);
  assert.equal(ledger.counts.modifiedCards, snapshot.cards.length);
  const byKind = {};
  for (const c of ledger.cards) {
    assert.ok(byId.has(c.kind + ':' + c.id), c.name);
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  }
  assert.deepEqual(byKind, ledger.counts.byKind);
});

test('october25: every new card is dated this round and never hard-requires student leadership', () => {
  for (const c of ledger.cards) {
    const item = byId.get(c.kind + ':' + c.id);
    assert.equal(item.audit.checked, '2026-10-25', c.name);
    assert.ok(item.audit.refs.length > 0, c.name);
    if (item.positions)
      for (const p of item.positions) assert.notEqual(p.leadership, 'required', c.name);
  }
});

test('october25: the modified card keeps its before-image honest (易方达基金 verify -> past)', () => {
  assert.equal(ledger.baseline, snapshot.baseCommit);
  assert.deepEqual(
    snapshot.cards.map((x) => x.id),
    ['div-361f32b3645bd85e7809'],
  );
  const before = snapshot.cards[0].before;
  assert.equal(before.status, 'verify');
  assert.equal(before.audit.checked, '2026-10-10');
  const item = all(catalogs.div).find((x) => x.id === 'div-361f32b3645bd85e7809');
  assert.equal(item.status, 'past');
  assert.equal(item.audit.checked, '2026-10-25');
  assert.match(item.audit.summary, /2026-10-11/);
});
