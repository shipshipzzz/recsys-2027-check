import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'acorn';
import {FIELD_MAP} from '../src/catalog-model.js';

const hash=text=>crypto.createHash('sha256').update(text.normalize('NFC')).digest('hex').slice(0,20);
const tables={companies:[],job_entries:[],sources:[],entry_links:[],entry_audits:[],job_sources:[],entry_deadlines:[],catalog_archives:[],timeline_events:[],change_logs:[]};
const companies=new Map(), sources=new Map();
for(const kind of ['rec','soe']) {
  const d=JSON.parse(fs.readFileSync(`data/${kind}.json`,'utf8'));
  // Calculate the original timeline once, without executing UI code.
  if(kind==='rec' && !d.TIMELINE_EVENTS) {
    const html=fs.readFileSync('.migration-backup/index.html','utf8');
    const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    const ast=parse(code,{ecmaVersion:'latest'});
    const pure=ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>code.slice(n.start,n.end)).join('\n');
    const ctx={};
    vm.runInNewContext(code.slice(0,code.indexOf('const RECHECKED'))+'\nconst RECHECKED="2026-09-13",TZ="Asia/Shanghai";\n'+pure+'\nglobalThis.events=buildRail().filter(x=>x.kind!=="today");',ctx,{timeout:5000});
    d.TIMELINE_EVENTS=JSON.parse(JSON.stringify(ctx.events));
  }
  for(const s of Object.values(d.SOURCES))sources.set(s.id,{id:s.id,title:s.title,url:s.url||'',level:s.level,scope:s.scope,access:s.access,checked_on:s.checked});
  let order=0;
  for(const [section,items] of [['core',d.DATA],['extra',d.EXTRA||[]]])for(const item of items) {
    const companyId='co-'+hash(item.name),id=kind+'-'+hash(item.name);item.id=id;
    companies.set(companyId,{id:companyId,name:item.name,english_name:item.en||''});
    const override=Object.hasOwn(d.REC_DEADLINES||{},item.name);
    const row={id,company_id:companyId,kind,section,sort_order:order++,has_deadline_override:override};
    for(const [field,[column]] of Object.entries(FIELD_MAP))row[column]=item[field]??null;
    tables.job_entries.push(row);
    (item.links||[]).forEach(([label,url],position)=>tables.entry_links.push({entry_id:id,position,label,url}));
    if(item.audit) {
      const a=item.audit;
      tables.entry_audits.push({entry_id:id,checked_on:a.checked,summary:a.summary||'',scope:a.scope||'',level:a.level||''});
      [...new Set(a.refs||[])].forEach((source_id,position)=>tables.job_sources.push({entry_id:id,source_id,position}));
    }
    const e=d.REC_DEADLINES?.[item.name];
    if(override&&e)tables.entry_deadlines.push({entry_id:id,event_on:e.date,event_time:e.time||null,event_kind:e.kind,scope:e.scope||'',confidence:e.confidence,source_ids:e.refs||[],note:e.note||''});
  }
  tables.catalog_archives.push({kind,checked_on:d.RECHECKED,original_items:d.ORIGINAL_ITEMS,legacy_due:d.DUE||{},legacy_timeline:d.TIMELINE||[],kind_labels:d.KIND||{}});
  (d.TIMELINE_EVENTS||[]).forEach((e,position)=>tables.timeline_events.push({id:kind+'-timeline-'+position,kind,position,event_on:e.date,event_time:e.time||null,event_kind:e.kind,text:e.text,source_ids:e.refs||[],confidence:e.confidence||'pending',note:e.note||'',original_text:e.originalText??null,original_index:e.originalIndex??null}));
  (d.LOG||[]).forEach((l,position)=>tables.change_logs.push({id:kind+'-log-'+position,kind,position,event_on:l.date,title:l.title,summary:l.summary,items:l.items}));
  delete d.ALL_ITEMS;delete d.now;
  fs.writeFileSync(`data/${kind}.json`,JSON.stringify(d,null,2)+'\n');
}
tables.companies=[...companies.values()];tables.sources=[...sources.values()];
for(const link of tables.job_sources)if(!sources.has(link.source_id))throw new Error('Unknown audit source '+link.source_id);

const schema=`-- 001: current facts are typed; personal states are owner-scoped.\nbegin;
create table if not exists public.companies (
 id text primary key, name text not null, english_name text not null default ''
);
create table if not exists public.job_entries (
 id text primary key, company_id text not null references public.companies(id),
 kind text not null check(kind in ('rec','soe')), section text not null check(section in ('core','extra')),
 sort_order integer not null, has_deadline_override boolean not null default false,
 ${Object.values(FIELD_MAP).map(([n,t])=>n+' '+t).join(',\n ')},
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
${Object.keys(tables).map(t=>`alter table public.${t} enable row level security;
revoke all on public.${t} from anon,authenticated;
grant select on public.${t} to anon,authenticated;
drop policy if exists catalog_read on public.${t};
create policy catalog_read on public.${t} for select to anon,authenticated using(true);`).join('\n')}
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
`;
const primary={companies:['id'],job_entries:['id'],sources:['id'],entry_links:['entry_id','position'],entry_audits:['entry_id'],job_sources:['entry_id','source_id'],entry_deadlines:['entry_id'],catalog_archives:['kind'],timeline_events:['id'],change_logs:['id']};
function sqlRows(table,rows){
 if(!rows.length)return '';
 const cols=Object.keys(rows[0]), keys=primary[table], json=JSON.stringify(rows).replaceAll("'","''");
 return `insert into public.${table} (${cols.join(',')})\nselect ${cols.join(',')} from jsonb_populate_recordset(null::public.${table},'${json}'::jsonb)\non conflict (${keys.join(',')}) do update set ${cols.filter(c=>!keys.includes(c)).map(c=>c+'=excluded.'+c).join(',')};\n`;
}
fs.mkdirSync('supabase/migrations',{recursive:true});
fs.writeFileSync('supabase/migrations/202609120001_recsys.sql',schema);
fs.writeFileSync('supabase/seed.sql','-- Re-runnable initial import. Never touches user_card_states.\nbegin;\n'+Object.entries(tables).map(([t,r])=>sqlRows(t,r)).join('\n')+'\ncommit;\n');
fs.writeFileSync('.migration-backup/normalized.json',JSON.stringify(tables));
console.log('Generated schema + seed:',Object.fromEntries(Object.entries(tables).map(([t,r])=>[t,r.length])));
