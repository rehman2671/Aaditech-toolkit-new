import {describe,it,expect} from 'vitest';
import {troubleshootingCatalog,planTroubleshooting,classifyTroubleshootingAttempt} from '../../troubleshooting-policy.js';
const input={category_id:'TR-01',intake_channel:'SELF_SERVICE',hazard:'NONE',consent_status:'RECORDED',policy_status:'RECORDED'};
describe('M4 advisory troubleshooting policy',()=>{
 it('covers all 26 specified categories with immutable catalog and shared boot diagnostic',()=>{
  expect(troubleshootingCatalog.map(x=>x.id)).toEqual(Array.from({length:26},(_,i)=>'TR-'+String(i+1).padStart(2,'0')));
  expect(Object.isFrozen(troubleshootingCatalog)).toBe(true);
  expect(troubleshootingCatalog.every(Object.isFrozen)).toBe(true);
  expect(troubleshootingCatalog[9].diagnostic_id).toBe(troubleshootingCatalog[21].diagnostic_id);
 });
 it('never authorizes a collector or repair, including apparently consented cases',()=>{
  for(const issue of troubleshootingCatalog){
   const result=planTroubleshooting({...input,category_id:issue.id});
   expect(result).toMatchObject({diagnostic_authorized:false,repair_authorized:false,production_accepted:false});
   if(issue.repair_tier==='D3')expect(result).toMatchObject({decision:'HUMAN_ONLY',diagnostic_id:null});
   else expect(result.decision).toBe('READ_ONLY_PLAN');
  }
 });
 it('escalates physical hazards, suspected compromise and uncertain high-risk cases',()=>{
  expect(planTroubleshooting({...input,category_id:'TR-24',consent_status:'DENIED'})).toMatchObject({decision:'HUMAN_ONLY',reason:'STOP_USE_PHYSICAL_HAZARD',diagnostic_id:null});
  for(const hazard of ['PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE'])
   expect(planTroubleshooting({...input,hazard})).toMatchObject({decision:'HUMAN_ONLY',risk:'D3'});
  expect(planTroubleshooting({...input,hazard:'UNKNOWN'}).reason).toBe('HAZARD_ASSESSMENT_REQUIRED');
 });
 it('denies unknown categories, missing consent and arbitrary command injection',()=>{
  for(const patch of [{category_id:'TR-99'},{intake_channel:'UNTRUSTED'},{command:'anything'},{consent_status:true}])
   expect(planTroubleshooting({...input,...patch}).decision).toBe('BLOCKED');
  for(const consent_status of ['DENIED','UNVERIFIED'])
   expect(planTroubleshooting({...input,consent_status}).reason).toBe('CONSENT_AND_POLICY_REQUIRED');
  expect(planTroubleshooting({...input,policy_status:'DENIED'}).decision).toBe('BLOCKED');
 });
 it('never equates queue acknowledgement or caller-provided postcheck with verified resolution',()=>{
  expect(classifyTroubleshootingAttempt({execution:'QUEUED',postcheck:'PASSED',userFeedback:'CONFIRMED'})).toBe('NO_VERIFIED_ATTEMPT');
  expect(classifyTroubleshootingAttempt({execution:'EXECUTED'})).toBe('ACTION_ATTEMPTED');
  expect(classifyTroubleshootingAttempt({execution:'EXECUTED',postcheck:'FAILED'})).toBe('UNRESOLVED');
  expect(classifyTroubleshootingAttempt({execution:'EXECUTED',userFeedback:'DISPUTED'})).toBe('UNRESOLVED');
  expect(classifyTroubleshootingAttempt({execution:'EXECUTED',postcheck:'PASSED',userFeedback:'CONFIRMED'})).toBe('INDEPENDENT_OUTCOME_REVIEW_REQUIRED');
  expect(classifyTroubleshootingAttempt({execution:'ACK'})).toBe('INVALID_EVIDENCE');
 });
});
