// Fixed GET-only local application readiness check. No DNS, public fallback,
// redirects, tokens, trust-store edits, or arbitrary paths. Pin both root and
// direct leaf on every independent connection, not a prior handshake receipt.
import {request} from 'node:https';
import {X509Certificate,createHash} from 'node:crypto';
import {validatePrivateTlsInputs} from './private-lan-tls-preflight.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const fail=()=>{throw Error('PRIVATE_LAN_HTTPS_UNCONFIRMED')};
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const hash=x=>createHash('sha256').update(x).digest('hex');
function get(target,root,leafPin,path,expected){
 return new Promise((resolve,reject)=>{
  let req,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(req)req.destroy();error?reject(Error('PRIVATE_LAN_HTTPS_UNCONFIRMED')):resolve(value)};
  const timer=setTimeout(()=>finish(true),8000);
  function verifyPeer(socket){
   const leaf=socket?.getPeerX509Certificate(),now=Date.now();
   if(!socket?.authorized||socket.remoteAddress!==target.address||socket.remotePort!==target.port||!leaf||leaf.ca||hash(leaf.raw)!==leafPin||!leaf.checkIssued(root)||!leaf.verify(root.publicKey)||!leaf.checkHost(target.hostname,{subject:'never',wildcards:false})||!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')||!(Date.parse(leaf.validFrom)<=now&&now<=Date.parse(leaf.validTo)))fail();
  }
  try{
   req=request({host:target.address,port:target.port,servername:target.hostname,method:'GET',path,ca:target.rootPem,minVersion:'TLSv1.2',rejectUnauthorized:true,agent:false,headers:{Host:target.hostname,Accept:'application/json',Connection:'close'},checkServerIdentity:(_host,peer)=>{
    try{const leaf=new X509Certificate(peer.raw);if(hash(leaf.raw)!==leafPin||leaf.ca||!leaf.checkHost(target.hostname,{subject:'never',wildcards:false})||!leaf.checkIssued(root)||!leaf.verify(root.publicKey)||!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1'))fail();return undefined}catch{return Error('PRIVATE_LAN_HTTPS_UNCONFIRMED')}
   }},res=>{
    try{verifyPeer(res.socket);if(res.statusCode!==expected)fail();if(expected===200&&!/^application\/json(?:;|$)/i.test(String(res.headers['content-type']??'')))fail()}catch{return finish(true)}
    const chunks=[];let n=0;
    res.on('data',chunk=>{n+=chunk.length;if(n>16384)return finish(true);chunks.push(chunk)});
    res.once('aborted',()=>finish(true));res.once('error',()=>finish(true));
    res.once('end',()=>{
     try{
      if(!res.complete)fail();
      if(expected===404)return finish(false,null);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(text);finish(false,JSON.parse(text));
     }catch{finish(true)}
    });
   });
   req.once('error',()=>finish(true));req.end();
  }catch{finish(true)}
 });
}
export async function probePrivateLanHttps(input,assertHeld){return probe(input,assertHeld,false)}
export async function probeExistingPrivateLanHttps(input,assertHeld){return probe(input,assertHeld,true)}
async function probe(input,assertHeld,existing){
 if(!exact(input,['confirmation','address','hostname','port','rootPem','trustedRootSha256','trustedLeafSha256'])||input.confirmation!==(existing?'PROBE_PINNED_EXISTING_PRIVATE_LAN_HTTPS_ONLY':'PROBE_PINNED_PRIVATE_LAN_HTTPS_ONLY')||typeof assertHeld!=='function'||typeof input.trustedLeafSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.trustedLeafSha256)||!/[a-z]/.test(input.hostname))fail();
 const target=validatePrivateTlsInputs(input),root=new X509Certificate(target.rootPem),pin=input.trustedLeafSha256;
 await assertHeld();
 const health=await get(target,root,pin,'/healthz',200);await assertHeld();
 if(health?.status!=='ok'||health.components?.database!=='HEALTHY')fail();
 const setup=await get(target,root,pin,'/api/v1/setup/status',200);await assertHeld();
 if(!setup||setup.server_host!==target.hostname||!(setup.setup_complete===false&&setup.bootstrap_profile==='clean_install_v1'||existing&&setup.setup_complete===true&&!Object.hasOwn(setup,'bootstrap_profile')))fail();
 for(const path of ['/metrics','/docs','/openapi.json']){await get(target,root,pin,path,404);await assertHeld()}
 return Object.freeze({schema_version:1,root_sha256:target.fingerprint,leaf_sha256:pin,exact_leaf_verified:true,application_readiness_verified:true,clean_setup_verified:setup.setup_complete===false,...(existing?{setup_state_observed:setup.setup_complete?'COMPLETED':'CLEAN_FIRST_RUN'}:{}),private_routes_denied:true,system_trust_verified:false,installation_authorized:false,production_accepted:false});
}
