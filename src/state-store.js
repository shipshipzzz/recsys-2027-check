import {normalizeState,VALID_STATES} from './catalog-model.js';
const validId=id=>/^(rec|soe)-[a-f0-9]{20}$/.test(id);

/** Browser persistence is partitioned by authenticated user, never by display name.
 * A dirty mutation stays durable until that exact mutation is acknowledged.
 */
export class StateStore {
  constructor(storage,scope='guest',notify=()=>{}) {
    this.storage=storage;this.scope=scope;this.notify=notify;
    this.key='recsys:cards:v1:npqrixancnwbmzcyqafx:'+scope;
    this.entries={};this.lastError=null;this.storageError=false;this.inFlight=null;
    this.reload();
  }
  readDisk(){
    try{
      const value=JSON.parse(this.storage.getItem(this.key)||'{}'),result={};
      for(const [id,e] of Object.entries(value.entries||{}))if(validId(id)&&e&&VALID_STATES.includes(e.status)&&Number.isFinite(e.changedAt)&&typeof e.mutationId==='string')result[id]=e;
      return result;
    }catch{return {};}
  }
  reload(){
    for(const [id,incoming] of Object.entries(this.readDisk())) {
      const old=this.entries[id];
      if(!old||incoming.changedAt>old.changedAt||(incoming.changedAt===old.changedAt&&incoming.mutationId>old.mutationId))this.entries[id]=incoming;
      else if(old.mutationId===incoming.mutationId&&!incoming.dirty)this.entries[id]=incoming;
    }
  }
  persist(){
    try{this.storage.setItem(this.key,JSON.stringify({version:1,entries:this.entries}));this.storageError=false;}
    catch{this.storageError=true;}
    this.notify();
  }
  status(id){return normalizeState(this.entries[id]?.status);}
  pendingCount(){return Object.values(this.entries).filter(e=>e.dirty).length;}
  set(id,status){
    if(!validId(id)||!VALID_STATES.includes(status))throw new Error('无效的卡片或状态');
    this.reload();
    const changedAt=Math.max(Date.now(),(this.entries[id]?.changedAt||0)+1);
    this.entries[id]={status,changedAt,mutationId:globalThis.crypto.randomUUID(),dirty:this.scope!=='guest'};
    this.persist();
  }
  acceptRemote(rows){
    this.reload();
    const pending=Object.fromEntries(Object.entries(this.entries).filter(([,e])=>e.dirty));
    const remote={};
    for(const row of rows)if(validId(row.entry_id)&&VALID_STATES.includes(row.status))remote[row.entry_id]={status:row.status,changedAt:Date.parse(row.updated_at)||0,mutationId:'remote:'+row.updated_at,dirty:false,serverUpdatedAt:row.updated_at};
    this.entries={...remote,...pending};this.persist();
  }
  async flush(save){
    if(this.scope==='guest')return;
    if(this.inFlight)return this.inFlight;
    this.inFlight=this.flushLoop(save);
    try{return await this.inFlight;}finally{this.inFlight=null;this.notify();}
  }
  async flushLoop(save){
    this.lastError=null;
    try{
      for(;;){
        this.reload();
        const batch=Object.entries(this.entries).filter(([,e])=>e.dirty).map(([entry_id,e])=>({entry_id,...e}));
        if(!batch.length)break;
        this.notify();
        const rows=await save(batch);
        if(!Array.isArray(rows)||rows.length!==batch.length)throw new Error('云端未确认全部标记，稍后重试');
        this.reload();
        for(const sent of batch){
          const ack=rows.find(r=>r.entry_id===sent.entry_id);
          if(!ack||ack.status!==sent.status)throw new Error('云端返回状态不一致');
          const current=this.entries[sent.entry_id];
          if(current?.mutationId===sent.mutationId){current.dirty=false;current.serverUpdatedAt=ack.updated_at;}
        }
        this.persist();
      }
    }catch(error){this.lastError=error;this.notify();throw error;}
  }
}
