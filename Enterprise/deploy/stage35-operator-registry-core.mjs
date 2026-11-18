// N35: independently approved, authority-signed Ed25519 operator key registry.
// Entirely offline. An approved exact registry SHA256 and exact revision are
// required to prevent serving an older, still-valid signed registry on rollback.
import crypto from 'node:crypto';
import {publicKeyPin,verifyAttestation} from './stage34-attestation-core.mjs';
import {sha256} from './stage33-receipt-core.mjs';
export class Stage35Error extends Error { constructor(code){super(code);this.code=code;} }
const deny=code=>{throw new Stage35Error(code);};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pin=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).sort().join('\0')===keys.slice().sort().join('\0');
const instant=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const anyKey=k=> k instanceof crypto.KeyObject && k.type==='public' ? k:crypto.createPublicKey(k);
const operatorFields=['key_id','public_key_spki_base64','public_key_spki_sha256','state','purpose',
  'valid_from_utc','valid_until_utc','revoked_at_utc'];
const payloadFields=['schema','revision','issued_at_utc','expires_at_utc','keys'];
const signedFields=['schema','algorithm','authority_spki_sha256','payload','signature_base64'];
const sig64=s=>typeof s==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(s)&&
  Buffer.from(s,'base64').length===64&&Buffer.from(s,'base64').toString('base64')===s;
function operatorKeyFromEntry(entry){
  if (!exact(entry,operatorFields)||!(/^[a-z0-9][a-z0-9._-]{2,39}$/).test(entry.key_id)||
      entry.purpose!=='SCOPED_MYSQL_RECEIPT_REVIEW'||
      !['ACTIVE','REVOKED'].includes(entry.state)||!pin(entry.public_key_spki_sha256)||
      !instant(entry.valid_from_utc)||!instant(entry.valid_until_utc)||
      Date.parse(entry.valid_until_utc)<=Date.parse(entry.valid_from_utc)||
      Date.parse(entry.valid_until_utc)-Date.parse(entry.valid_from_utc)>730*86400000||
      (entry.state==='ACTIVE'&&entry.revoked_at_utc!==null)||
      (entry.state==='REVOKED'&&(!instant(entry.revoked_at_utc)||
       Date.parse(entry.revoked_at_utc)<Date.parse(entry.valid_from_utc)))) deny('INVALID_OPERATOR_ENTRY');
  if (typeof entry.public_key_spki_base64!=='string'||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.public_key_spki_base64)) deny('INVALID_OPERATOR_KEY');
  const der=Buffer.from(entry.public_key_spki_base64,'base64');
  if (der.length>512||der.length<32||der.toString('base64')!==entry.public_key_spki_base64) deny('INVALID_OPERATOR_KEY');
  let key;
  try { key=crypto.createPublicKey({key:der,format:'der',type:'spki'}); }
  catch {deny('INVALID_OPERATOR_KEY');}
  if(key.asymmetricKeyType!=='ed25519'||publicKeyPin(key)!==entry.public_key_spki_sha256)
    deny('OPERATOR_PIN_MISMATCH');
  return key;
}
function checkPayload(payload){
  if(!exact(payload,payloadFields)||payload.schema!=='aaditech-stage35-operator-key-registry-payload-v1'||
     !Number.isSafeInteger(payload.revision)||payload.revision<1||payload.revision>999999999||
     !instant(payload.issued_at_utc)||!instant(payload.expires_at_utc)||
     Date.parse(payload.expires_at_utc)<=Date.parse(payload.issued_at_utc)||
     Date.parse(payload.expires_at_utc)-Date.parse(payload.issued_at_utc)>31*86400000||
     !Array.isArray(payload.keys)||payload.keys.length<1||payload.keys.length>32) deny('INVALID_REGISTRY_PAYLOAD');
  const ids=new Set(),pins=new Set();
  let previous='';
  for(const entry of payload.keys){
    operatorKeyFromEntry(entry);
    if(ids.has(entry.key_id)||pins.has(entry.public_key_spki_sha256)||
       entry.key_id<=previous) deny('DUPLICATE_OR_UNSORTED_KEYS');
    previous=entry.key_id;ids.add(entry.key_id);pins.add(entry.public_key_spki_sha256);
  }
}
export function signRegistry(draft,rootPrivateKey){
  checkPayload(draft);
  const key=rootPrivateKey instanceof crypto.KeyObject&&rootPrivateKey.type==='private'?
    rootPrivateKey:crypto.createPrivateKey(rootPrivateKey);
  if(key.asymmetricKeyType!=='ed25519') deny('ED25519_AUTHORITY_REQUIRED');
  const rootPin=publicKeyPin(crypto.createPublicKey(key));
  return {
    schema:'aaditech-stage35-signed-operator-key-registry-v1',
    algorithm:'Ed25519',
    authority_spki_sha256:rootPin,
    payload:draft,
    signature_base64:crypto.sign(null,Buffer.from(JSON.stringify(draft),'utf8'),key).toString('base64')
  };
}
export function verifyRegistry(rawRegistryBytes,rootPublic,approvedRootPin,approvedRegistrySha256,approvedRevision,now=new Date()){
  if(!Buffer.isBuffer(rawRegistryBytes)||rawRegistryBytes.length>65536||
     !pin(approvedRootPin)||!pin(approvedRegistrySha256)||
     sha256(rawRegistryBytes)!==approvedRegistrySha256) deny('REGISTRY_HASH_NOT_APPROVED');
  if(!Number.isSafeInteger(approvedRevision)||approvedRevision<1) deny('REGISTRY_REVISION_NOT_APPROVED');
  let registry;
  try{registry=JSON.parse(rawRegistryBytes.toString('utf8'));}catch{deny('INVALID_REGISTRY_JSON');}
  if(!exact(registry,signedFields)||registry.schema!=='aaditech-stage35-signed-operator-key-registry-v1'||
    registry.algorithm!=='Ed25519'||registry.authority_spki_sha256!==approvedRootPin||
    !sig64(registry.signature_base64))deny('INVALID_SIGNED_REGISTRY');
  checkPayload(registry.payload);
  if(registry.payload.revision!==approvedRevision)deny('REGISTRY_REVISION_NOT_APPROVED');
  if(!(now instanceof Date)||!Number.isFinite(now.getTime())||
    Date.parse(registry.payload.issued_at_utc)>now.getTime()+300000||
    Date.parse(registry.payload.expires_at_utc)<=now.getTime())deny('REGISTRY_EXPIRED_OR_FUTURE');
  let key;
  try{key=anyKey(rootPublic);}catch{deny('AUTHORITY_KEY_INVALID');}
  if(key.asymmetricKeyType!=='ed25519'||publicKeyPin(key)!==approvedRootPin)
    deny('AUTHORITY_KEY_NOT_APPROVED');
  const sig=Buffer.from(registry.signature_base64,'base64');
  if(!crypto.verify(null,Buffer.from(JSON.stringify(registry.payload),'utf8'),key,sig))
    deny('REGISTRY_SIGNATURE_INVALID');
  return Object.freeze({registry,registry_sha256:approvedRegistrySha256,
    authority_spki_sha256:approvedRootPin,revision:approvedRevision});
}
export function verifyActiveOperatorEvidence(input,attestation,verifiedRegistry,now=new Date()){
  if(!verifiedRegistry||!obj(verifiedRegistry.registry)||!obj(attestation)||
    !pin(attestation.public_key_spki_sha256))deny('INVALID_OPERATOR_ATTESTATION');
  const matches=verifiedRegistry.registry.payload.keys.filter(
    x=>x.public_key_spki_sha256===attestation.public_key_spki_sha256);
  if(matches.length!==1)deny('SIGNING_KEY_NOT_ENROLLED');
  const entry=matches[0];
  // Revocation is current-state and retroactive: historic signatures from a
  // revoked key are not accepted under the current approved registry.
  if(entry.state==='REVOKED')deny('SIGNING_KEY_REVOKED');
  const nowMs=now.getTime(),signedMs=Date.parse(attestation.payload?.issued_at_utc);
  if(!Number.isFinite(nowMs)||!Number.isFinite(signedMs)||
     signedMs<Date.parse(entry.valid_from_utc)||
     signedMs>=Date.parse(entry.valid_until_utc)||
     nowMs<Date.parse(entry.valid_from_utc)||
     nowMs>=Date.parse(entry.valid_until_utc))deny('SIGNING_KEY_OUTSIDE_VALIDITY');
  const key=operatorKeyFromEntry(entry);
  const signedResult=verifyAttestation(input,attestation,key,entry.public_key_spki_sha256,now);
  return Object.freeze({
    schema:'aaditech-stage35-key-lifecycle-verification-v1',
    registry_sha256:verifiedRegistry.registry_sha256,
    registry_revision:verifiedRegistry.revision,
    registry_authority_spki_sha256:verifiedRegistry.authority_spki_sha256,
    operator_key_id:entry.key_id,
    operator_public_key_spki_sha256:entry.public_key_spki_sha256,
    n34_signature_verified:signedResult.signature_verified,
    current_key_status:'ACTIVE_UNDER_APPROVED_REGISTRY',
    key_registry_validated:true,
    operator_legal_authorization_independently_pending:true,
    real_network_outage_verified:false,
    production_certified:false
  });
}
