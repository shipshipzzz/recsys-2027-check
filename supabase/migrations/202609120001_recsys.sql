-- 001: current facts are typed; personal states are owner-scoped.
begin;
create table if not exists public.companies (
 id text primary key, name text not null, english_name text not null default ''
);
create table if not exists public.job_entries (
 id text primary key, company_id text not null references public.companies(id),
 kind text not null check(kind in ('rec','soe')), section text not null check(section in ('core','extra')),
 sort_order integer not null, has_deadline_override boolean not null default false,
 status text not null,
 recommendation text,
 source_type text,
 opened text,
 closes text,
 graduation_window text,
 city text,
 jobs text,
 requirements text,
 note text,
 reviewed_on date,
 fit integer check (fit between 0 and 100),
 tier text,
 track text,
 ownership text,
 includes_xian boolean,
 due_on date,
 due_alternative text,
 due_time text,
 due_scope text,
 starts_on date,
 next_action text,
 fit_reason text,
 risk text,
 resume_advice text,
 evidence text,
 priority integer,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(kind,company_id), check(status in ('open','intern','wait','verify','soon','watch','past'))
);
create index if not exists job_entries_kind_order_idx on public.job_entries(kind,section,sort_order);
create index if not exists job_entries_company_idx on public.job_entries(company_id);
create table if not exists public.sources (
 id text primary key,title text not null,url text not null default '',level text,scope text,access text,checked_on date
);
create table if not exists public.entry_links (
 entry_id text not null references public.job_entries(id) on delete cascade,
 position integer not null,label text not null,url text not null check(url ~ '^https?://'),primary key(entry_id,position)
);
create table if not exists public.entry_audits (
 entry_id text primary key references public.job_entries(id) on delete cascade,
 checked_on date, summary text not null default '',scope text not null default '',level text not null default ''
);
create table if not exists public.job_sources (
 entry_id text not null references public.job_entries(id) on delete cascade,
 source_id text not null references public.sources(id),position integer not null,
 primary key(entry_id,source_id)
);
create index if not exists job_sources_source_idx on public.job_sources(source_id);
create table if not exists public.entry_deadlines (
 entry_id text primary key references public.job_entries(id) on delete cascade,
 event_on date not null,event_time text,event_kind text not null,scope text,confidence text,source_ids text[] not null default '{}',note text
);
create table if not exists public.catalog_archives (
 kind text primary key check(kind in ('rec','soe')),checked_on date not null,
 original_items jsonb not null default '[]',legacy_due jsonb not null default '{}',legacy_timeline jsonb not null default '[]',kind_labels jsonb not null default '{}'
);
create table if not exists public.timeline_events (
 id text primary key,kind text not null check(kind in ('rec','soe')),position integer not null,
 event_on date not null,event_time text,event_kind text not null,text text not null,
 source_ids text[] not null default '{}',confidence text,note text,original_text text,original_index integer
);
create index if not exists timeline_events_kind_idx on public.timeline_events(kind,position);
create table if not exists public.change_logs (
 id text primary key,kind text not null check(kind in ('rec','soe')),position integer not null,
 event_on date not null,title text not null,summary text,items jsonb not null default '[]'
);
create index if not exists change_logs_kind_idx on public.change_logs(kind,position);
create table if not exists public.user_card_states (
 user_id uuid not null references auth.users(id) on delete cascade,
 entry_id text not null references public.job_entries(id) on delete cascade,
 status text not null check(status in ('active','applied','uninterested')),
 updated_at timestamptz not null default now(),primary key(user_id,entry_id)
);
create index if not exists user_card_states_entry_idx on public.user_card_states(entry_id);
create or replace function public.recsys_touch_updated_at() returns trigger
language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end; $$;
revoke all on function public.recsys_touch_updated_at() from public,anon,authenticated;
drop trigger if exists recsys_touch on public.user_card_states;
create trigger recsys_touch before update on public.user_card_states for each row execute function public.recsys_touch_updated_at();
drop trigger if exists recsys_touch on public.job_entries;
create trigger recsys_touch before update on public.job_entries for each row execute function public.recsys_touch_updated_at();
grant usage on schema public to anon,authenticated;
alter table public.companies enable row level security;
revoke all on public.companies from anon,authenticated;
grant select on public.companies to anon,authenticated;
drop policy if exists catalog_read on public.companies;
create policy catalog_read on public.companies for select to anon,authenticated using(true);
alter table public.job_entries enable row level security;
revoke all on public.job_entries from anon,authenticated;
grant select on public.job_entries to anon,authenticated;
drop policy if exists catalog_read on public.job_entries;
create policy catalog_read on public.job_entries for select to anon,authenticated using(true);
alter table public.sources enable row level security;
revoke all on public.sources from anon,authenticated;
grant select on public.sources to anon,authenticated;
drop policy if exists catalog_read on public.sources;
create policy catalog_read on public.sources for select to anon,authenticated using(true);
alter table public.entry_links enable row level security;
revoke all on public.entry_links from anon,authenticated;
grant select on public.entry_links to anon,authenticated;
drop policy if exists catalog_read on public.entry_links;
create policy catalog_read on public.entry_links for select to anon,authenticated using(true);
alter table public.entry_audits enable row level security;
revoke all on public.entry_audits from anon,authenticated;
grant select on public.entry_audits to anon,authenticated;
drop policy if exists catalog_read on public.entry_audits;
create policy catalog_read on public.entry_audits for select to anon,authenticated using(true);
alter table public.job_sources enable row level security;
revoke all on public.job_sources from anon,authenticated;
grant select on public.job_sources to anon,authenticated;
drop policy if exists catalog_read on public.job_sources;
create policy catalog_read on public.job_sources for select to anon,authenticated using(true);
alter table public.entry_deadlines enable row level security;
revoke all on public.entry_deadlines from anon,authenticated;
grant select on public.entry_deadlines to anon,authenticated;
drop policy if exists catalog_read on public.entry_deadlines;
create policy catalog_read on public.entry_deadlines for select to anon,authenticated using(true);
alter table public.catalog_archives enable row level security;
revoke all on public.catalog_archives from anon,authenticated;
grant select on public.catalog_archives to anon,authenticated;
drop policy if exists catalog_read on public.catalog_archives;
create policy catalog_read on public.catalog_archives for select to anon,authenticated using(true);
alter table public.timeline_events enable row level security;
revoke all on public.timeline_events from anon,authenticated;
grant select on public.timeline_events to anon,authenticated;
drop policy if exists catalog_read on public.timeline_events;
create policy catalog_read on public.timeline_events for select to anon,authenticated using(true);
alter table public.change_logs enable row level security;
revoke all on public.change_logs from anon,authenticated;
grant select on public.change_logs to anon,authenticated;
drop policy if exists catalog_read on public.change_logs;
create policy catalog_read on public.change_logs for select to anon,authenticated using(true);
alter table public.user_card_states enable row level security;
revoke all on public.user_card_states from anon,authenticated;
grant select,insert,update,delete on public.user_card_states to authenticated;
drop policy if exists states_read_own on public.user_card_states;
create policy states_read_own on public.user_card_states for select to authenticated using((select auth.uid())=user_id);
drop policy if exists states_insert_own on public.user_card_states;
create policy states_insert_own on public.user_card_states for insert to authenticated with check((select auth.uid())=user_id);
drop policy if exists states_update_own on public.user_card_states;
create policy states_update_own on public.user_card_states for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists states_delete_own on public.user_card_states;
create policy states_delete_own on public.user_card_states for delete to authenticated using((select auth.uid())=user_id);
notify pgrst,'reload schema';
commit;
