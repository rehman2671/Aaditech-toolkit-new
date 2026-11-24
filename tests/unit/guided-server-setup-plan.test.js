import {describe,it,expect} from 'vitest';
import {planGuidedServerSetup as plan,setupGateNames} from '../../scripts/guided-server-setup-plan.mjs';
const empty={database:'absent',credentials:'absent',service:'absent'};
const live={database:'present',credentials:'present',service:'present'};
const localIdentity={schema_version:1,installation_id:'6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e'};
const all=Object.fromEntries(setupGateNames.map(k=>[k,'VERIFIED']));
describe('guided setup reference state planning',()=>{
 it('rejects unsupported intent, unknown resource state and existing state without identity',()=>{
  expect(plan({intent:'clone-new',observed:empty}).reason).toBe('EXPLICIT_SUPPORTED_INTENT_REQUIRED');
  expect(plan({intent:'fresh',observed:{...empty,database:'unknown'}}).reason).toBe('LOCAL_STATE_UNKNOWN');
  expect(plan({intent:'fresh',observed:live}).reason).toBe('EXISTING_STATE_WITHOUT_IDENTITY');
  expect(plan({intent:'reconfigure',observed:{...live,credentials:'absent'},localIdentity}).decision).toBe('BLOCKED');
 });
 it('never skips earlier gates even if later stages were claimed',()=>{
  const result=plan({intent:'fresh',observed:empty,evidence:{...all,approved_release:'NOT_VERIFIED'},previousStage:'DB_READY'});
  expect(result).toMatchObject({decision:'BLOCKED',reason:'PRIOR_STAGE_EVIDENCE_INVALIDATED',stage:'NOT_INSTALLED',missing:['approved_release']});
 });
 it('fails at missing or negative trust/db evidence and does not automatically resume a failed stage',()=>{
  expect(plan({intent:'fresh',observed:empty,evidence:{...all,independent_root_trust:'FAILED'}})).toMatchObject({reason:'PREREQUISITE_FAILED',stage:'PREFLIGHT_OK'});
  expect(plan({intent:'reconfigure',observed:live,localIdentity,evidence:{...all,migration_verified:'NOT_VERIFIED'}})).toMatchObject({stage:'TRUST_BOOTSTRAPPED',missing:['migration_verified']});
  expect(plan({intent:'reconfigure',observed:live,localIdentity,evidence:all,failedStage:'DB_READY'}).reason).toBe('FAILED_STAGE_REQUIRES_OPERATOR_RECOVERY');
 });
 it('rejects booleans/extra fields and never returns installation or production approval',()=>{
  expect(plan({intent:'fresh',observed:empty,evidence:{approved_release:true}}).reason).toBe('INVALID_EVIDENCE');
  expect(plan({intent:'fresh',observed:empty,evidence:{...all,force:true}}).reason).toBe('INVALID_EVIDENCE');
  const result=plan({intent:'reconfigure',observed:live,localIdentity,evidence:all,previousStage:'ACCEPTED'});
  expect(result).toMatchObject({decision:'EXTERNAL_APPROVAL_REQUIRED',stage:'AGENT_READY',execution_authorized:false,production_accepted:false});
  expect(JSON.stringify(result)).not.toContain(localIdentity.installation_id);
 });
});

it('rejects inherited, accessor and hidden setup evidence without executing getters',()=>{
 const inherited=Object.create(all);
 expect(plan({intent:'fresh',observed:empty,evidence:inherited}).reason).toBe('INVALID_EVIDENCE');
 let reads=0;const accessor={...all};Object.defineProperty(accessor,'approved_release',{enumerable:true,get(){reads++;return 'VERIFIED'}});
 expect(plan({intent:'fresh',observed:empty,evidence:accessor}).reason).toBe('INVALID_EVIDENCE');expect(reads).toBe(0);
 const hidden={...all};Object.defineProperty(hidden,'hidden',{value:true});
 expect(plan({intent:'fresh',observed:empty,evidence:hidden}).reason).toBe('INVALID_EVIDENCE');
 const missing={...all};delete missing.approved_release;
 expect(plan({intent:'fresh',observed:empty,evidence:missing}).missing).toContain('approved_release');
});
