import {describe,it,expect} from 'vitest';
import crypto from 'node:crypto';
import {publicKeyPin} from '../../Enterprise/deploy/stage34-attestation-core.mjs';
import {sha256} from '../../Enterprise/deploy/stage33-receipt-core.mjs';
import {signRegistry,verifyRegistry,verifyActiveOperatorEvidence} from '../../Enterprise/deploy/stage35-operator-registry-core.mjs';

function fixture(){
 const authority=crypto.generateKeyPairSync('ed25519');
 const operator=crypto.generateKeyPairSync('ed25519');
 const next=crypto.generateKeyPairSync('ed25519');
 const now=new Date(),nowMs=now.getTime(),root=publicKeyPin(authority.publicKey);
 const timestamp=new Date(nowMs).toISOString();
 const entry=(k,id,state='ACTIVE')=>({
  key_id:id,public_key_spki_base64:k.export({format:'der',type:'spki'}).toString('base64'),
  public_key_spki_sha256:publicKeyPin(k),purpose:'SCOPED_MYSQL_RECEIPT_REVIEW',
  valid_from_utc:new Date(nowMs-3600000).toISOString(),
  valid_until_utc:new Date(nowMs+10*86400000).toISOString(),
  state,revoked_at_utc:state==='REVOKED'?timestamp:null
 });
 const draft={schema:'aaditech-stage35-operator-key-registry-payload-v1',
  revision:4,issued_at_utc:timestamp,expires_at_utc:new Date(nowMs+2*86400000).toISOString(),
  keys:[entry(operator.publicKey,'ops-primary-2026')]};
 const signed=signRegistry(draft,authority.privateKey),bytes=Buffer.from(JSON.stringify(signed));
 return {authority,operator,next,draft,signed,bytes,root,now,entry};
}
describe('N35 Ed25519 authority signed registry: rotation and emergency revocation',()=>{
 it('approves only exact SHA, exact revision and independently pinned authority',()=>{
  const f=fixture(),sha=sha256(f.bytes);
  expect(verifyRegistry(f.bytes,f.authority.publicKey,f.root,sha,4,f.now).revision).toBe(4);
  expect(()=>verifyRegistry(f.bytes,f.authority.publicKey,f.root,'a'.repeat(64),4,f.now))
   .toThrow('REGISTRY_HASH_NOT_APPROVED');
  expect(()=>verifyRegistry(f.bytes,f.authority.publicKey,f.root,sha,3,f.now))
   .toThrow('REGISTRY_REVISION_NOT_APPROVED');
  const other=crypto.generateKeyPairSync('ed25519');
  expect(()=>verifyRegistry(f.bytes,other.publicKey,f.root,sha,4,f.now))
   .toThrow('AUTHORITY_KEY_NOT_APPROVED');
  expect(()=>verifyRegistry(f.bytes,f.authority.publicKey,publicKeyPin(other.publicKey),sha,4,f.now))
   .toThrow('INVALID_SIGNED_REGISTRY');
  expect(()=>verifyRegistry(f.bytes,f.authority.publicKey,f.root,sha,4,new Date(f.now.getTime()+3*86400000)))
   .toThrow('REGISTRY_EXPIRED_OR_FUTURE');
 });
 it('blocks mutated registry even if attacker can adjust own SHA, and stale approval',()=>{
  const f=fixture();
  const mutated={...f.signed,payload:{...f.draft,revision:5}};
  const newBytes=Buffer.from(JSON.stringify(mutated));
  expect(()=>verifyRegistry(newBytes,f.authority.publicKey,f.root,sha256(newBytes),5,f.now))
    .toThrow('REGISTRY_SIGNATURE_INVALID');
  const rotated={...f.draft,revision:5,keys:[
   f.entry(f.next.publicKey,'ops-next-2026'),
   f.entry(f.operator.publicKey,'ops-primary-2026','REVOKED')
  ]};
  const newer=Buffer.from(JSON.stringify(signRegistry(rotated,f.authority.privateKey)));
  expect(verifyRegistry(newer,f.authority.publicKey,f.root,sha256(newer),5,f.now).revision).toBe(5);
  expect(()=>verifyRegistry(f.bytes,f.authority.publicKey,f.root,sha256(f.bytes),5,f.now))
    .toThrow('REGISTRY_REVISION_NOT_APPROVED');
 });
 it('refuses duplicate IDs, duplicate pins, wrong purpose and invalid operator key',()=>{
  const f=fixture();
  expect(()=>signRegistry({...f.draft,keys:[f.draft.keys[0],f.draft.keys[0]]},f.authority.privateKey))
    .toThrow('DUPLICATE_OR_UNSORTED_KEYS');
  expect(()=>signRegistry({...f.draft,keys:[{...f.draft.keys[0],purpose:'ROOT_ADMIN'}]},f.authority.privateKey))
    .toThrow('INVALID_OPERATOR_ENTRY');
  expect(()=>signRegistry({...f.draft,keys:[{...f.draft.keys[0],public_key_spki_sha256:'f'.repeat(64)}]},f.authority.privateKey))
    .toThrow('OPERATOR_PIN_MISMATCH');
  expect(()=>signRegistry({...f.draft,expires_at_utc:new Date(f.now.getTime()+40*86400000).toISOString()},
    f.authority.privateKey)).toThrow('INVALID_REGISTRY_PAYLOAD');
 });
 it('rejects revoked operator before trusting original N34 evidence and scope',()=>{
  const f=fixture();
  const revocation={...f.draft,revision:5,keys:[
   f.entry(f.operator.publicKey,'ops-primary-2026','REVOKED')]};
  const revoked=Buffer.from(JSON.stringify(signRegistry(revocation,f.authority.privateKey)));
  const registry=verifyRegistry(revoked,f.authority.publicKey,f.root,sha256(revoked),5,f.now);
  const fake={public_key_spki_sha256:publicKeyPin(f.operator.publicKey),
   payload:{issued_at_utc:f.draft.issued_at_utc}};
  expect(()=>verifyActiveOperatorEvidence({},fake,registry,f.now))
    .toThrow('SIGNING_KEY_REVOKED');
  const unknown={...fake,public_key_spki_sha256:publicKeyPin(f.next.publicKey)};
  expect(()=>verifyActiveOperatorEvidence({},unknown,registry,f.now))
    .toThrow('SIGNING_KEY_NOT_ENROLLED');
 });
});
