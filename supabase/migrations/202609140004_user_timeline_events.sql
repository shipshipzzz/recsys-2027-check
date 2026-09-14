-- Personal assessment / written test / interview agenda. Never part of catalog publishing.
-- Apply after the existing migrations. This file does not modify catalog facts or user_card_states.
begin;

create table public.user_timeline_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  entry_id text references public.job_entries(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  company_name text not null default '' check (char_length(company_name) <= 160),
  event_type text not null check (event_type in ('assessment', 'written_test', 'interview', 'other')),
  starts_at timestamptz not null check (
    starts_at >= timestamptz '2000-01-01 00:00:00+08' and
    starts_at < timestamptz '2200-01-01 00:00:00+08'
  ),
  ends_at timestamptz check (
    ends_at is null or (ends_at > starts_at and ends_at < timestamptz '2200-01-01 00:00:00+08')
  ),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  location text not null default '' check (char_length(location) <= 300),
  url text not null default '' check (
    char_length(url) <= 2048 and
    (url = '' or (url ~* '^https?://[^[:space:]]+$' and url !~* '^https?://[^/]*@'))
  ),
  notes text not null default '' check (char_length(notes) <= 2000),
  is_deleted boolean not null default false,
  mutation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index user_timeline_events_agenda_idx
  on public.user_timeline_events(user_id, status, starts_at) where not is_deleted;
create index user_timeline_events_entry_idx on public.user_timeline_events(entry_id);

create function public.recsys_touch_timeline() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.created_at = old.created_at;
  else new.created_at = clock_timestamp(); end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.recsys_touch_timeline() from public, anon, authenticated;
create trigger recsys_touch_timeline before insert or update on public.user_timeline_events
  for each row execute function public.recsys_touch_timeline();

alter table public.user_timeline_events enable row level security;
revoke all on table public.user_timeline_events from public, anon, authenticated;
-- The UI deletes by writing a tombstone. Hard DELETE is deliberately not exposed.
grant select, insert, update on public.user_timeline_events to authenticated;
create policy timeline_read_own on public.user_timeline_events for select to authenticated
  using ((select auth.uid()) = user_id);
create policy timeline_insert_own on public.user_timeline_events for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy timeline_update_own on public.user_timeline_events for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

comment on table public.user_timeline_events is
  'Private user-managed recruitment agenda; separate from public timeline_events. Dates are instants displayed in Asia/Shanghai. Deletions use tombstones.';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_timeline_events'
     ) then
    alter publication supabase_realtime add table public.user_timeline_events;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
