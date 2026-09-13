import test from 'node:test';
import assert from 'node:assert/strict';
import {StateStore} from '../src/state-store.js';
import {comparePersonal,isMuted} from '../src/catalog-model.js';
const A='rec-'+'a'.repeat(20),B='rec-'+'b'.repeat(20),C='soe-'+'c'.repeat(20);
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const ack=batch=>batch.map(e=>({entry_id:e.entry_id,status:e.status,updated_at:new Date().toISOString()}));

test('guest states persist across refresh; both muted states can be restored',()=>{
 const disk=storage(),s=new StateStore(disk);s.set(A,'applied');s.set(B,'uninterested');
 const reloaded=new StateStore(disk);assert.equal(reloaded.status(A),'applied');assert.equal(reloaded.status(B),'uninterested');
 assert.ok(isMuted(reloaded.status(A)));assert.ok(isMuted(reloaded.status(B)));
 reloaded.set(A,'active');assert.equal(new StateStore(disk).status(A),'active');assert.equal(reloaded.pendingCount(),0);
});
test('each identity and each page has independent state',()=>{
 const disk=storage(),guest=new StateStore(disk),one=new StateStore(disk,'user-one'),two=new StateStore(disk,'user-two');
 guest.set(A,'applied');one.set(A,'uninterested');one.set(C,'applied');
 assert.equal(two.status(A),'active');assert.equal(one.status(A),'uninterested');assert.equal(guest.status(C),'active');
});
test('muted cards are always behind normal cards, independent of primary sort',()=>{
 const items=[{id:A,n:0},{id:B,n:1},{id:C,n:2}],states={[A]:{status:'applied'},[B]:{status:'uninterested'}};
 assert.deepEqual([...items].sort((a,b)=>comparePersonal(a,b,states)||a.n-b.n).map(x=>x.id),[C,A,B]);
 states[A].status='active';assert.deepEqual([...items].sort((a,b)=>comparePersonal(a,b,states)||a.n-b.n).map(x=>x.id),[A,C,B]);
});
test('invalid states and forged card IDs are rejected',()=>{
 const s=new StateStore(storage());assert.throws(()=>s.set(A,'deleted'));assert.throws(()=>s.set('__proto__','applied'));
});
test('network failure retains durable pending operations, retry acknowledges them',async()=>{
 const disk=storage(),s=new StateStore(disk,'user-one');s.set(A,'applied');
 await assert.rejects(s.flush(async()=>{throw new Error('offline');}));assert.equal(s.pendingCount(),1);
 const next=new StateStore(disk,'user-one');await next.flush(async batch=>ack(batch));
 assert.equal(next.pendingCount(),0);assert.equal(new StateStore(disk,'user-one').status(A),'applied');
});
test('a stale response cannot erase a newer quick click',async()=>{
 const s=new StateStore(storage(),'user-one');s.set(A,'applied');let release;let count=0;const sent=[];
 const promise=s.flush(async batch=>{count++;sent.push(batch.map(x=>x.status));if(count===1)await new Promise(resolve=>release=resolve);return ack(batch);});
 s.set(A,'uninterested');release();await promise;
 assert.deepEqual(sent,[['applied'],['uninterested']]);assert.equal(s.status(A),'uninterested');assert.equal(s.pendingCount(),0);
});
test('partial server acknowledgement never claims success',async()=>{
 const s=new StateStore(storage(),'user-one');s.set(A,'applied');
 await assert.rejects(s.flush(async()=>[]));assert.equal(s.pendingCount(),1);
});
test('remote refresh preserves unsynced local changes',()=>{
 const s=new StateStore(storage(),'user-one');s.set(A,'uninterested');
 s.acceptRemote([{entry_id:A,status:'applied',updated_at:'2026-09-12T00:00:00Z'},{entry_id:B,status:'applied',updated_at:'2026-09-12T00:00:00Z'}]);
 assert.equal(s.status(A),'uninterested');assert.equal(s.status(B),'applied');assert.equal(s.pendingCount(),1);
});
test('same-browser tabs see latest local writes',()=>{
 const disk=storage(),a=new StateStore(disk),b=new StateStore(disk);a.set(A,'applied');b.reload();assert.equal(b.status(A),'applied');
 b.set(A,'active');a.reload();assert.equal(a.status(A),'active');
});
test('blocked local storage is surfaced, rather than reporting persistence',()=>{
 const s=new StateStore({getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}});
 s.set(A,'applied');assert.equal(s.storageError,true);assert.equal(s.status(A),'applied');
});

test('two devices using the same account converge through cloud roundtrips',async()=>{
 const deviceA=new StateStore(storage(),'same-user'),deviceB=new StateStore(storage(),'same-user');
 const cloud=new Map();let tick=0;
 const save=async batch=>batch.map(e=>{
   const row={entry_id:e.entry_id,status:e.status,updated_at:new Date(Date.UTC(2026,8,13,0,0,++tick)).toISOString()};
   cloud.set(e.entry_id,row);return row;
 });
 const snapshot=()=>[...cloud.values()];
 deviceA.set(A,'applied');await deviceA.flush(save);
 deviceB.acceptRemote(snapshot());assert.equal(deviceB.status(A),'applied');
 deviceB.set(A,'uninterested');await deviceB.flush(save);
 deviceA.acceptRemote(snapshot());assert.equal(deviceA.status(A),'uninterested');
 assert.equal(deviceA.pendingCount(),0);assert.equal(deviceB.pendingCount(),0);
});
