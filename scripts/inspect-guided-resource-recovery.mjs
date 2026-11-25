// Read-only guided recovery correlation; neither journal nor labels prove
// ownership. Never acquire or clear a retained lock, adopt, stop or delete.
import {inspectGuidedOperationJournal,validateGuidedJournalPolicy} from './guided-operation-journal.mjs';
import {inspectProjectRecoveryResources} from './fresh-compose-resource-inventory.mjs';
const fail=()=>{throw Error('GUIDED_RESOURCE_RECOVERY_UNCONFIRMED')};
export function correlateGuidedRecovery(history,resources){
 const step=history.steps.find(x=>x.step==='RESOURCES'),candidate=history.steps.find(x=>x.step==='STOPPED_CANDIDATES'),stack=history.steps.find(x=>x.step==='PRIVATE_STACK');
 if(!step||!candidate||!stack||typeof resources.shape!=='string')fail();
 let decision;
 if(resources.shape==='CONFLICT_OR_UNEXPECTED_RESOURCE')decision='CONFLICT_REQUIRES_INDEPENDENT_REVIEW';
 else if(history.operation_lock_state!=='EMPTY'||history.adapter_lock_state!=='EMPTY')decision='RETAINED_LOCK_REQUIRES_RECONCILIATION';
 else if(step.status==='NOT_RECORDED')decision=resources.shape==='EMPTY'?'NO_PROJECT_RESOURCES_OBSERVED':'UNRECORDED_RESOURCES_REQUIRE_REVIEW';
 else if(step.status==='RECONCILIATION_REQUIRED'||candidate.status==='RECONCILIATION_REQUIRED'||stack.status==='RECONCILIATION_REQUIRED')decision='INTERRUPTED_MUTATION_REQUIRES_REVIEW';
 else if(resources.shape==='EMPTY')decision='RECORDED_RESOURCES_NOT_OBSERVED';
 else if(stack.status==='RECORDED_COMPLETE')decision=resources.shape==='ALL_CONTAINERS_RUNNING'?'RUNNING_STACK_REQUIRES_FULL_READMISSION':'RECORDED_STACK_STATE_DIFFERS';
 else if(candidate.status==='RECORDED_COMPLETE')decision=resources.shape==='ALL_CANDIDATES_CREATED'?'STOPPED_CANDIDATES_REQUIRE_FULL_READMISSION':'RECORDED_CANDIDATE_STATE_DIFFERS';
 else decision=resources.shape==='RESOURCES_ONLY'?'RESOURCES_REQUIRE_FULL_READMISSION':'PARTIAL_OR_UNRECORDED_STATE_REQUIRES_REVIEW';
 return Object.freeze({schema_version:1,decision,history,resources,actual_resource_metadata_observed:true,resource_ownership_verified:false,writer_quiescence_verified:false,resume_authorized:false,rollback_authorized:false,mutation_authorized:false,production_accepted:false});
}
export async function inspectGuidedResourceRecovery(input){
 const p=validateGuidedJournalPolicy(input);
 const history=await inspectGuidedOperationJournal(p);
 const resources=await inspectProjectRecoveryResources({confirmation:'INSPECT_PROJECT_RECOVERY_RESOURCES_ONLY',project:p.project,releaseSha256:p.releaseSha256});
 const second=await inspectGuidedOperationJournal(p);
 if(JSON.stringify(history)!==JSON.stringify(second))fail();
 return correlateGuidedRecovery(history,resources);
}
