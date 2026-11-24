import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {verifyDeviceRecoveryEvidence as verifyEvidence} from '../../device-recovery-evidence.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const now=1700000000000;
const tenant='00000000-0000-4000-8000-000000000001';
const device='00000000-0000-4000-8000-000000000002';
const request='00000000-0000-4000-8000-000000000003';
function fixture(patch={}){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const doc={schema:'aaditech-device-recovery-evidence-v1',purpose:'REVIEW_ONLY_CREDENTIAL_RECOVERY',
    tenant_id:tenant,device_id:device,request_id:request,challenge_sha256:'a'.repeat(64),
    credential_fingerprint:'b'.repeat(64),ownership_evidence_sha256:'c'.repeat(64),
    command_reconciliation_sha256:'d'.repeat(64),local_handoff_evidence_sha256:'e'.repeat(64),
    issued_at_ms:now-1000,expires_at_ms:now+1000,...patch};
  const payload=Buffer.from(JSON.stringify(doc));
  const args={payload,signature:sign(null,payload,privateKey),
    reviewerPublicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    expected:{payloadSha256:sha(payload),reviewerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'})),
      tenantId:tenant,deviceId:device,requestId:request,challengeSha256:'a'.repeat(64),
      credentialFingerprint:'b'.repeat(64)},nowMs:now};
  return {args,doc,privateKey};
}
const denied=args=>expect(()=>verifyEvidence(args)).toThrow('RECOVERY_EVIDENCE_UNVERIFIED');
describe('review-only independent device recovery evidence',()=>{
  it('verifies a pinned Ed25519 reviewer and exact current request without authorizing issuance',()=>{
    const {args}=fixture();
    const result=verifyEvidence(args);
    expect(result).toEqual({evidence_verified:true,request_id:request,device_id:device,tenant_id:tenant,
      expires_at_ms:now+1000,evidence_sha256:args.expected.payloadSha256,grant_consumed:false,
      replacement_allowed:false,production_accepted:false});
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('rejects missing or independently mismatched pins, signature and reviewer key',()=>{
    const {args}=fixture(),other=fixture().args;
    for(const patch of [{signature:Buffer.alloc(64)},{signature:Buffer.alloc(63)},
      {reviewerPublicKeyPem:other.reviewerPublicKeyPem},{reviewerPublicKeyPem:'bad'},
      {expected:{...args.expected,payloadSha256:'f'.repeat(64)}},
      {expected:{...args.expected,reviewerSpkiSha256:'f'.repeat(64)}},{expected:null},
      {payload:Buffer.alloc(8193)},{payload:Buffer.alloc(0)},{nowMs:NaN}]) denied({...args,...patch});
    denied(undefined);
  });
  it('rejects valid signed but wrong tenant, device, request, challenge or credential generation',()=>{
    for(const patch of [{tenant_id:device},{device_id:tenant},{request_id:device},
      {challenge_sha256:'f'.repeat(64)},{credential_fingerprint:'f'.repeat(64)}])denied(fixture(patch).args);
  });
  it('rejects expiry, future issue, excessive validity, missing evidence and changed purpose',()=>{
    for(const patch of [{expires_at_ms:now},{issued_at_ms:now+1},
      {expires_at_ms:now+300001},{ownership_evidence_sha256:'0'.repeat(64)},
      {command_reconciliation_sha256:null},{local_handoff_evidence_sha256:undefined},
      {purpose:'ISSUE_TOKEN'},{schema:'other'},{extra:'unexpected'}])denied(fixture(patch).args);
  });
  it('rejects noncanonical signed bytes even if their digest is pinned',()=>{
    const {args,doc,privateKey}=fixture();
    for(const bytes of [Buffer.from(JSON.stringify(doc,null,2)),
      Buffer.from(JSON.stringify(doc).replace('"schema":','"schema":"duplicate","schema":')),
      Buffer.concat([args.payload,Buffer.from('\n')])]){
      denied({...args,payload:bytes,signature:sign(null,bytes,privateKey),
        expected:{...args.expected,payloadSha256:sha(bytes)}});
    }
  });
});

it('rejects exact-length violations even when evidence and trusted expected context agree',()=>{
  for(const [field,expectedField,value] of [['tenant_id','tenantId',tenant+'\n'],['device_id','deviceId',device+'\n'],['request_id','requestId',request+'\n'],['challenge_sha256','challengeSha256','a'.repeat(64)+'\n'],['credential_fingerprint','credentialFingerprint','b'.repeat(64)+'\n']]){
    const {args}=fixture({[field]:value});args.expected[expectedField]=value;denied(args);
  }
  for(const field of ['ownership_evidence_sha256','command_reconciliation_sha256','local_handoff_evidence_sha256'])denied(fixture({[field]:'a'.repeat(64)+'\n'}).args);
});
