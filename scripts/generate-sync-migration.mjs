import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TABLE_NAMES, PRIMARY_KEYS, COLUMNS } from './catalog-data.mjs';

// Generates a fixed table/column allowlist; user data is always bound as JSON, never SQL.
const spec = Object.fromEntries(
  TABLE_NAMES.map((t) => [t, { columns: COLUMNS[t], keys: PRIMARY_KEYS[t] }]),
);
const sql = `-- Atomic GitHub catalog synchronization. Never writes Auth or personal states.
-- Install once after the existing migrations. Re-running this file is safe.
begin;
alter table public.sources add column if not exists published text;
create schema if not exists recsys_sync;
revoke all on schema recsys_sync from public, anon, authenticated;
grant usage on schema recsys_sync to service_role;
create table if not exists recsys_sync.releases (
  run_number bigint primary key,
  revision text not null,
  content_hash text not null,
  applied_at timestamptz not null default now(),
  row_counts jsonb not null,
  previous_catalog jsonb not null
);
alter table recsys_sync.releases enable row level security;
revoke all on recsys_sync.releases from public, anon, authenticated;
grant select, insert, delete on recsys_sync.releases to service_role;
${TABLE_NAMES.map((t) => `grant select, insert, update on public.${t} to service_role;`).join('\n')}
${TABLE_NAMES.filter((t) => !['companies', 'job_entries', 'sources'].includes(t))
  .map((t) => `grant delete on public.${t} to service_role;`)
  .join('\n')}

create or replace function public.recsys_apply_catalog(
  p_catalog jsonb,
  p_revision text,
  p_run_number bigint,
  p_dry_run boolean default false
) returns jsonb
language plpgsql security invoker
set search_path = ''
set lock_timeout = '10s'
as $sync$
declare
  specs constant jsonb := '${JSON.stringify(spec)}'::jsonb;
  ordered_tables constant text[] := array[${TABLE_NAMES.map((t) => `'${t}'`).join(',')}];
  t text; cols text; key_cols text; updates text; equality text;
  incoming_row jsonb; k text; cast_count bigint; missing text;
  before_catalog jsonb := '{}'::jsonb;
  actual_rows jsonb; expected_rows jsonb;
  row_counts jsonb := '{}'::jsonb;
  input_hash text;
  latest recsys_sync.releases%rowtype;
  is_replay boolean := false;
begin
  if p_catalog is null or jsonb_typeof(p_catalog) <> 'object' then
    raise exception 'Catalog must be a JSON object';
  end if;
  if p_dry_run is null or p_run_number is null or p_run_number < 1
     or p_revision is null or p_revision !~ '^[a-f0-9]{40}$' then
    raise exception 'Valid commit SHA, positive run number and dry-run flag are required';
  end if;
  if octet_length(p_catalog::text) > 10000000 then
    raise exception 'Catalog exceeds the 10 MB safety limit';
  end if;
  if (select count(*) from jsonb_object_keys(p_catalog)) <> array_length(ordered_tables,1)
     or not (p_catalog ?& ordered_tables) then
    raise exception 'Catalog table allowlist mismatch';
  end if;
  perform pg_advisory_xact_lock(7272027, 1);
  input_hash := md5(p_catalog::text);
  select * into latest from recsys_sync.releases order by run_number desc limit 1;
  if latest.run_number is not null then
    if p_run_number < latest.run_number then
      raise exception 'Stale workflow run rejected; push a new commit to roll back data';
    elsif p_run_number = latest.run_number then
      if p_revision <> latest.revision or input_hash <> latest.content_hash then
        raise exception 'A workflow run cannot publish different content';
      end if;
      is_replay := true;
    end if;
  end if;

  foreach t in array ordered_tables loop
    if jsonb_typeof(p_catalog->t) <> 'array' or jsonb_array_length(p_catalog->t)>25000 then
      raise exception 'Invalid row array for %',t;
    end if;
    select string_agg(format('%I',c),',') into cols
      from jsonb_array_elements_text(specs->t->'columns') c;
    for incoming_row in select value from jsonb_array_elements(p_catalog->t) loop
      if jsonb_typeof(incoming_row)<>'object' then raise exception 'Invalid row in %',t; end if;
      if (select count(*) from jsonb_object_keys(incoming_row)) <> jsonb_array_length(specs->t->'columns') then
        raise exception 'Missing or unknown columns in %',t;
      end if;
      for k in select jsonb_object_keys(incoming_row) loop
        if not (specs->t->'columns' ? k) then raise exception 'Unknown column %.%',t,k; end if;
      end loop;
    end loop;
    -- Cast every row before any writes, and snapshot public catalog tables for recovery.
    execute format('select count(*) from jsonb_populate_recordset(null::public.%I,$1)',t)
      into cast_count using p_catalog->t;
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from (select %s from public.%I) x',cols,t)
      into actual_rows;
    before_catalog := before_catalog || jsonb_build_object(t,actual_rows);
    row_counts := row_counts || jsonb_build_object(t,cast_count);
    if t = any(array['companies','job_entries','sources']) then
      execute format('select string_agg(old.id,'', '') from public.%I old where not exists (select 1 from jsonb_array_elements($1) n where n->>''id''=old.id)',t)
        into missing using p_catalog->t;
      if missing is not null then raise exception 'Refusing removal or ID change in %: %',t,missing; end if;
    end if;
    -- Duplicated primary keys must be rejected even for a dry run.
    select string_agg(format('r->>%L',c),',') into key_cols from jsonb_array_elements_text(specs->t->'keys') c;
    execute format('select count(*) from (select %s from jsonb_array_elements($1) r group by %s having count(*)>1) duplicate',key_cols,key_cols)
      into cast_count using p_catalog->t;
    if cast_count>0 then raise exception 'Duplicate primary key in %',t; end if;
  end loop;
  if not exists(select 1 from jsonb_array_elements(p_catalog->'job_entries') r where r->>'kind'='rec' and r->>'section'='core')
     or not exists(select 1 from jsonb_array_elements(p_catalog->'job_entries') r where r->>'kind'='soe' and r->>'section'='core') then
    raise exception 'Both rec and soe core catalogs must remain non-empty';
  end if;
  if exists(select 1 from jsonb_array_elements(p_catalog->'job_entries') r
     where r->>'id' !~ '^(rec|soe)-[a-f0-9]{20}$'
       or left(r->>'id',3) is distinct from r->>'kind'
       or r->>'company_id' is distinct from 'co-'||substring(r->>'id' from 5)) then
    raise exception 'Invalid card identity or changed company association';
  end if;
  if jsonb_array_length(p_catalog->'catalog_archives')<>2 then raise exception 'Exactly two page archives required'; end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'revision',p_revision,'run_number',p_run_number,'content_hash',input_hash,'counts',row_counts);
  end if;

  foreach t in array ordered_tables loop
    select string_agg(format('%I',c),',') into cols from jsonb_array_elements_text(specs->t->'columns') c;
    select string_agg(format('%I',c),',') into key_cols from jsonb_array_elements_text(specs->t->'keys') c;
    select string_agg(format('%1$I=excluded.%1$I',c),','),
           string_agg(format('target.%1$I is distinct from excluded.%1$I',c),' or ')
      into updates,equality from jsonb_array_elements_text(specs->t->'columns') c
      where not (specs->t->'keys' ? c);
    execute format('insert into public.%I as target (%s) select %s from jsonb_populate_recordset(null::public.%I,$1) on conflict (%s) do update set %s where %s',t,cols,cols,t,key_cols,updates,equality)
      using p_catalog->t;
    -- Replace only dependent public facts. Parent cards/companies/sources are NEVER deleted.
    if t <> all(array['companies','job_entries','sources']) then
      select string_agg(format('n.%1$I = target.%1$I',c),' and ') into equality
        from jsonb_array_elements_text(specs->t->'keys') c;
      execute format('delete from public.%I target where not exists (select 1 from jsonb_populate_recordset(null::public.%I,$1) n where %s)',t,t,equality)
        using p_catalog->t;
    end if;
  end loop;
  -- Read-after-write equality is checked INSIDE this transaction, before commit.
  foreach t in array ordered_tables loop
    select string_agg(format('%I',c),',') into cols from jsonb_array_elements_text(specs->t->'columns') c;
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from (select %s from public.%I) x',cols,t)
      into actual_rows;
    select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into expected_rows from jsonb_array_elements(p_catalog->t);
    if actual_rows is distinct from expected_rows then raise exception 'Post-write verification failed for %; all changes rolled back',t; end if;
  end loop;
  if not is_replay then
    insert into recsys_sync.releases(run_number,revision,content_hash,row_counts,previous_catalog)
      values(p_run_number,p_revision,input_hash,row_counts,before_catalog);
    -- Keep the latest 20 PUBLIC catalog snapshots; never back up Auth or personal data here.
    delete from recsys_sync.releases where run_number not in (select run_number from recsys_sync.releases order by run_number desc limit 20);
  end if;
  return jsonb_build_object('dry_run',false,'revision',p_revision,'run_number',p_run_number,'content_hash',input_hash,'counts',row_counts,'replayed',is_replay,'verified_in_transaction',true);
end;
$sync$;
revoke all on function public.recsys_apply_catalog(jsonb,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.recsys_apply_catalog(jsonb,text,bigint,boolean) to service_role;
comment on function public.recsys_apply_catalog(jsonb,text,bigint,boolean) is 'CI-only atomic public catalog sync; parent deletion and old workflow replays are blocked.';
notify pgrst,'reload schema';
commit;
`;
const target = path.join(ROOT, 'supabase/migrations/202609130003_catalog_sync.sql');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== sql)
    throw new Error('Sync migration is out of date; run node scripts/generate-sync-migration.mjs');
  console.log('Sync SQL allowlist matches the data normalizer.');
} else {
  fs.writeFileSync(target, sql);
  console.log('Generated', path.relative(ROOT, target));
}
