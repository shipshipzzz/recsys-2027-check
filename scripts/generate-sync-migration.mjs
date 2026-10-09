import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TABLE_NAMES, PRIMARY_KEYS, COLUMNS } from './catalog-data.mjs';

// Historic migrations remain immutable. Derive an additive upgrade from the installed RPC.
export const MIGRATION = '202610100005_diverse_catalog.sql';
export function renderDiverseMigration() {
  const previous = fs
    .readFileSync(path.join(ROOT, 'supabase/migrations/202609130003_catalog_sync.sql'), 'utf8')
    .replaceAll('\r\n', '\n');
  let rpc = previous.slice(
    previous.indexOf('create or replace function public.recsys_apply_catalog('),
    previous.indexOf('notify pgrst,'),
  );
  const specs = Object.fromEntries(
    TABLE_NAMES.map((t) => [t, { columns: COLUMNS[t], keys: PRIMARY_KEYS[t] }]),
  );
  rpc = rpc.replace(
    /specs constant jsonb := '[^\n]+'::jsonb;/,
    'specs constant jsonb := ' +
      String.fromCharCode(39) +
      JSON.stringify(specs) +
      String.fromCharCode(39) +
      '::jsonb;',
  );
  rpc = rpc.replace('^(rec|soe)-[a-f0-9]{20}$', '^(rec|soe|div)-[a-f0-9]{20}$');
  const oldArchive =
    "  if jsonb_array_length(p_catalog->'catalog_archives')<>2 then raise exception 'Exactly two page archives required'; end if;";
  if (!rpc.includes(oldArchive))
    throw new Error('Historic RPC boundary changed; manual review required');
  rpc = rpc.replace(
    oldArchive,
    `  -- Accept the current two-page release until the first three-page catalog is published.
  -- Once div parents exist, the existing no-removal guard rejects old two-page payloads.
  if jsonb_array_length(p_catalog->'catalog_archives') not in (2,3) then
    raise exception 'Two legacy or three registered page archives required';
  end if;
  if exists(select 1 from jsonb_array_elements(p_catalog->'catalog_archives') a
      where a->>'kind' is null or a->>'kind' not in ('rec','soe','div')
      or not exists(select 1 from jsonb_array_elements(p_catalog->'job_entries') j
        where j->>'kind'=a->>'kind' and j->>'section'='core'))
    or exists(select 1 from jsonb_array_elements(p_catalog->'job_entries') j
      where not exists(select 1 from jsonb_array_elements(p_catalog->'catalog_archives') a where a->>'kind'=j->>'kind'))
    or exists(select 1 from jsonb_array_elements(p_catalog->'timeline_events') e
      where not exists(select 1 from jsonb_array_elements(p_catalog->'catalog_archives') a where a->>'kind'=e->>'kind'))
    or exists(select 1 from jsonb_array_elements(p_catalog->'change_logs') e
      where not exists(select 1 from jsonb_array_elements(p_catalog->'catalog_archives') a where a->>'kind'=e->>'kind')) then
    raise exception 'Archive and catalog kinds must match the registered non-empty pages';
  end if;`,
  );
  const checks = ['job_entries', 'catalog_archives', 'timeline_events', 'change_logs']
    .map(
      (t) =>
        'alter table public.' +
        t +
        ' drop constraint ' +
        t +
        '_kind_check;\n' +
        'alter table public.' +
        t +
        ' add constraint ' +
        t +
        "_kind_check check (kind in ('rec','soe','div'));",
    )
    .join('\n');
  return (
    '-- 005: additive diverse-opportunity catalog support. No catalog or private rows are changed.\n' +
    '-- Apply after 001-004. Old rec/soe releases remain valid until div is first published.\n' +
    "begin;\nset local lock_timeout='10s';\nset local statement_timeout='60s';\nselect pg_advisory_xact_lock(7272027,1);\n" +
    checks +
    '\n\n' +
    rpc +
    "notify pgrst,'reload schema';\ncommit;\n"
  );
}
const target = path.join(ROOT, 'supabase/migrations', MIGRATION);
const sql = renderDiverseMigration();
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== sql)
    throw new Error('Diverse migration out of date; run node scripts/generate-sync-migration.mjs');
  console.log('Diverse migration matches the catalog contract; historic migrations untouched.');
} else {
  fs.writeFileSync(target, sql);
  console.log('Generated', target);
}
