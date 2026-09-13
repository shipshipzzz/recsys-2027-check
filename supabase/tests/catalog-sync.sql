-- Integration test: ALL successful/failed test writes are rolled back.
begin isolation level repeatable read;
do $test$
declare
 specs constant jsonb := '{"companies":["id","name","english_name"],"job_entries":["id","company_id","kind","section","sort_order","has_deadline_override","status","recommendation","source_type","opened","closes","graduation_window","city","jobs","requirements","note","reviewed_on","fit","tier","track","ownership","includes_xian","due_on","due_alternative","due_time","due_scope","starts_on","next_action","fit_reason","risk","resume_advice","evidence","priority"],"sources":["id","title","url","level","scope","access","checked_on","published"],"entry_links":["entry_id","position","label","url"],"entry_audits":["entry_id","checked_on","summary","scope","level"],"job_sources":["entry_id","source_id","position"],"entry_deadlines":["entry_id","event_on","event_time","event_kind","scope","confidence","source_ids","note"],"catalog_archives":["kind","checked_on","original_items","legacy_due","legacy_timeline","kind_labels"],"timeline_events":["id","kind","position","event_on","event_time","event_kind","text","source_ids","confidence","note","original_text","original_index"],"change_logs":["id","kind","position","event_on","title","summary","items"]}'::jsonb;
 t text; cols text; rows jsonb; catalog jsonb := '{}'::jsonb;
 modified jsonb; receipt jsonb; run_id bigint;
 personal_before text; personal_after text; auth_before bigint; auth_after bigint;
 company_before text; release_count bigint;
begin
 if has_function_privilege('anon','public.recsys_apply_catalog(jsonb,text,bigint,boolean)','execute')
    or has_function_privilege('authenticated','public.recsys_apply_catalog(jsonb,text,bigint,boolean)','execute') then
   raise exception 'FAIL: public/normal users can synchronize the catalog';
 end if;
 if not has_function_privilege('service_role','public.recsys_apply_catalog(jsonb,text,bigint,boolean)','execute') then raise exception 'FAIL: service_role lacks execute'; end if;
 foreach t in array array['companies','job_entries','sources','entry_links','entry_audits','job_sources','entry_deadlines','catalog_archives','timeline_events','change_logs'] loop
   select string_agg(format('%I',c),',') into cols from jsonb_array_elements_text(specs->t) c;
   execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from (select %s from public.%I) x',cols,t) into rows;
   catalog:=catalog||jsonb_build_object(t,rows);
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by user_id,entry_id),'[]'::jsonb)::text) into personal_before from public.user_card_states s;
 select count(*) into auth_before from auth.users;
 select count(*) into release_count from recsys_sync.releases;
 select coalesce(max(run_number),0)+10000 into run_id from recsys_sync.releases;
 receipt:=public.recsys_apply_catalog(catalog,repeat('a',40),run_id,true);
 if receipt->>'dry_run'<>'true' or (select count(*) from recsys_sync.releases)<>release_count then raise exception 'FAIL: dry run wrote release'; end if;
 modified:=jsonb_set(catalog,'{job_entries}',(catalog->'job_entries')-0);
 begin
   perform public.recsys_apply_catalog(modified,repeat('b',40),run_id,false);
   raise exception 'FAIL: missing card accepted';
 exception when raise_exception then
   if sqlerrm not like 'Refusing removal or ID change in job_entries:%' then raise; end if;
 end;
 company_before:=catalog#>>'{companies,0,english_name}';
 modified:=jsonb_set(catalog,'{companies,0,english_name}','"TEMPORARY_ROLLBACK_TEST"'::jsonb);
 modified:=jsonb_set(modified,'{job_entries,0,fit}','101'::jsonb);
 begin
   perform public.recsys_apply_catalog(modified,repeat('c',40),run_id,false);
   raise exception 'FAIL: invalid constraint accepted';
 exception when check_violation then null;
 end;
 if (select english_name from public.companies where id=catalog#>>'{companies,0,id}') is distinct from company_before then raise exception 'FAIL: partial write survived exception'; end if;
 modified:=jsonb_set(catalog,'{job_entries,0,note}','"TEMPORARY_TRANSACTION_SMOKE_TEST"'::jsonb);
 receipt:=public.recsys_apply_catalog(modified,repeat('d',40),run_id,false);
 if receipt->>'verified_in_transaction'<>'true' then raise exception 'FAIL: missing sync receipt'; end if;
 if (select note from public.job_entries where id=catalog#>>'{job_entries,0,id}')<>'TEMPORARY_TRANSACTION_SMOKE_TEST' then raise exception 'FAIL: update not applied'; end if;
 receipt:=public.recsys_apply_catalog(modified,repeat('d',40),run_id,false);
 if receipt->>'replayed'<>'true' then raise exception 'FAIL: idempotent replay failed'; end if;
 begin
   perform public.recsys_apply_catalog(catalog,repeat('e',40),run_id-1,false);
   raise exception 'FAIL: stale workflow accepted';
 exception when raise_exception then
   if sqlerrm not like 'Stale workflow run rejected%' then raise; end if;
 end;
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by user_id,entry_id),'[]'::jsonb)::text) into personal_after from public.user_card_states s;
 select count(*) into auth_after from auth.users;
 if personal_before<>personal_after or auth_before<>auth_after then raise exception 'FAIL: private data changed'; end if;
end;
$test$;
-- Exercise the same invoker role used by the CI secret, still inside this rollback-only test.
set local role service_role;
do $ci_role$
declare fixture jsonb; next_run bigint; receipt jsonb;
begin
 select previous_catalog,run_number+1 into fixture,next_run from recsys_sync.releases order by run_number desc limit 1;
 if fixture is null then raise exception 'FAIL: missing transactional test fixture'; end if;
 receipt:=public.recsys_apply_catalog(fixture,repeat('f',40),next_run,false);
 if receipt->>'verified_in_transaction'<>'true' then raise exception 'FAIL: CI role cannot synchronize'; end if;
end;
$ci_role$;
reset role;
rollback;
select 'PASS: permissions, service_role execution, dry-run, parent deletion guard, partial-write rollback, update, idempotency, stale-run rejection, private-data preservation; all test writes rolled back.' as result;
