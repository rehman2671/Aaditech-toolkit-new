import {it,expect,describe} from 'vitest';
import {parsePrivateSubnet as parse,sourceInApprovedSubnet as allowed,selectApprovedLanInterface as select,validatePrivateLanForwarderPolicy as validate} from '../../scripts/private-lan-forwarder.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
const subnet=parse('192.168.5.0/24'),policy={interfaceName:'eth0',bindAddress:'192.168.5.10',subnet};
const row={family:'IPv4',address:policy.bindAddress,internal:false,cidr:'192.168.5.10/24',netmask:'255.255.255.0',mac:'02:00:00:00:00:01'};
it.each(['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','192.168.5.0/30'])('accepts canonical RFC1918 subnet %s',cidr=>expect(parse(cidr).cidr).toBe(cidr));
it.each(['0.0.0.0/0','127.0.0.0/8','169.254.0.0/16','8.8.8.0/24','172.0.0.0/8','192.168.5.1/24','192.168.5.0/31','192.168.5.0/32','192.168.005.0/24','192.168.5.0/024','192.168.5.0/24\n','192.168.5.0/24\r','192.168.5.0/24\u2028','::/0',null])('rejects unsafe CIDR %j',cidr=>expect(()=>parse(cidr)).toThrow());
it.each(['192.168.5.1','192.168.5.10','192.168.5.254'])('permits approved usable source %s',ip=>expect(allowed(ip,subnet)).toBe(true));
it.each(['192.168.5.0','192.168.5.255','192.168.6.1','8.8.8.8','127.0.0.1','::ffff:192.168.5.10','::1',null])('denies source outside approved usable subnet %j',ip=>expect(allowed(ip,subnet)).toBe(false));
it('observes exact selected NIC and address, rejects conflicting or wider CIDR',()=>{
 expect(select(policy,{eth0:[row]})).toMatchObject({address:row.address,cidr:row.cidr});
 for(const interfaces of [{},{eth0:[]},{eth0:[{...row,internal:true}]},{eth0:[{...row,netmask:'255.255.0.0'}]},{eth0:[{...row,cidr:'192.168.5.10/25'}]},{eth0:[row],eth1:[row]},{eth0:[row,row]},{eth1:[row]}])expect(()=>select(policy,interfaces)).toThrow();
 expect(()=>select({...policy,subnet:parse('192.168.0.0/16')},{eth0:[row]})).toThrow();
});
describe.skipIf(process.platform!=='linux')('explicit private listener policy',()=>{
 it('pins both certificates and forbids wildcard/public/same-network forwarding',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lan-forwarder-policy-'));
  try{
   execFileSync('/usr/bin/openssl',['req','-new','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=fixture','-addext','basicConstraints=critical,CA:TRUE','-keyout',join(dir,'key'),'-out',join(dir,'cert')],{stdio:'ignore',timeout:10000});
   const rootPem=await readFile(join(dir,'cert'),'utf8'),trustedRootSha256=createHash('sha256').update(new X509Certificate(rootPem).raw).digest('hex');
   const input={confirmation:'RUN_PINNED_PRIVATE_LAN_FORWARDER_ONLY_EXCLUSIVE_OPERATOR_CUSTODY',interfaceName:'eth0',bindAddress:'192.168.5.10',clientSubnet:'192.168.5.0/24',ingressAddress:'172.20.0.3',hostname:'office.internal',rootPem,trustedRootSha256,trustedLeafSha256:'a'.repeat(64),identity:{confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:'/private/id',expectedInstallationId:'12345678-1234-4234-8234-123456789abc',expectedIdentitySha256:'a'.repeat(64)}};
   expect(validate(input).subnet.cidr).toBe(input.clientSubnet);
   for(const patch of [{confirmation:'yes'},{interfaceName:'docker0'},{interfaceName:'lo'},{interfaceName:'br-123'},{interfaceName:'eth0;cmd'},{interfaceName:'eth0\n'},{interfaceName:'eth0\r'},{bindAddress:'0.0.0.0'},{bindAddress:'127.0.0.1'},{bindAddress:'8.8.8.8'},{bindAddress:'192.168.6.10'},{ingressAddress:'192.168.5.10'},{ingressAddress:'192.168.5.11'},{ingressAddress:'8.8.8.8'},{clientSubnet:'0.0.0.0/0'},{hostname:'*.internal'},{trustedRootSha256:'b'.repeat(64)},{trustedLeafSha256:'0'.repeat(64)},{identity:{...input.identity,directoryPath:'relative'}},{extra:true}])expect(()=>validate({...input,...patch})).toThrow();
  }finally{await rm(dir,{recursive:true,force:true})}
 },20000);
});
