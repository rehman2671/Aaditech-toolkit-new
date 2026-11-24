// Reference setup *planning*, not an installer, authorization service,
// or durable operational state machine. Do not accept browser-supplied
// booleans as evidence. Real installer must obtain observations directly.
import {planInstallationIdentity} from './installation-identity.mjs';

const LEVELS=['NOT_INSTALLED','PREFLIGHT_OK','TRUST_BOOTSTRAPPED','DB_READY',
  'API_READY','INITIAL_ADMIN_SETUP','AGENT_READY','ACCEPTED'];
const GATES=[
  ['PREFLIGHT_OK',['approved_runtime','approved_release','host_compatibility','resource_inventory','exclusive_setup_lock']],
  ['TRUST_BOOTSTRAPPED',['private_tls_provisioned','independent_root_trust','tls_endpoint_verified']],
  ['DB_READY',['identity_bound','persistent_database','migration_verified','secrets_protected']],
  ['API_READY',['api_health_verified','private_ingress_verified']],
  ['INITIAL_ADMIN_SETUP',['admin_persisted','workspace_persisted','bootstrap_closed']],
  ['AGENT_READY',['signed_agent_verified','enrolled_agent_verified']],
  ['ACCEPTED',['offline_acceptance_witnessed','recovery_witnessed','independent_release_approval']]
];
const REQUIRED=GATES.flatMap(([,keys])=>keys);
const stop=(reason,stage='NOT_INSTALLED',missing=[])=>Object.freeze({
  decision:'BLOCKED',reason,stage,missing:Object.freeze([...missing]),
  execution_authorized:false,production_accepted:false
});
export function planGuidedServerSetup({intent, observed, localIdentity=null, evidence={},
  previousStage='NOT_INSTALLED', failedStage=null}={}) {
  if(!['fresh','reconfigure'].includes(intent))return stop('EXPLICIT_SUPPORTED_INTENT_REQUIRED');
  if(!LEVELS.includes(previousStage) || (failedStage!==null&&!LEVELS.slice(1).includes(failedStage)))
    return stop('INVALID_STAGE');
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(evidence))||
    Reflect.ownKeys(evidence).some(k=>!REQUIRED.includes(k)||!Object.getOwnPropertyDescriptor(evidence,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(evidence,k),'value'))||
    Object.values(evidence).some(v=>!['VERIFIED','NOT_VERIFIED','FAILED'].includes(v)))
    return stop('INVALID_EVIDENCE');
  const identity=planInstallationIdentity({intent,observed,localIdentity});
  if(identity.decision==='BLOCKED')return stop(identity.reason);
  // Fresh planning is strictly for an empty host; once it has resources,
  // an approved runtime adapter must reconstruct identity from real state.
  // No resume-from-browser-stage, no bypass via a later requested stage.
  if(failedStage!==null)return stop('FAILED_STAGE_REQUIRES_OPERATOR_RECOVERY',failedStage);
  let stage='NOT_INSTALLED';
  for(const [target,keys] of GATES){
    const missing=keys.filter(k=>!Object.hasOwn(evidence,k)||evidence[k]!=='VERIFIED');
    if(missing.length){
      const invalidated=LEVELS.indexOf(previousStage)>LEVELS.indexOf(stage);
      return stop(invalidated?'PRIOR_STAGE_EVIDENCE_INVALIDATED':
        missing.some(k=>Object.hasOwn(evidence,k)&&evidence[k]==='FAILED')?'PREREQUISITE_FAILED':'EVIDENCE_REQUIRED',stage,missing);
    }
    stage=target;
  }
  // Even a complete claimed record is not proof of any real external fact.
  // Never emit ACCEPTED or an authorization from this planning layer.
  return Object.freeze({decision:'EXTERNAL_APPROVAL_REQUIRED',reason:'VERIFY_ACTUAL_EVIDENCE_AND_EXECUTION_ADAPTER',
    stage:'AGENT_READY',missing:Object.freeze([]),execution_authorized:false,production_accepted:false});
}
export const setupGateNames=Object.freeze([...REQUIRED]);
