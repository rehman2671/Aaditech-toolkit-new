import {it,expect} from 'vitest';
import {correlateGuidedRecovery as correlate} from '../../scripts/inspect-guided-resource-recovery.mjs';
function history(resource='NOT_RECORDED',candidate='NOT_RECORDED',stack='NOT_RECORDED',lock='EMPTY'){
 return {operation_lock_state:lock,adapter_lock_state:'EMPTY',steps:[{step:'RESOURCES',status:resource},{step:'STOPPED_CANDIDATES',status:candidate},{step:'PRIVATE_STACK',status:stack}]};
}
const done='RECORDED_COMPLETE',partial='RECONCILIATION_REQUIRED';
it.each([
 [history(),'EMPTY','NO_PROJECT_RESOURCES_OBSERVED'],
 [history(),'RESOURCES_ONLY','UNRECORDED_RESOURCES_REQUIRE_REVIEW'],
 [history(done),'EMPTY','RECORDED_RESOURCES_NOT_OBSERVED'],
 [history(done),'RESOURCES_ONLY','RESOURCES_REQUIRE_FULL_READMISSION'],
 [history(partial),'PARTIAL_OR_MIXED','INTERRUPTED_MUTATION_REQUIRES_REVIEW'],
 [history(done,done),'ALL_CANDIDATES_CREATED','STOPPED_CANDIDATES_REQUIRE_FULL_READMISSION'],
 [history(done,done),'ALL_CONTAINERS_RUNNING','RECORDED_CANDIDATE_STATE_DIFFERS'],
 [history(done,done,done),'ALL_CONTAINERS_RUNNING','RUNNING_STACK_REQUIRES_FULL_READMISSION'],
 [history(done,done,done),'ALL_CONTAINERS_EXITED','RECORDED_STACK_STATE_DIFFERS'],
 [history(done,done,done,'RETAINED_OR_ACTIVE'),'ALL_CONTAINERS_RUNNING','RETAINED_LOCK_REQUIRES_RECONCILIATION'],
 [history(),'CONFLICT_OR_UNEXPECTED_RESOURCE','CONFLICT_REQUIRES_INDEPENDENT_REVIEW']
])('correlates history and observed shape without execution approval', (h,shape,decision)=>expect(correlate(h,{shape})).toMatchObject({decision,resume_authorized:false,rollback_authorized:false,mutation_authorized:false,production_accepted:false}));
