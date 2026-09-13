import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ROOT,loadCatalogs,normalizeCatalogs,validatePrevious,cardId,tableDigest,canonical,validDate,hydratedFromTables} from '../scripts/catalog-data.mjs';
import {cloudClient,assertCloudMatches,applyCatalog,safeError} from '../scripts/cloud-catalog.mjs';
const original=loadCatalogs();
const copy=()=>structuredClone(original);

test('catalog conversion is deterministic and never edits caller input',()=>{
 const data=copy(),before=canonical(data),a=normalizeCatalogs(data),b=normalizeCatalogs(data);
 assert.equal(canonical(data),before);assert.deepEqual(a,b);
});
test('renaming a company retains its card/company IDs',()=>{
 const data=copy(),old=normalizeCatalogs(data).job_entries[0];data.rec.DATA[0].name+='（显示名称更新）';
 const next=validatePrevious(original,data).job_entries[0];assert.equal(next.id,old.id);assert.equal(next.company_id,old.company_id);
});
test('removing or replacing any existing card ID is rejected',()=>{
 const removed=copy();removed.rec.DATA.splice(0,1);assert.throws(()=>validatePrevious(original,removed),/Refusing removal/);
 const changed=copy();changed.rec.DATA[0].id='rec-'+'0'.repeat(20);assert.throws(()=>validatePrevious(original,changed),/ID change/);
});
test('new cards can be added without editing counts or SQL exports',()=>{
 const data=copy();const item={...data.rec.DATA[0],id:cardId('rec','自动化单测专用公司'),name:'自动化单测专用公司'};data.rec.DATA.push(item);
 const normalized=validatePrevious(original,data);assert.equal(normalized.job_entries.length,normalizeCatalogs(original).job_entries.length+1);
 assert.equal(hydratedFromTables('rec',normalized).ALL_ITEMS.at(-1)?.id===item.id || hydratedFromTables('rec',normalized).DATA.at(-1)?.id===item.id,true);
});
test('duplicate IDs, unknown card fields, invalid dates/statuses and broken links fail validation',()=>{
 for(const edit of [d=>d.rec.DATA.push(structuredClone(d.rec.DATA[0])),d=>d.rec.DATA[0].statuz='open',d=>d.rec.DATA[0].rev='2026-02-30',d=>d.rec.DATA[0].status='deleted',d=>d.rec.DATA[0].links=[['bad','javascript:alert(1)']]]){
  const data=copy();edit(data);assert.throws(()=>normalizeCatalogs(data));
 }
 assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-02-29'),false);
});
test('broken source references and conflicting shared metadata fail',()=>{
 const d=copy();d.rec.DATA[0].audit={checked:null,refs:['MISSING']};assert.throws(()=>normalizeCatalogs(d),/Unknown source/);
 const conflict=copy();conflict.soe.SOURCES.R01.title+='different';assert.throws(()=>normalizeCatalogs(conflict),/Shared source/);
});
test('removed child links disappear from the next payload instead of leaving stale rows',()=>{
 const d=copy(),id=d.rec.DATA[0].id;d.rec.DATA[0].links=[];assert.equal(normalizeCatalogs(d).entry_links.filter(r=>r.entry_id===id).length,0);
});
test('full cloud comparison detects extras, missing rows, and removed optional fields',()=>{
 const a=normalizeCatalogs(original),b=structuredClone(a);assertCloudMatches(a,b);
 b.entry_links.push({...b.entry_links[0],position:999});assert.throws(()=>assertCloudMatches(a,b),/entry_links/);
 const c=structuredClone(a);c.job_entries[0].note='stale';assert.throws(()=>assertCloudMatches(a,c),/job_entries/);
 assert.equal(tableDigest('sources',a.sources),tableDigest('sources',[...a.sources].reverse()));
});
test('private data cannot be included and secrets cannot be sent to an unexpected host',()=>{
 const d=copy();d.rec.user_card_states=[];assert.throws(()=>normalizeCatalogs(d),/unknown field/);
 assert.throws(()=>cloudClient({admin:true,env:{}}),/SUPABASE_SECRET_KEY/);
 assert.throws(()=>cloudClient({admin:true,env:{SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEY:'not-used'}}),/does not match/);
 assert.equal(safeError(new Error('sb_secret_'+'x'.repeat(30))),'[REDACTED]');
});
test('sync uses a single RPC, binds data and requires an explicit transactional receipt',async()=>{
 let call;const client={rpc(name,args){call={name,args};return {abortSignal(){return Promise.resolve({data:{revision:'a'.repeat(40),run_number:1,dry_run:false,verified_in_transaction:true},error:null});}};}};
 await applyCatalog(client,{tables:{test:'value'},revision:'a'.repeat(40),runNumber:1,dryRun:false});
 assert.equal(call.name,'recsys_apply_catalog');assert.equal(call.args.p_dry_run,false);
 const bad={rpc(){return {abortSignal(){return Promise.resolve({data:{},error:null});}};}};
 await assert.rejects(applyCatalog(bad,{tables:{},revision:'a'.repeat(40),runNumber:1}),/Invalid sync receipt/);
});
test('generated SQL is current, invoker-scoped, and excludes private tables',()=>{
 execFileSync(process.execPath,['scripts/generate-sync-migration.mjs','--check'],{cwd:ROOT});
 const sql=fs.readFileSync(new URL('../supabase/migrations/202609130003_catalog_sync.sql',import.meta.url),'utf8');
 assert.match(sql,/security invoker/);assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);
 assert.doesNotMatch(sql,/public\.user_card_states|auth\.users|truncate/i);
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/Stale workflow run rejected/);
});
