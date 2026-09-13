import test from 'node:test';
import assert from 'node:assert/strict';
import {requestEmailLink,setVerifiedPassword} from '../src/auth-actions.js';

test('anonymous email linking does not prematurely send a password',async()=>{
 let payload,options;const client={auth:{updateUser:async(a,b)=>{payload=a;options=b;return {error:null};}}};
 await requestEmailLink(client,' demo@example.invalid ','http://localhost:4173/');
 assert.deepEqual(payload,{email:'demo@example.invalid'});assert.equal(options.emailRedirectTo,'http://localhost:4173/');
});
test('anonymous or unverified users cannot set a permanent login password',async()=>{
 const client={auth:{updateUser:async()=>{throw new Error('Should not be called');}}};
 await assert.rejects(setVerifiedPassword(client,{email:'demo@example.invalid',is_anonymous:true},'test-only-password'));
 await assert.rejects(setVerifiedPassword(client,{email:'demo@example.invalid',is_anonymous:false},'test-only-password'));
});
test('verified account can set a password, without altering email or user id',async()=>{
 let payload;const client={auth:{updateUser:async p=>{payload=p;return {error:null};}}};
 await setVerifiedPassword(client,{email:'demo@example.invalid',email_confirmed_at:'2026-09-12T00:00:00Z',is_anonymous:false},'test-only-password');
 assert.deepEqual(payload,{password:'test-only-password'});
});
