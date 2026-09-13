begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'user_card_states'
     ) then
    execute 'alter publication supabase_realtime add table public.user_card_states';
  end if;
end
$$;

commit;
