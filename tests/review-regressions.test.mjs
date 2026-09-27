import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationLookup, locationBonus } from '../src/location-policy.js';

function fixture() {
  const item = {
    id: 'soe-1234567890abcdef1234',
    name: 'Geography regression fixture',
    city: '杭州',
    jobs: '统计分析',
    req: '应用统计',
    status: 'open',
    audit: { checked: '2026-09-28', refs: ['T01'] },
  };
  const sources = {
    T01: { url: 'https://example.com/job', checked: '2026-09-28', scope: '杭州统计岗' },
  };
  const policy = {
    entries: {
      [item.id]: {
        current: true,
        locations: [{ city: '杭州', province: '浙江', level: 'position', directions: ['stats'] }],
      },
    },
  };
  return {
    item,
    sources,
    lookup: createLocationLookup(policy, { DATA: [item], SOURCES: sources }),
  };
}

test('geography: mutating a previously cached job revokes its positive location assessment', () => {
  const { item, sources, lookup } = fixture();
  assert.equal(locationBonus(lookup(item, sources)), 8);
  item.city = '北京';
  assert.equal(lookup(item, sources).matched, false);
  assert.equal(locationBonus(lookup(item, sources)), 0);
});

test('geography: changing source evidence in place invalidates the cached location verdict', () => {
  const { item, sources, lookup } = fixture();
  assert.equal(lookup(item, sources).matched, true);
  sources.T01.scope = '仅总部在杭州；岗位工作地待核';
  assert.equal(lookup(item, sources).matched, false);
});

test('geography: unchanged facts reuse the cached assessment', () => {
  const { item, sources, lookup } = fixture();
  const first = lookup(item, sources);
  assert.equal(lookup(item, sources), first);
});
