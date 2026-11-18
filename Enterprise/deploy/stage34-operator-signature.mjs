#!/usr/bin/env node
// Stage N34 offline Ed25519 operator signing / independent pinned verification.
// No auto-generated private keys. No API, database or network activity.
import fs from 'node:fs';
import path from 'node:path';
import {signAttestation,verifyAttestation,Stage34Error} from './stage34-attestation-core.mjs';

const deny=code=>{throw new Stage34Error(code);};
function options(argv){
  const mode=argv.shift();
  if (mode!=='sign' && mode!=='verify') deny('MODE_REQUIRED');
  if (argv.length%2!==0) deny('INVALID_ARGUMENTS');
  const values={};
  for (let i=0;i<argv.length;i+=2) {
    const k=argv[i],v=argv[i+1];
    if (!/^--[a-z-]+$/.test(k) || values[k] || !v) deny('INVALID_ARGUMENTS');
    values[k]=v;
  }
  const common=['--offline','--recovered','--receipt'];
  const required=mode==='sign'?
    [...common,'--private-key','--output']:
    [...common,'--attestation','--trusted-public-key','--approved-spki-sha256'];
  if (Object.keys(values).length!==required.length ||
      required.some(k=>!values[k])) deny('INVALID_ARGUMENTS');
  if (mode==='verify' && !/^[a-f0-9]{64}$/.test(values['--approved-spki-sha256'])) deny('PIN_REQUIRED');
  return {mode,values};
}
function read(p,privateKey=false){
  const stat=fs.lstatSync(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size===0 || stat.size>65536) deny('INVALID_EVIDENCE_FILE');
  if (privateKey && process.platform!=='win32' && (stat.mode & 0o077)!==0) deny('PRIVATE_KEY_PERMISSIONS');
  return fs.readFileSync(p);
}
async function main(){
  const {mode,values}=options(process.argv.slice(2));
  const offlineBytes=read(values['--offline']);
  const recoveredBytes=read(values['--recovered']);
  const receiptBytes=read(values['--receipt']);
  const evidence={
    offlineBytes,recoveredBytes,receiptBytes,
    offline:JSON.parse(offlineBytes.toString('utf8')),
    recovered:JSON.parse(recoveredBytes.toString('utf8')),
    receipt:JSON.parse(receiptBytes.toString('utf8'))
  };
  if (mode==='sign'){
    if (fs.existsSync(values['--output'])) deny('REFUSING_OVERWRITE');
    const privatePath=path.resolve(values['--private-key']);
    if (path.resolve(values['--output'])===privatePath) deny('UNSAFE_OUTPUT');
    // Encrypted PEM is supported by a passphrase from an operator's vault.
    // NEVER log key material or passphrase; never generate a key in production.
    const privatePem=read(privatePath,true);
    const key={key:privatePem,format:'pem',passphrase:process.env.N34_SIGNING_KEY_PASSPHRASE || undefined};
    const attestation=signAttestation(evidence,key);
    fs.writeFileSync(values['--output'],JSON.stringify(attestation,null,2)+'\n',
      {flag:'wx',mode:0o600});
    console.log('N34 SIGNED: scoped receipt/local evidence digests only; no production approval issued.');
  } else {
    const attest=JSON.parse(read(values['--attestation']).toString('utf8'));
    const trustedPublic=read(values['--trusted-public-key']);
    verifyAttestation(evidence,attest,trustedPublic,values['--approved-spki-sha256']);
    console.log('N34 VERIFIED: independently pinned Ed25519 report signature; operator authorization/production still pending.');
  }
}
main().catch(e=>{
  // Never echo filenames, DB credentials, tenant/device IDs or private keys.
  console.error('N34 BLOCKED: '+(e instanceof Stage34Error?e.code:'UNVERIFIED_OR_UNAVAILABLE'));
  process.exitCode=1;
});
