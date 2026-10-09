import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadCatalogs, normalizeCatalogs, ROOT } from './catalog-data.mjs';

// Explicit external dev-only module. This script never connects to a network or Supabase.
const modulePath = process.argv[2];
if (!modulePath || !path.isAbsolute(modulePath) || !fs.existsSync(modulePath))
  throw new Error('Pass an absolute local PGlite module path. See docs/diverse-engineering.md.');
const version = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(modulePath), '../package.json'), 'utf8'),
).version;
assert.equal(version, '0.3.14', 'Database test runtime must use the documented pinned version');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const passed = [];
const mark = (name) => {
  passed.push(name);
  console.log('PASS:', name);
};
const read = (name) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8');
const source = loadCatalogs();
const legacy = normalizeCatalogs({ rec: source.rec, soe: source.soe }, { legacy: true });
const current = normalizeCatalogs(source);
const rpc = (catalog, run, dry = false, revision = 'a'.repeat(40)) =>
  db.query('select public.recsys_apply_catalog($1::jsonb,$2,$3::bigint,$4::boolean) as receipt', [
    JSON.stringify(catalog),
    revision,
    run,
    dry,
  ]);
const privateSnapshot = async () =>
  (
    await db.query(
      "select md5(coalesce((select jsonb_agg(to_jsonb(t) order by user_id,entry_id)::text from public.user_card_states t),'[]')) as cards, md5(coalesce((select jsonb_agg(to_jsonb(t) order by user_id,id)::text from public.user_timeline_events t),'[]')) as timeline, md5(coalesce((select jsonb_agg(to_jsonb(t) order by id)::text from auth.users t),'[]')) as users",
    )
  ).rows[0];
const publicSnapshot = async () =>
  (
    await db.query(
      'select md5((select jsonb_agg(to_jsonb(t) order by id)::text from public.job_entries t)) as entries, md5((select jsonb_agg(to_jsonb(t) order by id)::text from public.companies t)) as companies, (select count(*)::int from recsys_sync.releases) as releases',
    )
  ).rows[0];
try {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;",
  );
  for (const name of [
    '202609120001_recsys.sql',
    '202609130003_catalog_sync.sql',
    '202609140004_user_timeline_events.sql',
  ])
    await db.exec(read(name));
  await rpc(legacy, 1);
  const owner = '00000000-0000-4000-8000-000000000001',
    other = '00000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query(
    "insert into public.user_card_states(user_id,entry_id,status) values($1,$2,'applied')",
    [owner, source.rec.DATA[0].id],
  );
  await db.query(
    "insert into public.user_timeline_events(user_id,id,entry_id,title,event_type,starts_at,mutation_id) values($1,'00000000-0000-4000-8000-000000000010',$2,'Isolated test only','interview','2026-10-11T02:00:00Z','00000000-0000-4000-8000-000000000011')",
    [owner, source.soe.DATA[0].id],
  );
  const privateBefore = await privateSnapshot(),
    publicBefore = await publicSnapshot();
  const migration = read('202610100005_diverse_catalog.sql');
  await db.exec(migration);
  assert.deepEqual(await privateSnapshot(), privateBefore);
  assert.deepEqual(await publicSnapshot(), publicBefore);
  mark('additive migration preserves Auth, private state, agenda and every legacy public row');
  const constraints = await db.query(
    "select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conname in ('job_entries_kind_check','catalog_archives_kind_check','timeline_events_kind_check','change_logs_kind_check')",
  );
  assert.equal(constraints.rows.length, 4);
  assert.ok(constraints.rows.every((x) => x.definition.includes('div')));
  mark('all four database constraints allow the third kind');
  await rpc(legacy, 2, true);
  await rpc(legacy, 2);
  assert.deepEqual(await privateSnapshot(), privateBefore);
  mark('the currently deployed two-page release remains publishable after schema upgrade');
  const invalid = structuredClone(current);
  invalid.catalog_archives = invalid.catalog_archives.filter((x) => x.kind !== 'div');
  await assert.rejects(() => rpc(invalid, 3, true), /Archive and catalog kinds/);
  mark('dry-run rejects missing third archive');
  const badKind = structuredClone(current);
  badKind.job_entries.find((x) => x.kind === 'div').kind = 'bad';
  await assert.rejects(() => rpc(badKind, 3, true), /identity|archive|kind/i);
  mark('unregistered kinds and forged identity cannot enter the public catalog');
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(() => rpc(legacy, 3, true), /permission denied/);
    if (role === 'anon')
      await assert.rejects(
        () => db.query('select * from public.user_card_states'),
        /permission denied/,
      );
    await db.exec('reset role');
  }
  mark('anonymous and authenticated users cannot call the privileged catalog RPC');
  await db.exec('set role service_role');
  await rpc(current, 3, true);
  const applied = await rpc(current, 3);
  await db.exec('reset role');
  mark('the actual service_role publisher can read and write the three-page catalog');
  assert.equal(applied.rows[0].receipt.verified_in_transaction, true);
  assert.deepEqual(await privateSnapshot(), privateBefore);
  mark('three-page publication is atomic and leaves private data unchanged');
  const repeated = await rpc(current, 3);
  assert.equal(repeated.rows[0].receipt.replayed, true);
  mark('same release replay is idempotent');
  await assert.rejects(() => rpc(current, 2), /Stale/);
  await assert.rejects(() => rpc(legacy, 4, true), /removal|ID change/);
  mark('stale release and old two-page replacement cannot remove published div cards');
  const beforeBad = await publicSnapshot();
  const bad = structuredClone(current);
  bad.companies[0].name += ' late rollback test';
  bad.entry_links[0].url = 'javascript:alert(1)';
  await assert.rejects(() => rpc(bad, 4), /check constraint/);
  assert.deepEqual(await publicSnapshot(), beforeBad);
  mark('late constraint failure rolls back prior writes and release history');
  const newId = source.div.DATA[0].id;
  await db.exec("set role authenticated; set request.jwt.claim.sub='" + owner + "';");
  await db.query(
    "insert into public.user_card_states(user_id,entry_id,status) values($1,$2,'applied')",
    [owner, newId],
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into public.user_card_states(user_id,entry_id,status) values($1,$2,'applied')",
        [other, newId],
      ),
    /row-level security/,
  );
  await db.query(
    "insert into public.user_timeline_events(user_id,id,entry_id,title,event_type,starts_at,mutation_id) values($1,'00000000-0000-4000-8000-000000000012',$2,'New isolated event','assessment','2026-10-12T02:00:00Z','00000000-0000-4000-8000-000000000013')",
    [owner, newId],
  );
  await db.exec("set request.jwt.claim.sub='" + other + "';");
  assert.equal((await db.query('select * from public.user_card_states')).rows.length, 0);
  assert.equal((await db.query('select * from public.user_timeline_events')).rows.length, 0);
  await db.exec('reset role');
  mark('new card state and agenda FKs work; owner RLS still isolates accounts');
  const afterNew = await privateSnapshot();
  await db.exec(migration);
  assert.deepEqual(await privateSnapshot(), afterNew);
  mark('schema migration can be reapplied without changing user records');
  const report = {
    engine: 'PGlite 0.3.14 / isolated PostgreSQL WASM',
    networkUsed: false,
    productionWrites: false,
    passed: passed.length,
    checks: passed,
    legacyCards: legacy.job_entries.length,
    newTotalCards: current.job_entries.length,
    migration: '202610100005_diverse_catalog.sql',
  };
  fs.mkdirSync(path.join(ROOT, 'test-results/diverse'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'test-results/diverse/database-isolated.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} finally {
  await db.close();
}
