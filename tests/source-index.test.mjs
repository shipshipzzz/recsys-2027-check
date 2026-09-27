import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sourceIdsForPage } from '../src/shared/source-index.js';

test('source index includes dated card, deadline and timeline references in source order', () => {
  const catalog = {
    PAGE_KIND: 'rec',
    SOURCES: {
      R01: {},
      H01: {},
      S01: {},
      H02: {},
      'U0916-R01': {},
      'U0927-R01': {},
      deadline: {},
      timeline: {},
      unused: {},
    },
    DATA: [{ audit: { refs: ['U0916-R01'] } }],
    EXTRA: [{ audit: { refs: ['U0927-R01'] } }],
    REC_DEADLINES: { absent: null, current: { refs: ['deadline'] } },
    TIMELINE_EVENTS: [{ refs: ['timeline'] }],
  };
  assert.deepEqual(sourceIdsForPage(catalog), [
    'R01',
    'H01',
    'U0916-R01',
    'U0927-R01',
    'deadline',
    'timeline',
  ]);
});
test('SOE source index preserves legacy sources without importing unrelated REC sources', () => {
  assert.deepEqual(
    sourceIdsForPage({
      PAGE_KIND: 'soe',
      SOURCES: { R01: {}, H01: {}, S01: {}, H02: {}, 'U0927-S01': {} },
      ALL_ITEMS: [{ audit: { refs: ['U0927-S01', 'missing'] } }],
    }),
    ['S01', 'H02', 'U0927-S01'],
  );
});
for (const kind of ['rec', 'soe']) {
  test(kind + ': all saved card and timeline citations resolve to an indexed source', () => {
    const catalog = JSON.parse(
      fs.readFileSync(new URL('../data/' + kind + '.json', import.meta.url), 'utf8'),
    );
    const indexed = new Set(sourceIdsForPage(catalog));
    const refs = [...catalog.DATA, ...(catalog.EXTRA || [])].flatMap(
      (item) => item.audit?.refs || [],
    );
    refs.push(...Object.values(catalog.REC_DEADLINES || {}).flatMap((event) => event?.refs || []));
    refs.push(...(catalog.TIMELINE_EVENTS || []).flatMap((event) => event.refs || []));
    for (const id of refs) assert.ok(indexed.has(id), id);
  });
}
