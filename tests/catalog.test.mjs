import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hydrateCatalog,finalizeCatalog} from '../src/catalog-model.js';

const seed=fs.readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8');
const tables={};
for(const m of seed.matchAll(/jsonb_populate_recordset\(null::public\.(\w+),'((?:''|[^'])*)'::jsonb\)/g)) tables[m[1]]=JSON.parse(m[2].replaceAll("''","'"));
function joined(kind){return tables.job_entries.filter(x=>x.kind===kind).map(r=>({...r,
 companies:tables.companies.find(x=>x.id===r.company_id),entry_links:tables.entry_links.filter(x=>x.entry_id===r.id),
 entry_audits:tables.entry_audits.filter(x=>x.entry_id===r.id),job_sources:tables.job_sources.filter(x=>x.entry_id===r.id),entry_deadlines:tables.entry_deadlines.filter(x=>x.entry_id===r.id)}));}
function checkSubset(expected,actual,path){
 if(expected===null && actual===undefined)return;
 if(expected && typeof expected==='object'&&!Array.isArray(expected)){
  for(const key of Object.keys(expected))checkSubset(expected[key],actual?.[key],path+'.'+key);
 }else assert.deepEqual(actual,expected,path);
}
for(const [kind,count,historical] of [['rec',57,55],['soe',29,28]]){
 test(kind+': every current and historical field survives database roundtrip',()=>{
  const original=JSON.parse(fs.readFileSync(new URL('../data/'+kind+'.json',import.meta.url),'utf8'));
  const actual=hydrateCatalog(kind,joined(kind),tables.sources,tables.catalog_archives.find(x=>x.kind===kind),tables.change_logs.filter(x=>x.kind===kind),tables.timeline_events.filter(x=>x.kind===kind));
  assert.equal(actual.ALL_ITEMS.length,count);assert.equal(actual.ORIGINAL_ITEMS.length,historical);
  for(const item of original.DATA.concat(original.EXTRA||[]))checkSubset(item,actual.ALL_ITEMS.find(x=>x.id===item.id),kind+'/'+item.name);
  assert.deepEqual(actual.ORIGINAL_ITEMS,original.ORIGINAL_ITEMS);
  assert.deepEqual(actual.TIMELINE,original.TIMELINE||[]);
  checkSubset(original.REC_DEADLINES||{},actual.REC_DEADLINES,kind+'/deadlines');
  checkSubset(original.LOG||[],actual.LOG,kind+'/change-log');
  checkSubset(original.TIMELINE_EVENTS||[],actual.TIMELINE_EVENTS,kind+'/timeline');
 });
}
test('seed references are valid and stable; private states are never imported',()=>{
 assert.equal(tables.job_entries.length,86);assert.equal(new Set(tables.job_entries.map(x=>x.id)).size,86);
 assert.equal(tables.sources.length,26);assert.equal(tables.timeline_events.length,49);
 for(const e of tables.job_entries){assert.match(e.id,/^(rec|soe)-[a-f0-9]{20}$/);assert.ok(tables.companies.some(c=>c.id===e.company_id));}
 for(const r of tables.job_sources)assert.ok(tables.sources.some(s=>s.id===r.source_id));
 assert.equal(tables.user_card_states,undefined);assert.doesNotMatch(seed,/insert into public\.user_card_states/i);
});
test('fallback reconstructs the identical array references used by UI helpers',()=>{
 const data=finalizeCatalog({DATA:[{id:'one'}],EXTRA:[{id:'two'}]});assert.equal(data.ALL_ITEMS[0],data.DATA[0]);assert.equal(data.ALL_ITEMS[1],data.EXTRA[0]);
});
