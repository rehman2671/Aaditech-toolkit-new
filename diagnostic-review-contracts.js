// Bounded review-only data contracts. No collection implementation, endpoint
// execution, proof of measurement truth, compliance decision or authorization.
const categorical=(...allowed)=>v=>v===null||allowed.includes(v);
const integer=(max)=>v=>v===null||(Number.isSafeInteger(v)&&v>=0&&v<=max);
const pct=v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100);
const contract=(schema,fields)=>Object.freeze({schema,fields:Object.freeze(fields)});
export const additionalDiagnosticReviewContracts=Object.freeze({
 UPDATE_STATUS:contract('aaditech-update-diagnostic-v1',{update_state:categorical('PENDING','INSTALLED','FAILED'),restart_state:categorical('REQUIRED','NOT_REQUIRED')}),
 AUDIO_STATUS:contract('aaditech-audio-diagnostic-v1',{output_state:categorical('AVAILABLE','UNAVAILABLE'),mute_state:categorical('MUTED','UNMUTED')}),
 BLUETOOTH_STATUS:contract('aaditech-bluetooth-diagnostic-v1',{radio_state:categorical('ON','OFF','UNAVAILABLE'),service_state:categorical('RUNNING','STOPPED')}),
 PRINT_STATUS:contract('aaditech-print-diagnostic-v1',{queue_state:categorical('EMPTY','PENDING','ERROR'),service_state:categorical('RUNNING','STOPPED')}),
 BOOT_TIMING:contract('aaditech-boot-diagnostic-v1',{boot_duration_ms:integer(86400000),startup_duration_ms:integer(86400000)}),
 APPLICATION_HEALTH:contract('aaditech-application-diagnostic-v1',{application_state:categorical('RUNNING','STOPPED','FAILED'),crash_count:integer(1000000)}),
 SHELL_STATUS:contract('aaditech-shell-diagnostic-v1',{shell_state:categorical('RESPONDING','UNRESPONSIVE','NOT_RUNNING')}),
 BATTERY_HEALTH:contract('aaditech-battery-diagnostic-v1',{charge_percent:pct,charging_state:categorical('CHARGING','DISCHARGING','FULL','NOT_CHARGING'),capacity_percent:pct}),
 MANAGED_POLICY_STATUS:contract('aaditech-policy-diagnostic-v1',{ownership_state:categorical('MANAGED','UNMANAGED'),configuration_state:categorical('CONFIGURED','NOT_CONFIGURED')}),
 APPROVED_SOFTWARE_INVENTORY:contract('aaditech-software-diagnostic-v1',{approved_count:integer(100000),unclassified_count:integer(100000)}),
 OS_SHELL_CONFIGURATION:contract('aaditech-shell-configuration-diagnostic-v1',{configuration_state:categorical('DEFAULT','CUSTOMIZED'),ownership_state:categorical('MANAGED','UNMANAGED')}),
 POWER_PLAN_STATUS:contract('aaditech-power-diagnostic-v1',{power_mode:categorical('POWER_SAVER','BALANCED','PERFORMANCE','OTHER'),sleep_policy_state:categorical('CONFIGURED','NOT_CONFIGURED')}),
 FIREWALL_STATUS:contract('aaditech-firewall-diagnostic-v1',{domain_profile:categorical('ENABLED','DISABLED'),private_profile:categorical('ENABLED','DISABLED'),public_profile:categorical('ENABLED','DISABLED')})
});
