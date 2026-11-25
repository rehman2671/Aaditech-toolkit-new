// Real isolated network namespace; only disposable GitHub-hosted Linux CI.
// No customer NIC, firewall, public route, or persistent service modification.
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {startPrivateLanForwarder} from '../../scripts/private-lan-forwarder.mjs';
const exec=promisify(execFile),ip='/usr/sbin/ip';
const safeEnv={PATH:'/usr/sbin:/usr/bin:/bin',HOME:'/root'};
const fail=()=>{throw Error('DISPOSABLE_LAN_FORWARDER_REHEARSAL_FAILED')};
function run(args){
 try{return execFileSync(ip,args,{encoding:'utf8',timeout:10000,maxBuffer:1048576,env:safeEnv,stdio:['ignore','pipe','pipe']}).trim()}catch{fail()}
}
export async function rehearsePrivateLanForwarder({target,identity,stopBackend}){
 if(process.platform!=='linux'||process.geteuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||typeof stopBackend!=='function')fail();
 const suffix=randomBytes(4).toString('hex'),ns='at-lan-'+suffix,hostIf='at'+suffix,peerIf='ap'+suffix;
 // Only create an isolated interface with a new, previously unused subnet.
 // No default route in the test namespace.
 const prefix='192.168.240',bindAddress=prefix+'.1',allowedAddress=prefix+'.2',deniedAddress=prefix+'.10',clientSubnet=prefix+'.0/29';
 if(Object.values(networkInterfaces()).flat().some(x=>x.address.startsWith(prefix+'.'))||JSON.parse(run(['-j','route','show','table','all'])).some(x=>typeof x.dst==='string'&&x.dst.startsWith(prefix+'.')))fail();
 let namespaceCreated=false,linkCreated=false,gateway;
 const policy={confirmation:'RUN_PINNED_PRIVATE_LAN_FORWARDER_ONLY_EXCLUSIVE_OPERATOR_CUSTODY',interfaceName:hostIf,bindAddress,clientSubnet,ingressAddress:target.address,hostname:target.hostname,rootPem:target.rootPem,trustedRootSha256:target.trustedRootSha256,trustedLeafSha256:target.trustedLeafSha256,identity};
 const probeModule=new URL('../../scripts/probe-private-lan-https.mjs',import.meta.url).href;
 const probeInput={...target,address:bindAddress};
 // Asynchronous native child: the forwarder itself runs in this Node process.
 async function client(expectSuccess){
  const script="import {probePrivateLanHttps} from "+JSON.stringify(probeModule)+";const input=JSON.parse(process.argv[1]);let ok=false;try{await probePrivateLanHttps(input,async()=>{});ok=true}catch{};process.exitCode=ok?0:3;";
  try{
   await exec(ip,['netns','exec',ns,process.execPath,'--input-type=module','-e',script,JSON.stringify(probeInput)],{timeout:20000,maxBuffer:16384,env:safeEnv});
   if(!expectSuccess)fail();
  }catch(e){if(expectSuccess||e.code!==3)fail()}
 }
 try{
  run(['netns','add',ns]);namespaceCreated=true;
  run(['link','add',hostIf,'type','veth','peer','name',peerIf]);linkCreated=true;
  run(['link','set',peerIf,'netns',ns]);
  run(['addr','add',bindAddress+'/24','dev',hostIf]);run(['link','set',hostIf,'up']);
  run(['-n',ns,'addr','add',allowedAddress+'/24','dev',peerIf]);run(['-n',ns,'link','set',peerIf,'up']);run(['-n',ns,'link','set','lo','up']);
  assert.equal(JSON.parse(run(['-n',ns,'-j','route','show','default'])).length,0);
  gateway=await startPrivateLanForwarder(policy);
  assert.equal(gateway.receipt.local_https_verified,true);
  assert.equal(gateway.receipt.remote_admission_after_readiness,true);
  await client(true);
  // Same link, same TLS pins, different real source address outside /29.
  run(['-n',ns,'addr','del',allowedAddress+'/24','dev',peerIf]);
  run(['-n',ns,'addr','add',deniedAddress+'/24','dev',peerIf]);
  await client(false);
  run(['-n',ns,'addr','del',deniedAddress+'/24','dev',peerIf]);
  run(['-n',ns,'addr','add',allowedAddress+'/24','dev',peerIf]);
  await client(true);
  // A real backend stop must cause the periodic health guard to stop
  // forwarding, close active sockets and release its listener.
  await stopBackend();
  let closed=false;gateway.closed.then(()=>{closed=true});
  const deadline=performance.now()+28000;
  while(!closed){if(performance.now()>deadline)fail();await sleep(250)}
  await client(false);
  console.log('PASS: real isolated LAN namespace, approved remote TLS client, denied outside-subnet source, backend failure closes listener; no public route or customer firewall changes.');
 }finally{
  try{if(gateway)await gateway.close()}finally{
   try{if(linkCreated)run(['link','del',hostIf])}finally{if(namespaceCreated)run(['netns','del',ns])}
  }
 }
}
