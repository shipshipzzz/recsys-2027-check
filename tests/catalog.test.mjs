import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeCatalog} from '../src/catalog-model.js';
import {loadCatalogs,normalizeCatalogs,hydratedFromTables,TABLE_NAMES} from '../scripts/catalog-data.mjs';
const catalogs=loadCatalogs(),tables=normalizeCatalogs(catalogs);
function checkSubset(expected,actual,path){
 if(expected===null && actual===undefined)return;
 if(expected && typeof expected==='object'&&!Array.isArray(expected)){
  for(const key of Object.keys(expected))checkSubset(expected[key],actual?.[key],path+'.'+key);
 }else assert.deepEqual(actual,expected,path);
}
for(const kind of ['rec','soe']){
 test(kind+': every current and historical field survives database roundtrip',()=>{
  const original=catalogs[kind],actual=hydratedFromTables(kind,tables);
  const items=original.DATA.concat(original.EXTRA||[]);
  assert.equal(actual.ALL_ITEMS.length,items.length);
  for(const item of items)checkSubset(item,actual.ALL_ITEMS.find(x=>x.id===item.id),kind+'/'+item.name);
  assert.deepEqual(actual.ORIGINAL_ITEMS,original.ORIGINAL_ITEMS);
  assert.deepEqual(actual.TIMELINE,original.TIMELINE||[]);
  checkSubset(original.REC_DEADLINES||{},actual.REC_DEADLINES,kind+'/deadlines');
  checkSubset(original.LOG||[],actual.LOG,kind+'/change-log');
  checkSubset(original.TIMELINE_EVENTS||[],actual.TIMELINE_EVENTS,kind+'/timeline');
  checkSubset(original.SOURCES,actual.SOURCES,kind+'/sources');
 });
}
test('normalized catalog has complete stable references and never imports private states',()=>{
 const count=Object.values(catalogs).reduce((n,d)=>n+d.DATA.length+(d.EXTRA?.length||0),0);
 assert.equal(tables.job_entries.length,count);assert.equal(new Set(tables.job_entries.map(x=>x.id)).size,count);
 for(const e of tables.job_entries){assert.match(e.id,/^(rec|soe)-[a-f0-9]{20}$/);assert.ok(tables.companies.some(c=>c.id===e.company_id));}
 for(const r of tables.job_sources)assert.ok(tables.sources.some(s=>s.id===r.source_id));
 assert.equal(tables.user_card_states,undefined);assert.equal(TABLE_NAMES.length,10);
});
test('fallback reconstructs identical array references used by UI helpers',()=>{
 const data=finalizeCatalog({DATA:[{id:'one'}],EXTRA:[{id:'two'}]});assert.equal(data.ALL_ITEMS[0],data.DATA[0]);assert.equal(data.ALL_ITEMS[1],data.EXTRA[0]);
});
