import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {hydrateCatalog} from '../src/catalog-model.js';

// Read-only integration test. Uses only the browser-safe publishable key.
const client=createClient(process.env.VITE_SUPABASE_URL||'https://npqrixancnwbmzcyqafx.supabase.co',process.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_ktnbnYd08R8eahv-2qgMQQ_5rrTZog0',{auth:{persistSession:false,autoRefreshToken:false}});
function subset(expected,actual,path){
 if(expected===null&&actual===undefined)return;
 if(expected&&typeof expected==='object'&&!Array.isArray(expected))for(const key of Object.keys(expected))subset(expected[key],actual?.[key],path+'.'+key);
 else assert.deepEqual(actual,expected,path);
}
for(const [kind,count] of [['rec',57],['soe',29]]){
 const results=await Promise.all([
  client.from('job_entries').select('*,companies(name,english_name),entry_links(*),entry_audits(*),job_sources(source_id,position),entry_deadlines(*)').eq('kind',kind).order('sort_order').abortSignal(AbortSignal.timeout(20000)),
  client.from('sources').select('*').abortSignal(AbortSignal.timeout(20000)),
  client.from('catalog_archives').select('*').eq('kind',kind).single().abortSignal(AbortSignal.timeout(20000)),
  client.from('change_logs').select('*').eq('kind',kind).abortSignal(AbortSignal.timeout(20000)),
  client.from('timeline_events').select('*').eq('kind',kind).abortSignal(AbortSignal.timeout(20000))
 ]);
 for(const r of results)if(r.error)throw r.error;
 const data=hydrateCatalog(kind,...results.map(x=>x.data));
 const local=JSON.parse(fs.readFileSync(new URL('../data/'+kind+'.json',import.meta.url),'utf8'));
 assert.equal(data.ALL_ITEMS.length,count);
 for(const item of local.DATA.concat(local.EXTRA||[]))subset(item,data.ALL_ITEMS.find(x=>x.id===item.id),kind+'/'+item.name);
 assert.deepEqual(data.ORIGINAL_ITEMS,local.ORIGINAL_ITEMS);
 assert.deepEqual(data.TIMELINE_EVENTS,local.TIMELINE_EVENTS||[]);
 console.log(kind+': '+count+' live cloud cards, all facts, historical records and timeline match the migration source.');
}
const {error}=await client.from('user_card_states').select('*').abortSignal(AbortSignal.timeout(10000));
assert.ok(error,'Unauthenticated client must not read private states');
assert.ok(['42501','PGRST301'].includes(error.code),'Expected permission denial, not a network failure: '+error.code);
console.log('PASS: unauthenticated private-state read rejected.');
