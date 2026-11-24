// Phase O M4 advisory policy reference. No collector, HTTP route, storage,
// command dispatch, repair, consent grant, or production approval.
// The maximum tier is conservative where the specification permits a range.
const rows=[
 ['TR-01','PC_SLOW','D2','RESOURCE_PRESSURE'],
 ['TR-02','WIFI_NO_INTERNET','D2','APPROVED_NETWORK_STATUS'],
 ['TR-03','WINDOWS_UPDATE_FAILURE','D2','UPDATE_STATUS'],
 ['TR-04','DISK_FULL','D2','DISK_CAPACITY_HEALTH'],
 ['TR-05','BLUE_SCREEN','D3',null],
 ['TR-06','NO_SOUND','D2','AUDIO_STATUS'],
 ['TR-07','BLUETOOTH_FAILURE','D2','BLUETOOTH_STATUS'],
 ['TR-08','PRINTER_FAILURE','D2','PRINT_STATUS'],
 ['TR-09','DISPLAY_FAILURE','D3',null],
 ['TR-10','SLOW_BOOT','D2','BOOT_TIMING'],
 ['TR-11','SUSPECTED_MALWARE','D3',null],
 ['TR-12','OUTLOOK_CRASH','D2','APPLICATION_HEALTH'],
 ['TR-13','SHELL_FROZEN','D2','SHELL_STATUS'],
 ['TR-14','BATTERY_DRAIN','D2','BATTERY_HEALTH'],
 ['TR-15','VPN_NO_INTERNET','D2','APPROVED_NETWORK_STATUS'],
 ['TR-16','COPILOT_POLICY','D2','MANAGED_POLICY_STATUS'],
 ['TR-17','PREINSTALLED_APPS','D2','APPROVED_SOFTWARE_INVENTORY'],
 ['TR-18','TELEMETRY_POLICY','D2','MANAGED_POLICY_STATUS'],
 ['TR-19','DRIVER_REGRESSION','D3',null],
 ['TR-20','CONTEXT_MENU','D2','OS_SHELL_CONFIGURATION'],
 ['TR-21','POWER_SAVER','D2','POWER_PLAN_STATUS'],
 ['TR-22','SLOW_STARTUP','D2','BOOT_TIMING'],
 ['TR-23','STORE_APPS_FAILURE','D2','APPLICATION_HEALTH'],
 ['TR-24','BURNING_SMELL','D3',null],
 ['TR-25','UNEXPECTED_SLEEP','D2','POWER_PLAN_STATUS'],
 ['TR-26','FIREWALL_STATUS','D0','FIREWALL_STATUS']
];
export const troubleshootingCatalog=Object.freeze(rows.map(([id,category,repairTier,diagnostic])=>
  Object.freeze({id,category,repair_tier:repairTier,diagnostic_id:diagnostic})));
const byId=new Map(troubleshootingCatalog.map(x=>[x.id,x]));
const hazardous=new Set(['PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE']);
const channels=new Set(['SELF_SERVICE','PROACTIVE','TECHNICIAN']);
const denied=reason=>Object.freeze({decision:'BLOCKED',reason,diagnostic_authorized:false,
  repair_authorized:false,production_accepted:false});
// Context values are categorical planning inputs, not authenticated evidence.
// Never use caller flags or a model recommendation as authorization.
export function planTroubleshooting(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.getPrototypeOf(input)!==Object.prototype||
    Object.keys(input).some(k=>!['category_id','intake_channel','hazard','consent_status','policy_status'].includes(k)))
    return denied('INVALID_INPUT');
 const {category_id,intake_channel,hazard='UNKNOWN',consent_status='UNVERIFIED',policy_status='UNVERIFIED'}=input;
 const issue=byId.get(category_id);
 if(!issue||!channels.has(intake_channel)||
    !['UNKNOWN','NONE',...hazardous].includes(hazard)||
    !['UNVERIFIED','DENIED','RECORDED'].includes(consent_status)||
    !['UNVERIFIED','DENIED','RECORDED'].includes(policy_status))return denied('INVALID_INPUT');
 const base={category_id:issue.id,diagnostic_authorized:false,repair_authorized:false,production_accepted:false};
 if(issue.repair_tier==='D3'||hazardous.has(hazard))return Object.freeze({...base,
   decision:'HUMAN_ONLY',risk:'D3',diagnostic_id:null,
   reason:issue.id==='TR-24'||hazard==='PHYSICAL_HAZARD'?'STOP_USE_PHYSICAL_HAZARD':'ESCALATE_TO_QUALIFIED_REVIEW'});
 if(hazard!=='NONE')return Object.freeze({...base,decision:'BLOCKED',reason:'HAZARD_ASSESSMENT_REQUIRED'});
 if(consent_status!=='RECORDED'||policy_status!=='RECORDED')return Object.freeze({...base,decision:'BLOCKED',reason:'CONSENT_AND_POLICY_REQUIRED'});
 return Object.freeze({...base,decision:'READ_ONLY_PLAN',risk:'D0',diagnostic_id:issue.diagnostic_id,
   repair_tier:issue.repair_tier,reason:'INDEPENDENT_AUTHORIZATION_AND_ALLOWLIST_REQUIRED'});
}
// Acknowledgement alone cannot establish a resolution. The reference only
// labels observed attempt states; independent postcheck custody and actual
// lifecycle persistence are still required, even if all flags are supplied.
export function classifyTroubleshootingAttempt({execution='UNKNOWN',postcheck='UNKNOWN',userFeedback='UNKNOWN'}={}){
 if(!['UNKNOWN','QUEUED','FAILED','EXECUTED'].includes(execution)||
    !['UNKNOWN','FAILED','PASSED'].includes(postcheck)||
    !['UNKNOWN','CONFIRMED','DISPUTED'].includes(userFeedback))return 'INVALID_EVIDENCE';
 if(execution==='FAILED')return 'UNRESOLVED';
 if(execution!=='EXECUTED')return 'NO_VERIFIED_ATTEMPT';
 if(postcheck==='FAILED'||userFeedback==='DISPUTED')return 'UNRESOLVED';
 if(postcheck==='PASSED'&&userFeedback==='CONFIRMED')return 'INDEPENDENT_OUTCOME_REVIEW_REQUIRED';
 return 'ACTION_ATTEMPTED';
}
