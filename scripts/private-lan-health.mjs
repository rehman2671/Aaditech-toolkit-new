// Actual local HTTPS health observation on the same pinned TLS connection.
// No public DNS, redirects, bearer, cookies, trust-store changes or repair.
import {request} from 'node:https';
import {isIP} from 'node:net';
import {createHash,X509Certificate} from 'node:crypto';
import {validatePrivateTlsInputs} from './private-lan-tls-preflight.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const fail=()=>{throw Error('PRIVATE_LAN_HEALTH_UNVERIFIED')};
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const fields=['confirmation','address','hostname','port','rootPem','trustedRootSha256','trustedLeafSha256'];
export function verifyHealthBody(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16384)fail();
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 rejectDuplicateJsonKeys(raw);
 const d=JSON.parse(raw);
 if(!d||Object.getPrototypeOf(d)!==Object.prototype||d.status!=='ok'||!d.components||Object.getPrototypeOf(d.components)!==Object.prototype||d.components.database!=='HEALTHY')fail();
 return true;
}
export async function probePrivateLanHealth(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==fields.length||!fields.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},'value'))||input.confirmation!=='PROBE_PINNED_PRIVATE_LAN_HEALTH_ONLY'||!digest(input.trustedLeafSha256))fail();
 const p={...input},target=validatePrivateTlsInputs(p);
 return new Promise((resolve,reject)=>{
  let req,settled=false,verified=false,tlsVersion=null;
  const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);req?.destroy();err?reject(Error('PRIVATE_LAN_HEALTH_UNVERIFIED')):resolve(Object.freeze(result))};
  const timer=setTimeout(()=>finish(true),10000);
  try{
   req=request({host:target.address,port:target.port,path:'/healthz',method:'GET',agent:false,
    servername:isIP(target.hostname)?'':target.hostname,ca:target.rootPem,minVersion:'TLSv1.2',rejectUnauthorized:true,
    headers:{Host:target.hostname+(target.port===443?'':':'+target.port),Accept:'application/json',Connection:'close'},
    checkServerIdentity:(_name,peer)=>{try{
     const leaf=new X509Certificate(peer.raw),now=Date.now(),match=isIP(target.hostname)?leaf.checkIP(target.hostname):leaf.checkHost(target.hostname,{subject:'never',wildcards:false});
     if(leaf.ca||!match||!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')||!(Date.parse(leaf.validFrom)<=now&&now<=Date.parse(leaf.validTo))||createHash('sha256').update(leaf.raw).digest('hex')!==p.trustedLeafSha256)return Error('PRIVATE_LEAF_PIN_MISMATCH');
     verified=true;return undefined;
    }catch{return Error('PRIVATE_LEAF_PIN_MISMATCH')}}
   },res=>{
    if(!verified||!res.socket.authorized||res.statusCode!==200||typeof res.headers['content-type']!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers['content-type'])||res.headers['content-encoding']!==undefined){res.destroy();finish(true);return}
    tlsVersion=res.socket.getProtocol();
    const parts=[];let n=0;
    res.on('data',b=>{n+=b.length;if(n>16384){res.destroy();finish(true)}else parts.push(b)});
    res.on('aborted',()=>finish(true));res.on('error',()=>finish(true));
    res.on('end',()=>{try{if(!res.complete||!verifyHealthBody(Buffer.concat(parts)))fail();finish(false,{schema_version:1,root_sha256:target.fingerprint,leaf_sha256:p.trustedLeafSha256,tls_version:tlsVersion,chain_verified:true,exact_san_verified:true,server_auth_eku_verified:true,leaf_pin_verified:true,api_health_observed:true,database_health_reported:true,database_identity_verified:false,system_trust_verified:false,revocation_verified:false,installation_authorized:false,production_accepted:false})}catch{finish(true)}});
   });
   req.on('error',()=>finish(true));req.end();
  }catch{finish(true)}
 });
}
