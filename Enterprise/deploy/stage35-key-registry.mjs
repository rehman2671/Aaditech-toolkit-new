#!/usr/bin/env node
// N35 offline key registry publisher and evidence checker. No network/DB.
// Private authority key and independent approvals must be externally provided.
import fs from 'node:fs';
import path from 'node:path';
import {signRegistry,verifyRegistry,verifyActiveOperatorEvidence,Stage35Error} from './stage35-operator-registry-core.mjs';
const deny=x=>{throw new Stage35Error(x);};
function parse(argv){
 const mode=argv.shift();
 if(!['issue','check'].includes(mode)||argv.length%2)deny('ARGUMENTS_INVALID');
 const v={};
 for(let i=0;i<argv.length;i+=2){
  if(!/^--[a-z0-9-]+$/.test(argv[i])||v[argv[i]]||!argv[i+1])deny('ARGUMENTS_INVALID');
  v[argv[i]]=argv[i+1];
 }
 const required=mode==='issue'?
  ['--draft','--authority-private-key','--output']:
  ['--registry','--authority-public-key','--approved-root-spki-sha256','--approved-registry-sha256',
   '--approved-revision','--offline','--recovered','--receipt','--attestation'];
 if(Object.keys(v).length!==required.length||required.some(k=>!v[k]))deny('ARGUMENTS_INVALID');
 return {mode,v};
}
function read(file,secret=false){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>65536)deny('UNSAFE_INPUT');
 if(secret&&process.platform!=='win32'&&(st.mode&0o077)!==0)deny('AUTHORITY_KEY_PERMISSIONS');
 return fs.readFileSync(file);
}
function evidence(v){
 const offlineBytes=read(v['--offline']),recoveredBytes=read(v['--recovered']);
 const receiptBytes=read(v['--receipt']);
 return {offlineBytes,recoveredBytes,receiptBytes,
  offline:JSON.parse(offlineBytes.toString('utf8')),
  recovered:JSON.parse(recoveredBytes.toString('utf8')),
  receipt:JSON.parse(receiptBytes.toString('utf8'))};
}
async function main(){
 const {mode,v}=parse(process.argv.slice(2));
 if(mode==='issue'){
  if(fs.existsSync(v['--output'])||path.resolve(v['--authority-private-key'])===path.resolve(v['--output']))
    deny('REFUSING_OVERWRITE');
  const draft=JSON.parse(read(v['--draft']).toString('utf8'));
  const passphrase=process.env.N35_AUTHORITY_KEY_PASSPHRASE||undefined;
  const key={key:read(v['--authority-private-key'],true),format:'pem',passphrase};
  const registry=signRegistry(draft,key);
  fs.writeFileSync(v['--output'],JSON.stringify(registry,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('N35 ISSUED: signed key registry; independent root+hash+revision approval still required.');
 } else {
  const revisionText=v['--approved-revision'];
  if(!/^[1-9][0-9]{0,8}$/.test(revisionText))deny('REGISTRY_REVISION_NOT_APPROVED');
  const reg=verifyRegistry(read(v['--registry']),read(v['--authority-public-key']),
    v['--approved-root-spki-sha256'],v['--approved-registry-sha256'],
    Number(revisionText));
  const record=JSON.parse(read(v['--attestation']).toString('utf8'));
  const result=verifyActiveOperatorEvidence(evidence(v),record,reg);
  if(!result.n34_signature_verified||result.production_certified!==false)deny('UNVERIFIED_EVIDENCE');
  console.log('N35 VERIFIED: independently pinned current registry and active operator signature; customer signoff pending.');
 }
}
main().catch(e=>{
 console.error('N35 BLOCKED: '+(e instanceof Stage35Error?e.code:'UNVERIFIED_OR_UNAVAILABLE'));
 process.exitCode=1;
});
