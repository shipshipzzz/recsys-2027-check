-- Run as postgres in a dedicated test project, after 202609140004_user_timeline_events.sql.
-- No external Auth calls; every fixture is rolled back. Failure raises an exception.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); e uuid := gen_random_uuid();
begin
  perform set_config('timeline.test_a', a::text, true);
  perform set_config('timeline.test_b', b::text, true);
  perform set_config('timeline.test_event', e::text, true);
  insert into auth.users(id, email) values
    (a, 'timeline-a-' || a || '@example.invalid'), (b, 'timeline-b-' || b || '@example.invalid');
end;
$$;

set local role anon;
do $$
begin
  begin
    perform count(*) from public.user_timeline_events;
    raise exception 'Unauthenticated private read allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_timeline_events(user_id, title, event_type, starts_at, mutation_id)
      values(current_setting('timeline.test_a')::uuid, 'Forbidden', 'assessment', '2030-01-01 09:00+08', gen_random_uuid());
    raise exception 'Unauthenticated private write allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('timeline.test_a'), true);
do $$
declare n integer;
begin
  insert into public.user_timeline_events(user_id, id, title, company_name, event_type, starts_at, ends_at, mutation_id, created_at, updated_at)
    values(auth.uid(), current_setting('timeline.test_event')::uuid, 'Assessment', 'Fixture Co', 'assessment', '2030-01-01 09:00+08', '2030-01-01 10:00+08', gen_random_uuid(), '2000-01-01', '2100-01-01');
  if (select count(*) from public.user_timeline_events) <> 1 then raise exception 'Owner read failed'; end if;
  if exists(select 1 from public.user_timeline_events where updated_at > now() + interval '1 minute' or created_at < now() - interval '1 minute') then
    raise exception 'Client timestamps overrode server timestamps';
  end if;
  update public.user_timeline_events set status = 'completed', mutation_id = gen_random_uuid() where user_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Owner update failed'; end if;
  begin
    update public.user_timeline_events set user_id = current_setting('timeline.test_b')::uuid where user_id = auth.uid();
    raise exception 'Owner reassignment allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_timeline_events(user_id, title, event_type, starts_at, mutation_id)
      values(current_setting('timeline.test_b')::uuid, 'Forged owner', 'interview', '2030-01-01 09:00+08', gen_random_uuid());
    raise exception 'Forged-owner insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.user_timeline_events set status = 'invalid' where user_id = auth.uid();
    raise exception 'Invalid status accepted';
  exception when check_violation then null; end;
  begin
    update public.user_timeline_events set event_type = 'invalid' where user_id = auth.uid();
    raise exception 'Invalid event type accepted';
  exception when check_violation then null; end;
  begin
    update public.user_timeline_events set ends_at = starts_at - interval '1 minute' where user_id = auth.uid();
    raise exception 'Backwards time range accepted';
  exception when check_violation then null; end;
  begin
    update public.user_timeline_events set url = 'javascript:alert(1)' where user_id = auth.uid();
    raise exception 'Executable URL accepted';
  exception when check_violation then null; end;
  begin
    delete from public.user_timeline_events where user_id = auth.uid();
    raise exception 'Hard delete should not bypass tombstones';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('timeline.test_b'), true);
do $$
declare n integer;
begin
  if (select count(*) from public.user_timeline_events) <> 0 then raise exception 'Other user read leaked'; end if;
  update public.user_timeline_events set title = 'Forbidden' where user_id = current_setting('timeline.test_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Other user update allowed'; end if;
  -- Identical event IDs in two accounts are intentionally independent (explicit guest import).
  insert into public.user_timeline_events(user_id, id, title, event_type, starts_at, mutation_id)
    values(auth.uid(), current_setting('timeline.test_event')::uuid, 'Second user interview', 'interview', '2030-01-01 09:00+08', gen_random_uuid());
  if (select count(*) from public.user_timeline_events) <> 1 then raise exception 'Second user independent insert failed'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('timeline.test_a'), true);
do $$
begin
  if (select title from public.user_timeline_events) <> 'Assessment' then raise exception 'First user data changed'; end if;
  update public.user_timeline_events set is_deleted = true, title = 'Deleted', company_name = '', notes = '', location = '', url = '', status = 'cancelled', mutation_id = gen_random_uuid() where user_id = auth.uid();
  if (select count(*) from public.user_timeline_events where is_deleted) <> 1 then raise exception 'Owner tombstone failed'; end if;
end;
$$;
reset role;
do $$
begin
  if not exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'user_timeline_events' and rowsecurity) then raise exception 'Timeline RLS missing'; end if;
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_timeline_events'
  ) then raise exception 'Timeline Realtime publication missing'; end if;
end;
$$;
rollback;
select 'Timeline RLS and constraints passed; all test fixtures rolled back' as result;
