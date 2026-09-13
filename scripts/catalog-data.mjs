import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {FIELD_MAP, hydrateCatalog} from '../src/catalog-model.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const KINDS = ['rec', 'soe'];
export const PRIMARY_KEYS = Object.freeze({
  companies:['id'], job_entries:['id'], sources:['id'],
  entry_links:['entry_id','position'], entry_audits:['entry_id'],
  job_sources:['entry_id','source_id'], entry_deadlines:['entry_id'],
  catalog_archives:['kind'], timeline_events:['id'], change_logs:['id']
});
export const TABLE_NAMES = Object.keys(PRIMARY_KEYS);
export const COLUMNS = Object.freeze({
  companies:['id','name','english_name'],
  job_entries:['id','company_id','kind','section','sort_order','has_deadline_override',...Object.values(FIELD_MAP).map(([column])=>column)],
  sources:['id','title','url','level','scope','access','checked_on','published'],
  entry_links:['entry_id','position','label','url'],
  entry_audits:['entry_id','checked_on','summary','scope','level'],
  job_sources:['entry_id','source_id','position'],
  entry_deadlines:['entry_id','event_on','event_time','event_kind','scope','confidence','source_ids','note'],
  catalog_archives:['kind','checked_on','original_items','legacy_due','legacy_timeline','kind_labels'],
  timeline_events:['id','kind','position','event_on','event_time','event_kind','text','source_ids','confidence','note','original_text','original_index'],
  change_logs:['id','kind','position','event_on','title','summary','items']
});
export const CARD_ID = /^(rec|soe)-[a-f0-9]{20}$/;
const statuses = new Set(['open','intern','wait','verify','soon','watch','past']);
const own = (object,key)=>Object.hasOwn(object,key);
const must = (condition,message)=>{if(!condition)throw new Error(message);};
const object = (value,label)=>must(value!==null && typeof value==='object' && !Array.isArray(value),`${label}: expected object`);
const array = (value,label)=>must(Array.isArray(value),`${label}: expected array`);
const text = (value,label,required=false)=>must(typeof value==='string' && (!required || value.trim().length>0),`${label}: expected ${required?'non-empty ':''}string`);
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))must(allowed.includes(key),`${label}: unknown field ${key}`);}
export function validDate(value){return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;}
function date(value,label,nullable=false){must((nullable && value==null)||validDate(value),`${label}: expected valid YYYY-MM-DD date${nullable?' or null':''}`);}
function url(value,label,allowEmpty=false){if(allowEmpty && value==='')return;let parsed;try{parsed=new URL(value);}catch{}must(parsed && ['https:','http:'].includes(parsed.protocol) && !parsed.username && !parsed.password,`${label}: expected HTTP(S) URL without credentials`);}
function refs(value,label){array(value,label);for(const ref of value)must(typeof ref==='string' && /^[\w-]{1,80}$/.test(ref),`${label}: invalid source ID`);must(new Set(value).size===value.length,`${label}: duplicate source ID`);}
function maybeTime(value,label){must(value==null || /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value),`${label}: invalid time`);}
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null && typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function loadCatalogs(root=ROOT){return Object.fromEntries(KINDS.map(kind=>[kind,JSON.parse(fs.readFileSync(path.join(root,'data',`${kind}.json`),'utf8').replace(/^\uFEFF/,''))]));}
export function cardId(kind,name){must(KINDS.includes(kind),'kind must be rec or soe');text(name,'name',true);return `${kind}-${createHash('sha256').update(name.normalize('NFC')).digest('hex').slice(0,20)}`;}

/** Pure conversion. Existing IDs, not display names, define company identity. */
export function normalizeCatalogs(catalogs){
  keys(catalogs,KINDS,'catalogs');
  const tables=Object.fromEntries(TABLE_NAMES.map(name=>[name,[]]));
  const companies=new Map(),sources=new Map(),entries=new Set();
  for(const kind of KINDS){
    const d=catalogs[kind],label=`data/${kind}.json`;
    keys(d,['DATA','EXTRA','KIND','LOG','DUE','TIMELINE','PAGE_KIND','ORIGINAL_ITEMS','SOURCES','REC_DEADLINES','RECHECKED','TIMELINE_EVENTS'],label);
    must(d.PAGE_KIND===kind,`${label}: PAGE_KIND mismatch`);
    array(d.DATA,`${label}.DATA`);must(d.DATA.length>0,`${label}: core DATA must not be empty`);
    array(d.EXTRA??[],`${label}.EXTRA`);array(d.ORIGINAL_ITEMS,`${label}.ORIGINAL_ITEMS`);
    date(d.RECHECKED,`${label}.RECHECKED`);object(d.SOURCES,`${label}.SOURCES`);
    array(d.LOG??[],`${label}.LOG`);array(d.TIMELINE_EVENTS??[],`${label}.TIMELINE_EVENTS`);
    object(d.REC_DEADLINES??{},`${label}.REC_DEADLINES`);
    for(const [sourceKey,s] of Object.entries(d.SOURCES)){
      keys(s,['id','title','url','level','scope','access','checked','published'],`${label}.SOURCES.${sourceKey}`);
      must(sourceKey===s.id && /^[\w-]{1,80}$/.test(s.id),`${label}: source key/id mismatch`);
      text(s.title,`${sourceKey}.title`,true);url(s.url??'',`${sourceKey}.url`,true);date(s.checked,`${sourceKey}.checked`,true);
      for(const field of ['level','scope','access','published'])if(s[field]!=null)text(s[field],`${sourceKey}.${field}`);
      const row={id:s.id,title:s.title,url:s.url??'',level:s.level??null,scope:s.scope??null,access:s.access??null,checked_on:s.checked??null,published:s.published??null};
      must(!sources.has(s.id)||canonical(sources.get(s.id))===canonical(row),`Shared source ${s.id} differs between rec.json and soe.json; update both copies consistently`);
      sources.set(s.id,row);
    }
    let order=0;const names=new Set();
    for(const [section,items] of [['core',d.DATA],['extra',d.EXTRA??[]]])for(const item of items){
      keys(item,['id','name','en','links','audit',...Object.keys(FIELD_MAP)],`${label}.card`);
      must(CARD_ID.test(item.id??'') && item.id.startsWith(kind+'-'),`${label}: invalid/missing card id; keep existing IDs and use npm run card:id for a NEW card`);
      must(!entries.has(item.id),`${label}: duplicate card id ${item.id}`);entries.add(item.id);
      text(item.name,`${item.id}.name`,true);must(!names.has(item.name),`${label}: duplicate company name ${item.name}`);names.add(item.name);
      text(item.en??'',`${item.id}.en`);must(statuses.has(item.status),`${item.id}: invalid recruitment status`);
      const companyId='co-'+item.id.slice(4),company={id:companyId,name:item.name,english_name:item.en??''};
      must(!companies.has(companyId)||canonical(companies.get(companyId))===canonical(company),`Shared company ${companyId} differs between pages; update both names/English names consistently`);
      companies.set(companyId,company);
      const row={id:item.id,company_id:companyId,kind,section,sort_order:order++,has_deadline_override:own(d.REC_DEADLINES??{},item.name)};
      for(const [field,[column,type]] of Object.entries(FIELD_MAP)){
        const value=item[field]??null;
        if(value!==null){
          if(type.startsWith('date'))date(value,`${item.id}.${field}`);
          else if(type.startsWith('integer'))must(Number.isSafeInteger(value),`${item.id}.${field}: expected integer`);
          else if(type.startsWith('boolean'))must(typeof value==='boolean',`${item.id}.${field}: expected boolean`);
          else text(value,`${item.id}.${field}`);
        }
        row[column]=value;
      }
      if(item.fit!=null)must(item.fit>=0&&item.fit<=100,`${item.id}.fit: must be 0..100`);
      tables.job_entries.push(row);
      array(item.links??[],`${item.id}.links`);
      (item.links??[]).forEach((link,position)=>{array(link,`${item.id}.link`);must(link.length===2,`${item.id}: links use [label,url]`);text(link[0],`${item.id}.link.label`,true);url(link[1],`${item.id}.link.url`);tables.entry_links.push({entry_id:item.id,position,label:link[0],url:link[1]});});
      if(item.audit){
        const a=item.audit;keys(a,['checked','summary','scope','level','refs'],`${item.id}.audit`);date(a.checked,`${item.id}.audit.checked`,true);refs(a.refs??[],`${item.id}.audit.refs`);
        for(const f of ['summary','scope','level'])text(a[f]??'',`${item.id}.audit.${f}`);
        tables.entry_audits.push({entry_id:item.id,checked_on:a.checked??null,summary:a.summary??'',scope:a.scope??'',level:a.level??''});
        (a.refs??[]).forEach((source_id,position)=>tables.job_sources.push({entry_id:item.id,source_id,position}));
      }
      const e=d.REC_DEADLINES?.[item.name];
      if(e!=null){
        keys(e,['date','time','kind','scope','confidence','refs','note'],`${item.id}.deadline`);date(e.date,`${item.id}.deadline.date`);maybeTime(e.time,`${item.id}.deadline.time`);text(e.kind,`${item.id}.deadline.kind`,true);refs(e.refs??[],`${item.id}.deadline.refs`);
        tables.entry_deadlines.push({entry_id:item.id,event_on:e.date,event_time:e.time??null,event_kind:e.kind,scope:e.scope??'',confidence:e.confidence??null,source_ids:e.refs??[],note:e.note??''});
      }
    }
    for(const name of Object.keys(d.REC_DEADLINES??{}))must(names.has(name),`${label}: deadline key ${name} has no matching card (rename its deadline key too)`);
    tables.catalog_archives.push({kind,checked_on:d.RECHECKED,original_items:d.ORIGINAL_ITEMS,legacy_due:d.DUE??{},legacy_timeline:d.TIMELINE??[],kind_labels:d.KIND??{}});
    (d.TIMELINE_EVENTS??[]).forEach((e,position)=>{
      keys(e,['date','time','kind','text','refs','confidence','note','originalText','originalIndex'],`${label}.TIMELINE_EVENTS[${position}]`);date(e.date,'timeline date');maybeTime(e.time,'timeline time');text(e.kind,'timeline kind',true);must(e.kind!=='today','Do not persist dynamic today marker');text(e.text,'timeline text',true);refs(e.refs??[],'timeline refs');
      if(e.originalIndex!=null)must(Number.isSafeInteger(e.originalIndex),'originalIndex must be integer');
      tables.timeline_events.push({id:`${kind}-timeline-${position}`,kind,position,event_on:e.date,event_time:e.time??null,event_kind:e.kind,text:e.text,source_ids:e.refs??[],confidence:e.confidence??'pending',note:e.note??'',original_text:e.originalText??null,original_index:e.originalIndex??null});
    });
    (d.LOG??[]).forEach((l,position)=>{
      keys(l,['date','title','summary','items'],`${label}.LOG[${position}]`);date(l.date,'log date');text(l.title,'log title',true);array(l.items,'log items');
      tables.change_logs.push({id:`${kind}-log-${position}`,kind,position,event_on:l.date,title:l.title,summary:l.summary??null,items:l.items});
    });
  }
  tables.companies=[...companies.values()];tables.sources=[...sources.values()];
  for(const row of [...tables.job_sources,...tables.entry_deadlines,...tables.timeline_events]){
    for(const ref of (row.source_id?[row.source_id]:row.source_ids))must(sources.has(ref),`Unknown source reference ${ref}`);
  }
  // Every normalized row must have exactly the explicitly supported columns.
  for(const table of TABLE_NAMES)for(const row of tables[table])must(canonical(Object.keys(row).sort())===canonical([...COLUMNS[table]].sort()),`Internal column mismatch for ${table}`);
  return tables;
}
export function validatePrevious(previous,current){
  const oldTables=normalizeCatalogs(previous),next=normalizeCatalogs(current);
  for(const table of ['job_entries','companies','sources']){
    const ids=new Set(next[table].map(row=>row.id));
    const missing=oldTables[table].filter(row=>!ids.has(row.id)).map(row=>row.id);
    must(!missing.length,`Refusing removal or ID change in ${table}: ${missing.join(', ')}. Keep old cards and mark them past/watch instead.`);
  }
  return next;
}
export function sortedTable(table,rows){
  const keys=PRIMARY_KEYS[table];
  return rows.map(row=>Object.fromEntries(COLUMNS[table].map(key=>[key,row[key]??null]))).sort((a,b)=>canonical(keys.map(k=>a[k])).localeCompare(canonical(keys.map(k=>b[k])),'en'));
}
export function tableDigest(table,rows){return digest(sortedTable(table,rows));}
export const counts=tables=>Object.fromEntries(TABLE_NAMES.map(table=>[table,tables[table].length]));
export function hydratedFromTables(kind,tables){
  const jobs=tables.job_entries.filter(x=>x.kind===kind).map(row=>({...row,companies:tables.companies.find(c=>c.id===row.company_id),...Object.fromEntries(['entry_links','entry_audits','job_sources','entry_deadlines'].map(table=>[table,tables[table].filter(x=>x.entry_id===row.id)]))}));
  return hydrateCatalog(kind,jobs,tables.sources,tables.catalog_archives.find(x=>x.kind===kind),tables.change_logs.filter(x=>x.kind===kind),tables.timeline_events.filter(x=>x.kind===kind));
}
