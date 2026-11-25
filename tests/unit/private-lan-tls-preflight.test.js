import {describe,it,expect} from 'vitest';
import {createHash,X509Certificate} from 'node:crypto';
import {createServer} from 'node:tls';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probePrivateTls,validatePrivateTlsInputs} from '../../scripts/private-lan-tls-preflight.mjs';

describe('private LAN TLS handshake reference',()=>{
  const target={address:'127.0.0.1',hostname:'office.internal',port:443};
  const invalidCases=[
    ["hostname 1","hostname","office.internal\n"],
    ["hostname 2","hostname","office.internal\r"],
    ["hostname 3","hostname","office.internal\r\n"],
    ["hostname 4","hostname","office.internal "],
    ["hostname 5","hostname","office.internal "],
    ["hostname 6","hostname","office.internal\t"],
    ["hostname 7","hostname","office.internal "],
    ["hostname 8","hostname"," office.internal"],
    ["hostname 9","hostname","office.\u0000internal"],
    ["hostname 10","hostname","office..internal"],
    ["hostname 11","hostname",".office.internal"],
    ["hostname 12","hostname","office.internal."],
    ["hostname 13","hostname","OFFICE.internal"],
    ["hostname 14","hostname","office.INTERNAL"],
    ["hostname 15","hostname","off_ice.internal"],
    ["hostname 16","hostname","-office.internal"],
    ["hostname 17","hostname","office-.internal"],
    ["hostname 18","hostname","office.-internal"],
    ["hostname 19","hostname","office.internal-"],
    ["hostname 20","hostname","office"],
    ["hostname 21","hostname","*.internal"],
    ["hostname 22","hostname","office.123"],
    ["hostname 23","hostname","office/other.internal"],
    ["hostname 24","hostname","office:443.internal"],
    ["hostname 25","hostname","é.internal"],
    ["hostname 26","hostname","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.internal"],
    ["hostname 27","hostname",["office.internal"]],
    ["hostname 28","hostname",null],
    ["address 1","address","8.8.4.4"],
    ["address 2","address","172.15.0.1"],
    ["address 3","address","172.32.0.1"],
    ["address 4","address","192.169.0.1"],
    ["address 5","address","169.254.1.1"],
    ["address 6","address","100.64.0.1"],
    ["address 7","address","224.0.0.1"],
    ["address 8","address","0.0.0.0"],
    ["address 9","address","255.255.255.255"],
    ["address 10","address","::1"],
    ["address 11","address","127.0.0.1\n"],
    ["address 12","address","127.000.0.1"],
    ["address 13","address","127.1"],
    ["address 14","address","2130706433"],
    ["address 15","address","0x7f000001"],
    ["address 16","address",127],
    ["address 17","address",["127.0.0.1"]],
    ["address 18","address",null],
    ["port 1","port",0],
    ["port 2","port",65536],
    ["port 3","port",-1],
    ["port 4","port",1.5],
    ["port 5","port","443"],
    ["port 6","port",null],
    ["port 7","port",true],
    ["port 8","port",[]],
    ["port 9","port",{}],
    ["port 10","port",443.01]
  ];
  it.each(invalidCases)('rejects invalid %s before loading trust material',(_label,field,value)=>{
    expect(()=>validatePrivateTlsInputs({...target,[field]:value})).toThrow('PRIVATE_TLS_TARGET_REQUIRED');
  });
  it.each([["pin 1",""],["pin 2","fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],["pin 3","fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],["pin 4","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"],["pin 5","gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"],["pin 6","fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\n"],["pin 7",null],["pin 8",42],["pin 9",["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"]]])('rejects malformed %s',(_label,trustedRootSha256)=>{
    expect(()=>validatePrivateTlsInputs({...target,trustedRootSha256,rootPem:'-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----\\n'.replaceAll('\\\\n','\\n')})).toThrow('EXPLICIT_ROOT_PIN_REQUIRED');
  });
  it.each([null,[],42,'target'])('rejects malformed options (%j)',options=>{
    expect(()=>validatePrivateTlsInputs(options)).toThrow('PRIVATE_TLS_TARGET_REQUIRED');
  });
  it('normalizes malformed root parser errors',()=>{
    expect(()=>validatePrivateTlsInputs({...target,trustedRootSha256:'a'.repeat(64),rootPem:'-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n'})).toThrow('PRIVATE_ROOT_PIN_OR_CA_INVALID');
  });
  it('rejects public IPs, ambiguous names and probes without explicit consent before connecting',async()=>{
    for(const address of ['8.8.8.8','169.254.169.254','::ffff:127.0.0.1','example.com'])
      expect(()=>validatePrivateTlsInputs({address,hostname:'office.internal',port:443})).toThrow('PRIVATE_TLS_TARGET_REQUIRED');
    await expect(probePrivateTls({address:'127.0.0.1'})).rejects.toThrow('EXPLICIT_PRIVATE_TLS_PROBE_REQUIRED');
  });
  // Linux CI uses its installed OpenSSL only to generate disposable fixture
  // keys/certificates. No external service or production trust key.
  it.skipIf(process.platform!=='linux')('validates actual loopback TLS chain and exact DNS/IP SAN; rejects wrong root and wildcard/CN-only',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'itk-lan-tls-'));
    const run=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore',timeout:10000});
    const root=(prefix)=>run('req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Fixture '+prefix,
      '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign',
      '-keyout',prefix+'.key','-out',prefix+'.crt');
    let server;
    try{
      root('ca');root('wrong');
      const issue=async (name,san,eku='serverAuth')=>{
        run('req','-newkey','rsa:2048','-nodes','-subj','/CN=office.internal','-keyout',name+'.key','-out',name+'.csr');
        await writeFile(join(dir,name+'.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n'+(eku?'extendedKeyUsage='+eku+'\n':'')+(san?'subjectAltName='+san+'\n':''));
        run('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','1','-extfile',name+'.ext','-out',name+'.crt');
      };
      await issue('good','DNS:office.internal,IP:127.0.0.1');
      await issue('wild','DNS:*.internal');
      await issue('cn','');
      await issue('noeku','DNS:office.internal',null);
      await issue('client','DNS:office.internal','clientAuth');
      const pem=await readFile(join(dir,'ca.crt'),'utf8');
      const wrong=await readFile(join(dir,'wrong.crt'),'utf8');
      const pin=p=>createHash('sha256').update(new X509Certificate(p).raw).digest('hex');
      const start=async name=>{
        if(server)await new Promise(resolve=>server.close(resolve));
        server=createServer({key:await readFile(join(dir,name+'.key')),cert:await readFile(join(dir,name+'.crt'))},s=>s.end());
        server.on('tlsClientError',()=>{});
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
        return {address:'127.0.0.1',hostname:'office.internal',port:server.address().port,rootPem:pem,
          trustedRootSha256:pin(pem),confirmation:'PROBE_PRIVATE_TLS_ONLY'};
      };
      const good=await start('good');
      expect(await probePrivateTls(good)).toMatchObject({chain_verified:true,exact_san_verified:true,server_auth_eku_verified:true,
        revocation_verified:false,installation_authorized:false});
      expect(await probePrivateTls({...good,hostname:'127.0.0.1'})).toMatchObject({exact_san_verified:true});
      await expect(probePrivateTls({...good,hostname:'other.internal'})).rejects.toThrow('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
      await expect(probePrivateTls({...good,rootPem:wrong})).rejects.toThrow('PRIVATE_ROOT_PIN_OR_CA_INVALID');
      await expect(probePrivateTls({...good,rootPem:wrong,trustedRootSha256:pin(wrong)})).rejects.toThrow('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
      await expect(probePrivateTls(await start('wild'))).rejects.toThrow('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
      await expect(probePrivateTls(await start('cn'))).rejects.toThrow('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
      await expect(probePrivateTls(await start('noeku'))).rejects.toThrow('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
      await expect(probePrivateTls(await start('client'))).rejects.toThrow('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
      expect(()=>validatePrivateTlsInputs({...good,rootPem:pem+'\n\n'})).toThrow('EXPLICIT_ROOT_PIN_REQUIRED');
    }finally{
      if(server)await new Promise(resolve=>server.close(resolve));
      await rm(dir,{recursive:true,force:true});
    }
  },30000);
});
