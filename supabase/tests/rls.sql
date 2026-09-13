-- Run as project postgres in SQL Editor. All fixtures are rolled back.
-- A failure raises an exception; a success ends with 'RLS integration checks passed'.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); e text;
begin
 select id into e from public.job_entries order by id limit 1;
 if e is null then raise exception 'Seed data required';end if;
 perform set_config('recsys.test_a',a::text,true);
 perform set_config('recsys.test_b',b::text,true);
 perform set_config('recsys.test_entry',e,true);
 insert into auth.users(id,email) values(a,'rls-a-'||a||'@example.invalid'),(b,'rls-b-'||b||'@example.invalid');
end $$;

set local role anon;
do $$ begin
 if (select count(*) from public.job_entries)=0 then raise exception 'Anonymous catalog read failed';end if;
 begin perform count(*) from public.user_card_states;raise exception 'Anonymous private read was permitted';
 exception when insufficient_privilege then null;end;
 begin update public.job_entries set note='forbidden' where id=current_setting('recsys.test_entry');raise exception 'Anonymous catalog write was permitted';
 exception when insufficient_privilege then null;end;
 begin insert into public.user_card_states(user_id,entry_id,status) values(current_setting('recsys.test_a')::uuid,current_setting('recsys.test_entry'),'applied');raise exception 'Anonymous state write was permitted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('recsys.test_a'),true);
do $$ declare n integer;begin
 insert into public.user_card_states(user_id,entry_id,status) values(auth.uid(),current_setting('recsys.test_entry'),'active');
 if (select count(*) from public.user_card_states)<>1 then raise exception 'Owner cannot read own state';end if;
 update public.user_card_states set status='applied' where user_id=auth.uid();get diagnostics n=row_count;
 if n<>1 then raise exception 'Owner cannot update own state';end if;
 begin insert into public.user_card_states(user_id,entry_id,status) values(current_setting('recsys.test_b')::uuid,current_setting('recsys.test_entry'),'uninterested');raise exception 'Forged owner insert was permitted';
 exception when insufficient_privilege then null;end;
 begin update public.user_card_states set user_id=current_setting('recsys.test_b')::uuid where user_id=auth.uid();raise exception 'Owner reassignment was permitted';
 exception when insufficient_privilege then null;end;
 begin update public.job_entries set note='forbidden' where id=current_setting('recsys.test_entry');raise exception 'Authenticated catalog write was permitted';
 exception when insufficient_privilege then null;end;
end $$;

select set_config('request.jwt.claim.sub',current_setting('recsys.test_b'),true);
do $$ declare n integer;begin
 if (select count(*) from public.user_card_states)<>0 then raise exception 'Second user can read first user data';end if;
 update public.user_card_states set status='uninterested' where user_id=current_setting('recsys.test_a')::uuid;get diagnostics n=row_count;
 if n<>0 then raise exception 'Second user can update first user data';end if;
 delete from public.user_card_states where user_id=current_setting('recsys.test_a')::uuid;get diagnostics n=row_count;
 if n<>0 then raise exception 'Second user can delete first user data';end if;
 insert into public.user_card_states(user_id,entry_id,status) values(auth.uid(),current_setting('recsys.test_entry'),'uninterested');
 if (select status from public.user_card_states limit 1)<>'uninterested' then raise exception 'Second user own status missing';end if;
 begin update public.user_card_states set status='invalid' where user_id=auth.uid();raise exception 'Invalid state accepted';
 exception when check_violation then null;end;
end $$;

select set_config('request.jwt.claim.sub',current_setting('recsys.test_a'),true);
do $$ declare n integer;begin
 if (select status from public.user_card_states limit 1)<>'applied' then raise exception 'First user state was altered';end if;
 delete from public.user_card_states where user_id=auth.uid();get diagnostics n=row_count;
 if n<>1 then raise exception 'Owner delete failed';end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from pg_tables where schemaname='public' and tablename in ('companies','job_entries','sources','entry_links','entry_audits','job_sources','entry_deadlines','catalog_archives','timeline_events','change_logs','user_card_states') and not rowsecurity) then raise exception 'RLS disabled on an application table';end if;
end $$;
rollback;
select 'RLS integration checks passed; all test users and writes rolled back' as result;
