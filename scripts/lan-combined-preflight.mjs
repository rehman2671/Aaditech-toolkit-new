// Read-only composition of actual signed-bundle verification and Linux
// host inspection. No network probes, runtime install, writes or secrets.
import {verifySignedLanBundle} from './verify-lan-bundle.mjs';
import {inspectLanHost} from './lan-host-preflight.mjs';
export async function inspectLocalLanReadiness({confirmation,bundle,host}={}){
 if(confirmation!=='INSPECT_LOCAL_LAN_ONLY'||!bundle||!host)throw Error('EXPLICIT_LOCAL_PREFLIGHT_REQUIRED');
 // Do not inspect host until independently pinned release bytes pass.
 // All inputs must originate from the trusted local operator, not HTTP.
 const release=await verifySignedLanBundle(bundle);
 if(release.verified!==true||release.publisher_signature_verified!==true||
    release.payload_integrity_verified!==true)throw Error('SIGNED_RELEASE_NOT_VERIFIED');
 const observed=await inspectLanHost(host);
 const blocking=[];
 const expected={reference_platform:'OBSERVED_LINUX',privilege:'ROOT_OBSERVED',
  cpu:'MEETS_INPUT_THRESHOLD',physical_memory:'MEETS_INPUT_THRESHOLD',disk:'MEETS_INPUT_THRESHOLD'};
 for(const [id,state] of Object.entries(expected))
  if(observed.checks.find(x=>x.id===id)?.state!==state)blocking.push(id);
 if(observed.ports.some(x=>x.state!=='NO_LISTENER_OBSERVED'))blocking.push('ports');
 // Missing marker is not proof of absent DB, service or credential state.
 for(const id of ['database','credentials','service'])
  if(observed.markers[id]!=='NOT_OBSERVED')blocking.push('marker_'+id);
 return Object.freeze({schema_version:1,decision:blocking.length?'BLOCKED':'EXTERNAL_REVIEW_REQUIRED',
  blocking:Object.freeze(blocking),publisher_signature_verified:true,payload_integrity_verified:true,
  checks:Object.freeze(observed.checks.map(x=>Object.freeze({...x}))),
  ports:Object.freeze(observed.ports.map(x=>Object.freeze({...x}))),
  markers:Object.freeze({...observed.markers}),
  resource_absence_verified:false,port_reservation_verified:false,runtime_compatibility_verified:false,
  private_tls_verified:false,installation_authorized:false,production_accepted:false});
}
