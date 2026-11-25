// Explicit opt-in private HTTPS TLS handshake only. No DNS, HTTP, tokens,
// trust-store mutation, downloads, redirects or public-network fallback.
import {connect} from 'node:tls';
import {isIP} from 'node:net';
import {createHash,X509Certificate} from 'node:crypto';
function privateIPv4(ip) {
  if(typeof ip!=='string'||isIP(ip)!==4) return false;
  const [a,b]=ip.split('.').map(Number);
  return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
function validName(name) {
  return typeof name==='string'&&name.length<=253&&name.length>0&&
    !/[^a-z0-9.-]/.test(name)&&name.includes('.')&&
    name.split('.').every(s=>s.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s))&&
    /[a-z]/.test(name.split('.').at(-1));
}
export function validatePrivateTlsInputs(options) {
  if(!options||typeof options!=='object'||Array.isArray(options)) throw Error('PRIVATE_TLS_TARGET_REQUIRED');
  const {address,hostname,port,rootPem,trustedRootSha256}=options;
  if(!privateIPv4(address)||!Number.isInteger(port)||port<1||port>65535||
      !(validName(hostname)||(privateIPv4(hostname)&&hostname===address))) throw Error('PRIVATE_TLS_TARGET_REQUIRED');
  if(typeof trustedRootSha256!=='string'||trustedRootSha256.length!==64||
      !/^[0-9a-f]{64}$/.test(trustedRootSha256)||
      typeof rootPem!=='string'||rootPem.length>16384||
      !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?(?![\s\S])/.test(rootPem))
    throw Error('EXPLICIT_ROOT_PIN_REQUIRED');
  let root;
  try {root=new X509Certificate(rootPem)} catch {throw Error('PRIVATE_ROOT_PIN_OR_CA_INVALID')}
  const fingerprint=createHash('sha256').update(root.raw).digest('hex');
  if(fingerprint!==trustedRootSha256||!root.ca||!root.checkIssued(root)||!root.verify(root.publicKey))
    throw Error('PRIVATE_ROOT_PIN_OR_CA_INVALID');
  const now=Date.now();
  if(!(Date.parse(root.validFrom)<=now&&now<=Date.parse(root.validTo))) throw Error('PRIVATE_ROOT_EXPIRED_OR_NOT_YET_VALID');
  return Object.freeze({address,hostname,port,rootPem,fingerprint});
}
export async function probePrivateTls(options) {
  // No connection before the operator explicitly authorizes this exact probe.
  if(options?.confirmation!=='PROBE_PRIVATE_TLS_ONLY') throw Error('EXPLICIT_PRIVATE_TLS_PROBE_REQUIRED');
  const target=validatePrivateTlsInputs(options);
  return new Promise((resolve,reject)=>{
    let socket,settled=false;
    const finish=(error,result)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(socket)socket.destroy();
      error?reject(Error(error)):resolve(Object.freeze(result));
    };
    // Absolute deadline covers connection AND handshake.
    const timer=setTimeout(()=>finish('PRIVATE_TLS_PROBE_TIMEOUT'),8000);
    try {
      socket=connect({
        host:target.address,port:target.port,
        servername:isIP(target.hostname)?undefined:target.hostname,
        ca:target.rootPem,minVersion:'TLSv1.2',rejectUnauthorized:true,
        checkServerIdentity:(_name,peer)=>{
          try {
            const leaf=new X509Certificate(peer.raw);
            const match=isIP(target.hostname)?leaf.checkIP(target.hostname):
              leaf.checkHost(target.hostname,{subject:'never',wildcards:false});
            if(leaf.ca||!match||!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) return Error('EXACT_SAN_AND_SERVER_AUTH_REQUIRED');
          }catch{return Error('EXACT_SAN_REQUIRED')}
          return undefined;
        }
      },()=>{
        try {
          const leaf=socket.getPeerX509Certificate();
          const now=Date.now();
          const match=leaf&&(isIP(target.hostname)?leaf.checkIP(target.hostname):
            leaf.checkHost(target.hostname,{subject:'never',wildcards:false}));
          if(!socket.authorized||!leaf||leaf.ca||!match||!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')||
            !(Date.parse(leaf.validFrom)<=now&&now<=Date.parse(leaf.validTo)))
            return finish('PRIVATE_TLS_CHAIN_OR_SAN_INVALID');
          finish(null,{chain_verified:true,exact_san_verified:true,server_auth_eku_verified:true,
            tls_version:socket.getProtocol(),root_sha256:target.fingerprint,
            revocation_verified:false,system_trust_verified:false,
            application_readiness_verified:false,installation_authorized:false});
        }catch{finish('PRIVATE_TLS_CHAIN_OR_SAN_INVALID')}
      });
      socket.once('error',()=>finish('PRIVATE_TLS_CHAIN_OR_SAN_INVALID'));
      socket.once('close',()=>finish('PRIVATE_TLS_CONNECTION_CLOSED'));
    }catch{finish('PRIVATE_TLS_PROBE_FAILED')}
  });
}
