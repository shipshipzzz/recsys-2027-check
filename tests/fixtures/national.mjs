// Synthetic evidence for isolated tests only; never written to maintenance data.
import fs from 'node:fs';
import { screeningDigest } from '../../scripts/validate-screening.mjs';
export function nationalFixture() {
  const catalog = JSON.parse(
    fs.readFileSync(new URL('../../data/soe.json', import.meta.url), 'utf8'),
  );
  const template = catalog.DATA[0];
  const names = [
    '测试杭州银行',
    '中国石油（测试）',
    '中国银行（测试）',
    '中国工商银行（测试）',
    '中国农业银行（测试）',
    '待核地点测试',
    '已核上海测试',
    '临期待核测试',
  ];
  catalog.RECHECKED = '2026-09-28';
  catalog.SOURCES.TEST = {
    url: 'https://example.com/recruitment',
    checked: '2026-09-27',
    title: 'Synthetic test source',
    scope: 'Test positions',
    level: 'official',
  };
  catalog.DATA = names.map((name, i) => ({
    ...structuredClone(template),
    id: 'soe-' + (i + 1).toString(16).padStart(20, '0'),
    name,
    en: 'Test fixture',
    status: 'open',
    city: '待核',
    due: '2026-09-30',
    dueTime: null,
    dueScope: '测试岗位',
    start: null,
    track: 'stats',
    req: '应用统计；其他条件另核',
    audit: { checked: '2026-09-27', refs: ['TEST'] },
  }));
  const screening = {
    version: 1,
    entries: Object.fromEntries(
      catalog.DATA.map((item, i) => [
        item.id,
        {
          basisHash: screeningDigest(item, catalog.SOURCES),
          cycle: i === 7 ? 'unverified' : 'current',
          major: 'explicit',
          directions: ['stats'],
          basis: 'Test evidence',
          qualityBasis: 'Test quality',
          matched: true,
        },
      ]),
    ),
  };
  const [bank, oil, boc, icbc, abc, unknown, shanghai, pending] = catalog.DATA;
  const group = (id, name, aliases, entryIds, hqEntryIds = []) => ({
    id,
    name,
    sector: '测试',
    aliases,
    entryIds,
    hqEntryIds,
    reviewState: 'covered_existing',
    checkedOn: '2026-09-28',
    scope: '测试子集，非全量',
    nextAction: '核对下属机构',
    sourceUrls: ['https://example.com'],
  });
  const directory = {
    version: 1,
    reviewedOn: '2026-09-28',
    groups: [
      group('cnpc', '中国石油', ['中石油', 'CNPC', '三桶油'], [oil.id]),
      group('boc', '中国银行', ['中行', '四大行'], [boc.id], [boc.id]),
      group('icbc', '中国工商银行', ['工行', '四大行'], [icbc.id], [icbc.id]),
      group('abc', '中国农业银行', ['农行', '四大行'], [abc.id], [abc.id]),
      {
        ...group('unreviewed', '未检查测试集团', [], []),
        reviewState: 'not_reviewed',
        checkedOn: null,
      },
    ],
  };
  const positions = ['数据研发', '总行培训生'].map((name, i) => ({
    id: bank.id + '-p0' + (i + 1),
    name,
    employer: '测试杭州银行',
    cycle: 'current',
    type: 'campus',
    status: 'open',
    major: 'explicit',
    directions: ['stats'],
    locations: ['杭州'],
    requirements: '应用统计，其他资格独立核验',
    due: i === 0 ? '2026-09-30' : '2026-10-25',
    dueTime: null,
    deadlineScope: '本岗位',
    refs: ['TEST'],
    url: 'https://example.com/position',
    applicationLimit: '未核',
    risks: '测试子集',
  }));
  const opportunities = {
    version: 1,
    reviewedOn: '2026-09-28',
    entries: {
      [bank.id]: {
        basisHash: screening.entries[bank.id].basisHash,
        reviewedOn: '2026-09-28',
        scope: '已核岗位子集，非全量',
        positions,
      },
    },
  };
  const place = (city) => ({
    city,
    province: city === '杭州' ? '浙江' : '上海',
    level: 'position',
    directions: ['stats'],
    refs: ['TEST'],
    scope: '测试岗位',
  });
  const locations = {
    version: 1,
    entries: {
      [bank.id]: { current: true, locations: [place('杭州')] },
      [shanghai.id]: { current: true, locations: [place('上海')] },
    },
  };
  return {
    catalog,
    screening,
    directory,
    opportunities,
    locations,
    bank,
    oil,
    boc,
    icbc,
    abc,
    unknown,
    shanghai,
    pending,
    positions,
  };
}
