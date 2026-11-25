// Explicit foreground LAN access, TLS passthrough only. No Docker port
// publication, TLS termination, arbitrary destination, or firewall mutation.
// Trusted operator independently authenticates both certificate fingerprints,
// the private bridge endpoint, and the selected NIC/subnet before launch.
import {createServer,createConnection,isIPv4} from 'node:net';
import {networkInterfaces} from 'node:os';
import {validatePrivateTlsInputs} from './private-lan-tls-preflight.mjs';
import {probePrivateLanHttps} from './probe-private-lan-https.mjs';
import {probePrivateLanHealth} from './private-lan-health.mjs';
import {inspectLocalInstallationIdentity} from './installation-identity-store-posix.mjs';
import {isAbsolute,resolve} from 'node:path';
const fail=()=>{throw Error('PRIVATE_LAN_FORWARDER_UNCONFIRMED')};
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const pathOk=p=>typeof p==='string'&&p.length<=4096&&isAbsolute(p)&&resolve(p)===p&&!/[\x00-\x1f\x7f]/.test(p);
const n=ip=>{if(typeof ip!=='string'||!isIPv4(ip))fail();return ip.split('.').reduce((a,b)=>a*256+Number(b),0)>>>0};
function privateIPv4(ip){
 if(typeof ip!=='string'||!isIPv4(ip))return false;
 const [a,b]=ip.split('.').map(Number);
 return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
const dotted=x=>[24,16,8,0].map(i=>(x>>>i)&255).join('.');
export function parsePrivateSubnet(value){
 if(typeof value!=='string'||value.length>18||!/^[0-9.]+\/(?:[89]|[12][0-9]|30)$/.test(value))fail();
 const [address,bits]=value.split('/'),prefix=Number(bits),mask=(0xffffffff<<(32-prefix))>>>0,first=n(address),last=(first|(~mask>>>0))>>>0;
 if(!privateIPv4(address)||!privateIPv4(dotted(last))||((first&mask)>>>0)!==first)fail();
 return Object.freeze({cidr:value,first,last,prefix,mask});
}
export function sourceInApprovedSubnet(ip,subnet){
 if(!privateIPv4(ip))return false;
 const value=n(ip);return value>subnet.first&&value<subnet.last;
}
export function selectApprovedLanInterface(policy,interfaces){
 if(!interfaces||typeof interfaces!=='object'||!Object.hasOwn(interfaces,policy.interfaceName)||!Array.isArray(interfaces[policy.interfaceName]))fail();
 const matches=interfaces[policy.interfaceName].filter(x=>x&&(x.family==='IPv4'||x.family===4)&&x.address===policy.bindAddress&&x.internal===false);
 if(matches.length!==1)fail();
 const row=matches[0],cidr=typeof row.cidr==='string'?row.cidr.split('/'):[],bits=cidr.length===2?Number(cidr[1]):NaN;
 if(cidr[0]!==row.address||!Number.isInteger(bits)||bits<8||bits>30||String(bits)!==cidr[1])fail();
 const mask=(0xffffffff<<(32-bits))>>>0,subnet=parsePrivateSubnet(dotted((n(row.address)&mask)>>>0)+'/'+bits);
 if(row.netmask!==dotted(mask)||!sourceInApprovedSubnet(policy.bindAddress,subnet)||policy.subnet.first<subnet.first||policy.subnet.last>subnet.last||!sourceInApprovedSubnet(policy.bindAddress,policy.subnet))fail();
 const aliases=Object.values(interfaces).flat().filter(x=>x&&(x.family==='IPv4'||x.family===4)&&x.address===policy.bindAddress);
 if(aliases.length!==1)fail();
 return Object.freeze({interfaceName:policy.interfaceName,address:row.address,cidr:row.cidr,netmask:row.netmask,mac:row.mac});
}
export function validatePrivateLanForwarderPolicy(input){
 if(!exact(input,['confirmation','interfaceName','bindAddress','clientSubnet','ingressAddress','hostname','rootPem','trustedRootSha256','trustedLeafSha256','identity'])||input.confirmation!=='RUN_PINNED_PRIVATE_LAN_FORWARDER_ONLY_EXCLUSIVE_OPERATOR_CUSTODY'||typeof input.interfaceName!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$/.test(input.interfaceName)||/^(lo$|docker|br-|veth)/.test(input.interfaceName)||!privateIPv4(input.bindAddress)||!privateIPv4(input.ingressAddress)||input.bindAddress===input.ingressAddress||!hex(input.trustedRootSha256)||!hex(input.trustedLeafSha256)||typeof input.hostname!=='string'||!/[a-z]/.test(input.hostname))fail();
 const i=input.identity;
 if(!exact(i,['confirmation','directoryPath','expectedInstallationId','expectedIdentitySha256'])||i.confirmation!=='INSPECT_PINNED_IDENTITY_STORE_ONLY'||!pathOk(i.directoryPath)||!hex(i.expectedIdentitySha256)||typeof i.expectedInstallationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(i.expectedInstallationId))fail();
 const subnet=parsePrivateSubnet(input.clientSubnet);
 if(!sourceInApprovedSubnet(input.bindAddress,subnet)||n(input.ingressAddress)>=subnet.first&&n(input.ingressAddress)<=subnet.last)fail();
 validatePrivateTlsInputs({address:input.ingressAddress,hostname:input.hostname,port:443,rootPem:input.rootPem,trustedRootSha256:input.trustedRootSha256});
 return Object.freeze({...input,identity:Object.freeze({...i}),subnet});
}
export async function startPrivateLanForwarder(input){
 const p=validatePrivateLanForwarderPolicy(input);
 if(process.platform!=='linux'||process.geteuid?.()!==0)fail();
 const selected=selectApprovedLanInterface(p,networkInterfaces());
 async function guard(){
  if(JSON.stringify(selectApprovedLanInterface(p,networkInterfaces()))!==JSON.stringify(selected))fail();
  await inspectLocalInstallationIdentity(p.identity);
 }
 const target={address:p.ingressAddress,hostname:p.hostname,port:443,rootPem:p.rootPem,trustedRootSha256:p.trustedRootSha256,trustedLeafSha256:p.trustedLeafSha256};
 // Initial commissioning requires the clean first-run setup marker. Existing
 // installations must use a separately reviewed reconfiguration procedure.
 await guard();await probePrivateLanHttps({confirmation:'PROBE_PINNED_PRIVATE_LAN_HTTPS_ONLY',...target},guard);await guard();
 const sockets=new Set(),maxConnections=64,idleMs=60000,connectMs=5000;
 let server,timer,stopping=false,checking=false,resolveClosed,accepting=false;
 const closed=new Promise(ok=>{resolveClosed=ok});
 function stop(){
  if(stopping)return closed;stopping=true;accepting=false;clearInterval(timer);
  for(const s of sockets)s.destroy();
  if(server?.listening)server.close(()=>resolveClosed());else resolveClosed();
  return closed;
 }
 server=createServer({pauseOnConnect:true},client=>{
  if(stopping||!accepting||client.localAddress!==p.bindAddress||client.localPort!==443||!sourceInApprovedSubnet(client.remoteAddress,p.subnet)||sockets.size>=maxConnections*2){client.destroy();return}
  try{if(JSON.stringify(selectApprovedLanInterface(p,networkInterfaces()))!==JSON.stringify(selected)){client.destroy();void stop();return}}catch{client.destroy();void stop();return}
  const upstream=createConnection({host:p.ingressAddress,port:443,family:4});
  sockets.add(client);sockets.add(upstream);
  const kill=()=>{clearTimeout(timeout);client.destroy();upstream.destroy()};
  const timeout=setTimeout(kill,connectMs);
  for(const s of [client,upstream]){
   s.setTimeout(idleMs,kill);s.once('error',kill);s.once('close',()=>{sockets.delete(s);kill()});
  }
  upstream.once('connect',()=>{
   clearTimeout(timeout);
   if(upstream.remoteAddress!==p.ingressAddress||upstream.remotePort!==443||stopping){kill();return}
   client.pipe(upstream);upstream.pipe(client);client.resume();
  });
 });
 server.maxConnections=maxConnections;
 try{
  await new Promise((ok,no)=>{server.once('error',no);server.listen({host:p.bindAddress,port:443,exclusive:true,backlog:64},()=>{server.removeListener('error',no);ok()})});
  server.on('error',()=>{void stop()});
  const bound=server.address();if(!bound||bound.address!==p.bindAddress||bound.port!==443||bound.family!=='IPv4')fail();
  accepting=true;
  const receipt=await probePrivateLanHttps({confirmation:'PROBE_PINNED_PRIVATE_LAN_HTTPS_ONLY',...target,address:p.bindAddress},guard);
  if(!receipt.application_readiness_verified||!receipt.exact_leaf_verified||!receipt.private_routes_denied)fail();
  await guard();
  // Health after setup is intentionally not tied to setup_complete=false.
  // Failure stops the foreground listener; no auto-restart or DNS fallback.
  timer=setInterval(async()=>{
   if(stopping||checking)return;checking=true;
   try{await guard();await probePrivateLanHealth({confirmation:'PROBE_PINNED_PRIVATE_LAN_HEALTH_ONLY',...target});await guard()}catch{void stop()}finally{checking=false}
  },15000);
  return Object.freeze({receipt:Object.freeze({schema_version:1,private_listener_verified:true,private_subnet_restricted:true,tls_passthrough:true,local_https_verified:true,remote_client_verified:false,firewall_verified:false,host_ports_published_by_docker:false,system_service_installed:false,production_accepted:false}),close:stop,closed});
 }catch{await stop();fail()}
}
