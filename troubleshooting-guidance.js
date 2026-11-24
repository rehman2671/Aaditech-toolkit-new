// Employee-facing offline advisory content only. No device access, consent
// grant, command generation, network request, repair or incident mutation.
import {troubleshootingCatalog,planTroubleshooting} from './troubleshooting-policy.js';
const rows=[
 ['TR-01','My PC is slow','Note whether the slowdown affects one app or the whole PC.','Save your work and note when the slowdown started.','Ask IT to review resource utilization; do not terminate unknown processes.','Measured resource relief and the user confirms normal performance.'],
 ['TR-02','Wi-Fi connected but no internet','Check the Wi-Fi status indicator and whether colleagues report the same issue.','Note whether approved internal applications are affected.','Ask IT to check the approved gateway and DNS; never switch to a public resolver.','Approved internal and permitted external connectivity confirmed.'],
 ['TR-03','Windows Update will not install','Read the update status in Windows Settings.','Note the failed update identifier and error code for IT, without sharing private logs.','Do not disable updates or run unapproved repair commands.','The specific failed update installs and reports success.'],
 ['TR-04','My disk is almost full','Read free space in Windows Storage settings.','Identify whether IT-managed storage or a user folder needs review without sharing file names.','Ask IT for approved cleanup; do not delete system files or unknown data.','Available capacity improves with no data loss.'],
 ['TR-05','Blue screen of death','Stop repeated restart attempts and contact qualified IT support.','If visible without another restart, note the stop code.','Do not change drivers, boot settings or encryption recovery settings.','Qualified technician confirms stability over an approved observation window.'],
 ['TR-06','No sound from speakers','Check visible volume and mute indicators.','Note which intended output device is selected.','Ask IT to review audio routing or drivers if the issue persists.','User confirms sound from the intended device.'],
 ['TR-07','Bluetooth will not connect','Check the Bluetooth indicator and whether the intended accessory has power.','Note whether the accessory is detected without changing pairing policy.','Ask IT to review pairing and driver state; do not reset managed radios.','The intended approved device reconnects successfully.'],
 ['TR-08','Printer will not print','Check the selected printer and visible printer status.','Note whether the job is queued or a visible error is shown; avoid submitting duplicate jobs.','Ask IT to review the queue or spooler; do not purge shared jobs.','A test page is confirmed by the user or authorized printer operator.'],
 ['TR-09','Screen flickering or black screen','Stop work if the display is unsafe or unreliable.','Report whether the issue affects the built-in or external display if known.','Do not repeatedly reboot or change display drivers; seek qualified IT review.','Stable visible display confirmed by the user and technician.'],
 ['TR-10','My PC takes forever to boot','Note whether the delay is before sign-in or after sign-in.','Report when the delay began without forcing another reboot.','Ask IT to measure boot timing and review approved startup items.','Comparable measured boot timing improves.'],
 ['TR-11','I think my PC has a virus','Stop using the affected device and contact the security team from a trusted device.','Follow your organization’s incident isolation instructions.','Do not run cleanup tools, delete evidence or enter credentials.','Security team formally clears the incident.'],
 ['TR-12','Outlook keeps crashing','Note whether the crash occurs at launch or during a particular action.','Record the visible error without sharing email content or attachments.','Ask IT to review application health; do not remove add-ins or profiles without approval.','Outlook launches and remains usable in an agreed observation period.'],
 ['TR-13','Start Menu or taskbar is frozen','Note whether other applications still respond.','Save accessible work if possible.','Contact IT; do not terminate system processes or run registry scripts.','Shell responds normally after authorized review.'],
 ['TR-14','Laptop battery drains too fast','Check the visible battery percentage and charging indicator.','Note whether drain happens during normal use or while idle.','If the battery is swollen, hot or smells unusual, stop use and escalate immediately.','Measured drain improves or a hardware fault is escalated.'],
 ['TR-15','VPN connected but no internet','Check the visible VPN connection status.','Note whether approved corporate applications or permitted internet access are affected.','Ask IT to review managed routes and DNS; do not bypass the VPN policy.','Approved corporate and permitted destinations work.'],
 ['TR-16','Windows Copilot will not turn off','Review the visible setting and whether it is organization-managed.','Note the Windows edition or visible management message.','Ask the policy owner to review the setting; do not bypass policy.','Authorized managed setting is confirmed.'],
 ['TR-17','Too many pre-installed apps','Review the visible installed-app list locally.','Identify the category of unwanted apps for IT without exporting an inventory.','Do not uninstall security, management or unknown software.','Only approved apps are removed and required software remains intact.'],
 ['TR-18','Windows is sending too much data','Review the visible privacy and diagnostics settings.','Note any organization-managed policy indicators.','Ask the privacy or policy owner for review; do not suppress audit or security traffic.','Authorized privacy policy state is confirmed.'],
 ['TR-19','A driver update broke something','Stop using the affected hardware if it behaves unsafely.','Note the device category and approximate update time.','Do not install unofficial drivers or roll back without qualified approval.','Device is functional after an approved technician-led recovery.'],
 ['TR-20','Right-click menu is annoying in Windows 11','Identify the specific context-menu behavior.','Note the visible Windows version.','Ask IT about supported settings; do not apply registry hacks.','User confirms the approved supported setting works.'],
 ['TR-21','PC is running on Power Saver','Check the visible battery and power mode.','Note whether the device is plugged in or battery-powered.','Ask IT to review managed power settings; do not override enterprise policy.','Approved power plan is effective.'],
 ['TR-22','Startup takes way too long','Note when sign-in completes and when the desktop becomes usable.','Report whether the problem occurs on every startup.','Ask IT to review measured startup timing without disabling managed software.','Comparable measured startup timing improves.'],
 ['TR-23','Microsoft Store apps will not open','Note whether one app or multiple approved apps fail.','Record visible error codes without sharing account data.','Ask IT to review app health; do not reset packages or install unofficial copies.','The intended approved app opens and works.'],
 ['TR-24','My computer smells like burning','Stop using the computer immediately and move away if unsafe.','Disconnect power only if safe; do not touch damaged equipment or attempt another boot.','Contact qualified emergency or IT assistance as appropriate. Do not collect diagnostics.','Qualified technician clears the physical hazard.'],
 ['TR-25','My PC keeps going to sleep','Note whether sleep happens during use or while idle.','Check visible sleep settings and whether they are managed.','Ask IT to review approved power policy; do not disable managed sleep controls.','User confirms the approved sleep policy works.'],
 ['TR-26','Is my firewall working?','Review the visible firewall status in Windows Security.','Note any warning or organization-managed status.','Ask IT to verify approved profiles; do not disable the firewall or change rules.','Authorized firewall posture is independently confirmed.']
];
const byId=new Map(rows.map(([id,title,...guidance])=>[id,Object.freeze({id,title,
 steps:Object.freeze(guidance.slice(0,3)),success_check:guidance[3]})]));
if(byId.size!==troubleshootingCatalog.length||troubleshootingCatalog.some(x=>!byId.has(x.id)))
 throw Error('GUIDANCE_CATALOG_DRIFT');
export const employeeGuidanceCatalog=Object.freeze(troubleshootingCatalog.map(issue=>Object.freeze({
 ...byId.get(issue.id),category:issue.category,repair_tier:issue.repair_tier
})));
const blocked=Object.freeze({decision:'BLOCKED',reason:'INVALID_INPUT',diagnostic_authorized:false,
 repair_authorized:false,execution_authorized:false,production_accepted:false});
const hazards=Object.freeze({
 PHYSICAL_HAZARD:'Stop use, move away if unsafe, disconnect power only if safe and obtain qualified emergency or IT assistance.',
 SUSPECTED_COMPROMISE:'Stop using the affected device and contact your security team from a trusted device. Preserve evidence.',
 DATA_LOSS_RISK:'Stop changes and contact qualified IT support. Do not delete files, repair storage or repeatedly restart.',
 BOOT_OR_ENCRYPTION_DAMAGE:'Do not repeatedly restart or change boot or encryption settings. Contact qualified IT support.'
});
export function getEmployeeGuidance(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype||
    Reflect.ownKeys(input).some(k=>!['category_id','hazard'].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,k),'value')))return blocked;
 if(!Object.hasOwn(input,'category_id'))return blocked;
 const {category_id,hazard='UNKNOWN'}=input;
 const issue=employeeGuidanceCatalog.find(x=>x.id===category_id);
 if(!issue||!['UNKNOWN','NONE',...Object.keys(hazards)].includes(hazard))return blocked;
 // Never let a self-service presentation invent recorded consent/policy.
 const plan=planTroubleshooting({category_id,intake_channel:'SELF_SERVICE',hazard});
 const urgent=Object.hasOwn(hazards,hazard)?hazards[hazard]:null;
 const instructions=urgent?[urgent]:issue.repair_tier==='D3'?issue.steps:
  hazard==='UNKNOWN'?['Check for physical danger, suspected compromise, data-loss risk or boot/encryption damage before proceeding. If uncertain, contact IT.']:issue.steps;
 return Object.freeze({category_id,title:issue.title,decision:plan.decision,reason:plan.reason,
  guidance_type:urgent||issue.repair_tier==='D3'?'HUMAN_ONLY':hazard==='UNKNOWN'?'HAZARD_ASSESSMENT':'ADVISORY_ONLY',
  instructions:Object.freeze([...instructions]),success_check:issue.success_check,
  diagnostic_authorized:false,repair_authorized:false,execution_authorized:false,verified_resolved:false,production_accepted:false});
}
