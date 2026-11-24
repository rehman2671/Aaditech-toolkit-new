// Explicit capability inventory for all original diagnostic categories.
// Contract availability is not a deployed collector, approval or resolution.
import {troubleshootingCatalog} from './troubleshooting-policy.js';
const rows=[
 ['RESOURCE_PRESSURE','aaditech-resource-diagnostic-v1',['cpu_percent','ram_percent','disk_percent'],'LOCAL_REFERENCE','LOCAL_REFERENCE','LOCAL_REFERENCE'],
 ['APPROVED_NETWORK_STATUS','aaditech-network-diagnostic-v1',['link_state','default_route_state','approved_probe_state'],'LINUX_PASSIVE_REFERENCE','NOT_IMPLEMENTED','NOT_IMPLEMENTED'],
 ['DISK_CAPACITY_HEALTH','aaditech-disk-diagnostic-v1',['free_percent','health_state','read_only_state'],'LOCAL_CAPACITY_REFERENCE','LOCAL_CAPACITY_REFERENCE','LOCAL_CAPACITY_REFERENCE'],
 ['UPDATE_STATUS',null,[]],['AUDIO_STATUS',null,[]],['BLUETOOTH_STATUS',null,[]],
 ['PRINT_STATUS',null,[]],['BOOT_TIMING',null,[]],['APPLICATION_HEALTH',null,[]],
 ['SHELL_STATUS',null,[]],['BATTERY_HEALTH',null,[]],['MANAGED_POLICY_STATUS',null,[]],
 ['APPROVED_SOFTWARE_INVENTORY',null,[]],['OS_SHELL_CONFIGURATION',null,[]],['POWER_PLAN_STATUS',null,[]],
 ['FIREWALL_STATUS',null,[]]
];
const registry=new Map(rows.map(([id,schema,fields,linux='NOT_IMPLEMENTED',windows='NOT_IMPLEMENTED',macos='NOT_IMPLEMENTED'])=>
 [id,Object.freeze({diagnostic_id:id,artifact_schema:schema,artifact_fields:Object.freeze(fields),
  linux,windows,macos,remote_collector_available:false,execution_authorized:false,repair_authorized:false})]));
const expected=new Set(troubleshootingCatalog.map(x=>x.diagnostic_id).filter(Boolean));
if(registry.size!==expected.size||[...expected].some(id=>!registry.has(id)))throw Error('DIAGNOSTIC_CAPABILITY_CATALOG_DRIFT');
export const diagnosticCapabilities=Object.freeze([...registry.values()]);
const platforms=['linux','windows','macos'];
export function inspectDiagnosticCapability({categoryId,platform}={}){
 if(!platforms.includes(platform))throw Error('DIAGNOSTIC_CAPABILITY_INVALID');
 const issue=troubleshootingCatalog.find(x=>x.id===categoryId);
 if(!issue)throw Error('DIAGNOSTIC_CAPABILITY_INVALID');
 const capability=registry.get(issue.diagnostic_id);
 return Object.freeze({category_id:issue.id,platform,diagnostic_id:issue.diagnostic_id,
  availability:capability?capability[platform]:'HUMAN_ONLY',
  artifact_schema:capability?.artifact_schema??null,artifact_fields:capability?.artifact_fields??Object.freeze([]),
  platform_verified:false,remote_collector_available:false,diagnostic_authorized:false,
  execution_authorized:false,repair_authorized:false,production_accepted:false});
}
export function summarizeDiagnosticCapabilities(){
 const categories=Object.freeze(platforms.map(platform=>Object.freeze({platform,
  categories:Object.freeze(troubleshootingCatalog.map(x=>inspectDiagnosticCapability({categoryId:x.id,platform})))})));
 return Object.freeze({categories,platform_acceptance_verified:false,production_accepted:false});
}
